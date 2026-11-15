import type { Request } from 'express';
import { stringify } from 'csv-stringify/sync';
import { tenantDb, withTenant, type TenantDb } from '../../db/tenant.js';
import { enqueue } from '../../infra/queue.js';
import { storage, tenantKey } from '../../infra/storage.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { notifyUser } from '../notifications/notify.js';
import { parseSpreadsheet } from '../students/import.service.js';
import { RESOURCES, type FieldSpec, type RefModel, type ResourceSpec } from './resources.js';

/**
 * Generic CSV/Excel import for lecturers, academic structure and events:
 * upload → mapping + row-by-row preview (new / existing / error) → background job → report.
 */
export const PREVIEW_LIMIT = 2000;
type Mapping = Record<string, string | undefined>;
type Row = Record<string, string>;

export function specFor(resource: string): ResourceSpec {
  const spec = RESOURCES[resource];
  if (!spec) throw notFound('Import type');
  return spec;
}

function assertCanImport(ctx: TenantContext, spec: ResourceSpec) {
  // Rows may reference any department, so imports require organization-wide permission.
  if (ctx.scope(spec.permission) !== 'all') throw forbidden('Importing requires organization-wide permission', 'IMPORT_SCOPE');
}

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

export function suggestMapping(spec: ResourceSpec, headers: string[]): Mapping {
  const out: Mapping = {};
  for (const f of spec.fields) {
    const candidates = new Set([norm(f.key), norm(f.label), ...(f.aliases ?? []).map(norm)]);
    const hit = headers.find((h) => candidates.has(norm(h)));
    if (hit) out[f.key] = hit;
  }
  return out;
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseDate(v: string, withTime: boolean): Date | null {
  let s = v.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(.*)$/.exec(s); // 01/09/2026 = 1 September 2026
  if (dmy) s = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}${dmy[4]}`;
  if (!withTime && /^\d{4}-\d{2}-\d{2}/.test(s)) s = s.slice(0, 10);
  const d = new Date(withTime ? s.replace(' ', 'T') : `${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'x'].includes(s)) return true;
  if (['no', 'n', 'false', '0', ''].includes(s)) return false;
  return null;
}

type Lookups = Map<RefModel, Map<string, string>>;
async function loadLookups(db: TenantDb, spec: ResourceSpec): Promise<Lookups> {
  const out: Lookups = new Map();
  for (const f of spec.fields) {
    if (!f.ref || out.has(f.ref.model)) continue;
    const m = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: { id: string; code?: string; name?: string; title?: string }[] = await (db as any)[f.ref.model].findMany({ take: 10_000 });
    for (const r of rows) for (const k of [r.code, r.name, r.title]) if (k) m.set(k.toLowerCase(), r.id);
    out.set(f.ref.model, m);
  }
  return out;
}

export type ValidRow = { line: number; data: Record<string, unknown>; key: string };
export type PreviewRow = { line: number; status: 'new' | 'existing' | 'error'; values: Record<string, string>; errors: string[] };

function convert(f: FieldSpec, raw: string, lookups: Lookups, errs: string[]): unknown {
  const v = raw.trim();
  if (!v) {
    if (f.required) errs.push(`${f.label} is required`);
    return f.type === 'bool' ? undefined : null;
  }
  if (f.max && v.length > f.max) errs.push(`${f.label} is longer than ${f.max} characters`);
  if (f.ref) {
    const id = lookups.get(f.ref.model)?.get(v.toLowerCase());
    if (!id) errs.push(`Unknown ${f.label.toLowerCase()} "${v.slice(0, 40)}"`);
    return id ?? null;
  }
  switch (f.type) {
    case 'code':
      return v.toUpperCase();
    case 'email':
      if (!emailRe.test(v)) errs.push(`${f.label} is not a valid email address`);
      return v.toLowerCase();
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n)) errs.push(`${f.label} must be a whole number`);
      else if ((f.min != null && n < f.min) || (f.maxValue != null && n > f.maxValue)) errs.push(`${f.label} must be between ${f.min ?? 0} and ${f.maxValue}`);
      return Number.isInteger(n) ? n : null;
    }
    case 'date':
    case 'datetime': {
      const d = parseDate(v, f.type === 'datetime');
      if (!d) errs.push(`${f.label} is not a valid date`);
      return d;
    }
    case 'bool': {
      const b = parseBool(v);
      if (b === null) errs.push(`${f.label} must be yes or no`);
      return b ?? undefined;
    }
    default:
      return v;
  }
}

export async function validateRows(organizationId: string, spec: ResourceSpec, rows: Row[], mapping: Mapping) {
  const missing = spec.fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  if (missing.length) throw badRequest(`Match a column to: ${missing.join(', ')}`, 'MAPPING_INCOMPLETE');
  const lookups = await loadLookups(tenantDb(organizationId), spec);
  const valid: ValidRow[] = [];
  const errors = new Map<number, string[]>();
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const line = i + 2;
    const errs: string[] = [];
    const data: Record<string, unknown> = {};
    for (const f of spec.fields) {
      const col = mapping[f.key];
      const value = convert(f, col ? String(row[col] ?? '') : '', lookups, errs);
      if (value !== undefined) data[f.ref ? f.ref.refField : f.key] = value;
    }
    const cross = spec.check?.(data);
    if (cross) errs.push(cross);
    const key = spec.uniqueBy.map((k) => String(data[k] instanceof Date ? (data[k] as Date).toISOString() : (data[k] ?? '')).toLowerCase()).join('|');
    if (!errs.length) {
      const prev = seen.get(key);
      if (prev) errs.push(`Duplicate of line ${prev}`);
      else seen.set(key, line);
    }
    if (errs.length) errors.set(line, errs);
    else valid.push({ line, data, key });
  });
  return { valid, errors };
}

async function existingKeys(db: TenantDb, spec: ResourceSpec, valid: ValidRow[]) {
  if (!valid.length) return new Map<string, string>();
  const or = valid.map((v) => Object.fromEntries(spec.uniqueBy.map((k) => [k, v.data[k]])));
  const found = new Map<string, string>();
  for (let i = 0; i < or.length; i += 500) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, unknown>[] = await (db as any)[spec.model].findMany({ where: { OR: or.slice(i, i + 500) } });
    for (const r of rows) {
      const key = spec.uniqueBy.map((k) => String(r[k] instanceof Date ? (r[k] as Date).toISOString() : (r[k] ?? '')).toLowerCase()).join('|');
      found.set(key, r.id as string);
    }
  }
  return found;
}

async function loadImport(ctx: TenantContext, spec: ResourceSpec, id: string) {
  const imp = await ctx.db.studentImport.findFirst({ where: { id, resource: spec.resource } });
  if (!imp) throw notFound('Import');
  return imp;
}

export async function upload(ctx: TenantContext, resource: string, file: Express.Multer.File | undefined, req: Request) {
  const spec = specFor(resource);
  assertCanImport(ctx, spec);
  if (!file) throw badRequest('Upload a CSV or Excel file', 'FILE_REQUIRED');
  const parsed = await parseSpreadsheet(file.buffer, file.originalname);
  if (parsed.rows.length === 0) throw unprocessable('The file has no data rows', 'IMPORT_EMPTY');
  const ext = /\.xlsx$/i.test(file.originalname) ? 'xlsx' : 'csv';
  const key = tenantKey(ctx.organizationId, 'imports', ext);
  await storage.put(key, file.buffer, ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
  const imp = await ctx.db.studentImport.create({
    data: { organizationId: ctx.organizationId, resource, uploadedById: ctx.userId, fileName: file.originalname.slice(0, 200), fileKey: key, totalRows: parsed.rows.length },
  });
  await audit({ action: `${resource}_import.uploaded`, targetType: 'Import', targetId: imp.id, metadata: { rows: parsed.rows.length }, req });
  return {
    id: imp.id, fileName: imp.fileName, totalRows: parsed.rows.length, headers: parsed.headers,
    suggestedMapping: suggestMapping(spec, parsed.headers),
    fields: spec.fields.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
  };
}

export async function preview(ctx: TenantContext, resource: string, id: string, mapping: Mapping) {
  const spec = specFor(resource);
  assertCanImport(ctx, spec);
  const imp = await loadImport(ctx, spec, id);
  const { rows } = await parseSpreadsheet(await storage.get(imp.fileKey), imp.fileName);
  const { valid, errors } = await validateRows(ctx.organizationId, spec, rows, mapping);
  const existing = await existingKeys(ctx.db, spec, valid);
  const validByLine = new Map(valid.map((v) => [v.line, v]));
  const table: PreviewRow[] = rows.slice(0, PREVIEW_LIMIT).map((row, i) => {
    const line = i + 2;
    const v = validByLine.get(line);
    return {
      line,
      status: v ? (existing.has(v.key) ? 'existing' : 'new') : 'error',
      values: Object.fromEntries(spec.fields.map((f) => [f.key, mapping[f.key] ? String(row[mapping[f.key]!] ?? '').trim().slice(0, 120) : ''])),
      errors: errors.get(line) ?? [],
    };
  });
  const existingCount = valid.filter((v) => existing.has(v.key)).length;
  return {
    totalRows: rows.length, validRows: valid.length, invalidRows: errors.size, existingRecords: existingCount, newRecords: valid.length - existingCount,
    columns: spec.fields.map((f) => ({ key: f.key, label: f.label })), table, tableTruncated: rows.length > PREVIEW_LIMIT,
  };
}

export async function commit(ctx: TenantContext, resource: string, id: string, mapping: Mapping, mode: 'create_only' | 'upsert', req: Request) {
  const spec = specFor(resource);
  assertCanImport(ctx, spec);
  const imp = await loadImport(ctx, spec, id);
  if (imp.status !== 'PENDING') throw conflict('This import has already been processed', 'IMPORT_ALREADY_PROCESSED');
  const claimed = await ctx.db.studentImport.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PROCESSING', mapping: { ...mapping, __mode: mode } } });
  if (claimed.count !== 1) throw conflict('This import has already been processed', 'IMPORT_ALREADY_PROCESSED');
  await enqueue('student-import', { organizationId: ctx.organizationId, importId: id });
  await audit({ action: `${resource}_import.started`, targetType: 'Import', targetId: id, metadata: { mode }, req });
  return { id, status: 'PROCESSING' };
}

export async function status(ctx: TenantContext, resource: string, id: string) {
  const spec = specFor(resource);
  const imp = await loadImport(ctx, spec, id);
  const errorReportUrl = imp.errorReportKey ? await storage.signedUrl(imp.errorReportKey, 300, `${resource}-import-errors-${id.slice(0, 8)}.csv`) : null;
  const { fileKey: _k, errorReportKey: _e, ...rest } = imp;
  return { ...rest, errorReportUrl };
}

/** Background job for non-student resources (dispatched from the shared import queue). */
export async function runGenericImportJob(data: { organizationId: string; importId: string }) {
  const db = tenantDb(data.organizationId);
  const imp = await db.studentImport.findUnique({ where: { id: data.importId } });
  if (!imp || imp.status !== 'PROCESSING') return;
  const spec = specFor(imp.resource);
  try {
    const { __mode, ...mapping } = (imp.mapping ?? {}) as Mapping & { __mode?: string };
    const { rows } = await parseSpreadsheet(await storage.get(imp.fileKey), imp.fileName);
    const { valid, errors } = await validateRows(data.organizationId, spec, rows, mapping);
    const failures: { line: number; errors: string[] }[] = [...errors.entries()].map(([line, errs]) => ({ line, errors: errs }));
    let success = 0;
    for (let i = 0; i < valid.length; i += 200) {
      const batch = valid.slice(i, i + 200);
      await withTenant(data.organizationId, async (tx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate = (tx as any)[spec.model];
        const existing = await existingKeys(tx as unknown as TenantDb, spec, batch);
        for (const v of batch) {
          const id = existing.get(v.key);
          if (id) {
            if (__mode === 'upsert') {
              await delegate.update({ where: { id }, data: v.data });
              success++;
            } else failures.push({ line: v.line, errors: [`This ${spec.label} already exists`] });
          } else {
            await delegate.create({ data: { ...v.data, organizationId: data.organizationId } });
            success++;
          }
        }
      }, { timeout: 60_000 });
    }
    let errorReportKey: string | null = null;
    if (failures.length) {
      const csv = stringify(failures.sort((a, b) => a.line - b.line).map((f) => ({ line: f.line, errors: f.errors.join('; ') })), { header: true });
      errorReportKey = tenantKey(data.organizationId, 'imports', 'csv');
      await storage.put(errorReportKey, Buffer.from(csv), 'text/csv');
    }
    await db.studentImport.update({
      where: { id: imp.id },
      data: { status: 'COMPLETED', successCount: success, failureCount: failures.length, completedAt: new Date(), errorReportKey, errorSummary: failures.slice(0, 20) },
    });
    await notifyUser({
      userId: imp.uploadedById, organizationId: data.organizationId, type: 'import.completed', title: `${spec.label[0].toUpperCase()}${spec.label.slice(1)} import completed`,
      body: `${success} ${spec.resource.replace('-', ' ')} imported, ${failures.length} rows skipped.`, data: { importId: imp.id, resource: spec.resource },
    });
  } catch (err) {
    await db.studentImport.update({ where: { id: imp.id }, data: { status: 'FAILED', completedAt: new Date(), errorSummary: [{ error: 'Import failed' }] } });
    throw err;
  }
}
