import type { Request } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import { z } from 'zod';
import { tenantDb, withTenant } from '../../db/tenant.js';
import { enqueue } from '../../infra/queue.js';
import { storage, tenantKey } from '../../infra/storage.js';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { validateStudentId } from '../../lib/studentId.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { notifyUser } from '../notifications/notify.js';
import { settingsFor } from '../organizations/settings.js';
import { runGenericImportJob } from '../imports/imports.service.js';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;

export const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });

export const IMPORT_FIELDS = [
  'studentNumber', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'program', 'department', 'level', 'academicYear', 'status',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const mappingSchema = z.record(z.enum(IMPORT_FIELDS), z.string().max(120).optional());
export type Mapping = z.infer<typeof mappingSchema>;

type Row = Record<string, string>;

/** Parses CSV or XLSX (detected from content, not extension). Formula cells are read as values. */
export async function parseSpreadsheet(buf: Buffer, fileName: string): Promise<{ headers: string[]; rows: Row[] }> {
  const type = await fileTypeFromBuffer(buf).catch(() => {
    throw unprocessable('Only CSV or Excel (.xlsx) files are accepted', 'UNSUPPORTED_FILE_TYPE');
  });
  let headers: string[] = [];
  let rows: Row[] = [];
  if (type?.ext === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw unprocessable('The workbook has no sheets', 'IMPORT_EMPTY');
    const cell = (v: ExcelJS.CellValue): string => {
      if (v == null) return '';
      if (typeof v === 'object') {
        if ('result' in v) return String(v.result ?? '');
        if ('text' in v) return String(v.text);
        if ('richText' in v) return v.richText.map((t) => t.text).join('');
        if (v instanceof Date) return v.toISOString().slice(0, 10);
      }
      return String(v);
    };
    ws.eachRow((row, idx) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cell);
      if (idx === 1) headers = values.map((h) => h.trim());
      else if (values.some((v) => v.trim() !== '')) {
        rows.push(Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()])));
      }
    });
  } else if (!type || type.mime === 'text/csv' || /\.csv$/i.test(fileName)) {
    if (type && type.mime !== 'text/csv') throw unprocessable('Only CSV or Excel (.xlsx) files are accepted', 'UNSUPPORTED_FILE_TYPE');
    const text = buf.toString('utf8').replace(/^﻿/, '');
    if (text.includes('\u0000')) throw unprocessable('The file does not look like a CSV file', 'UNSUPPORTED_FILE_TYPE');
    try {
      const records = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Row[];
      rows = records;
      headers = records.length ? Object.keys(records[0]) : (parseCsv(text.split(/\r?\n/)[0] ?? '', { trim: true })[0] ?? []);
    } catch {
      throw unprocessable('The CSV file could not be parsed', 'IMPORT_PARSE_FAILED');
    }
  } else {
    throw unprocessable('Only CSV or Excel (.xlsx) files are accepted', 'UNSUPPORTED_FILE_TYPE');
  }
  if (rows.length > MAX_IMPORT_ROWS) throw unprocessable(`Imports are limited to ${MAX_IMPORT_ROWS} rows per file`, 'IMPORT_TOO_LARGE');
  return { headers, rows };
}

const ALIASES: Record<ImportField, string[]> = {
  studentNumber: ['student id', 'studentid', 'student number', 'student_no', 'id number', 'matric', 'matric number', 'registration number', 'reg no', 'index number'],
  firstName: ['first name', 'firstname', 'given name', 'forename'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  fullName: ['full name', 'name', 'student name'],
  email: ['email', 'email address', 'e-mail'],
  phone: ['phone', 'phone number', 'mobile', 'telephone'],
  program: ['program', 'programme', 'program code', 'course of study'],
  department: ['department', 'department code', 'dept'],
  level: ['level', 'academic level', 'year of study', 'class level', 'grade'],
  academicYear: ['academic year', 'session', 'year'],
  status: ['status', 'enrollment status'],
};

export function suggestMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, ' ').trim();
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => norm(h) === norm(field) || ALIASES[field].includes(norm(h)));
    if (hit) out[field] = hit;
  }
  return out;
}

type Lookups = { programs: Map<string, string>; departments: Map<string, string>; levels: Map<string, string> };

async function loadLookups(organizationId: string): Promise<Lookups> {
  const db = tenantDb(organizationId);
  const [programs, departments, levels] = await Promise.all([
    db.program.findMany({ select: { id: true, code: true, name: true } }),
    db.department.findMany({ select: { id: true, code: true, name: true } }),
    db.academicLevel.findMany({ select: { id: true, name: true } }),
  ]);
  const map = (items: { id: string; code?: string; name: string }[]) => {
    const m = new Map<string, string>();
    for (const i of items) {
      m.set(i.name.toLowerCase(), i.id);
      if (i.code) m.set(i.code.toLowerCase(), i.id);
    }
    return m;
  };
  return { programs: map(programs), departments: map(departments), levels: map(levels) };
}

const STATUS = new Set(['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED']);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidRow = {
  line: number;
  studentNumber: string;
  normalizedNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  programId: string | null;
  departmentId: string | null;
  levelId: string | null;
  academicYear: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED';
};
export type RowError = { line: number; studentNumber: string; errors: string[] };

export async function validateRows(organizationId: string, rows: Row[], mapping: Mapping) {
  if (!mapping.studentNumber) throw badRequest('Map a column to the student ID field', 'MAPPING_INCOMPLETE');
  if (!mapping.fullName && !(mapping.firstName && mapping.lastName)) {
    throw badRequest('Map either a full name column or both first and last name columns', 'MAPPING_INCOMPLETE');
  }
  const settings = await settingsFor(organizationId);
  const lookups = await loadLookups(organizationId);
  const get = (row: Row, f: ImportField) => (mapping[f] ? (row[mapping[f]!] ?? '').toString().trim() : '');
  const valid: ValidRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const errs: string[] = [];
    const rawId = get(row, 'studentNumber');
    const idCheck = validateStudentId(rawId, settings);
    if (!idCheck.valid) errs.push(idCheck.reason);
    let firstName = get(row, 'firstName');
    let lastName = get(row, 'lastName');
    const full = get(row, 'fullName');
    if ((!firstName || !lastName) && full) {
      const parts = full.split(/\s+/);
      firstName ||= parts.slice(0, -1).join(' ') || parts[0];
      lastName ||= parts.length > 1 ? parts[parts.length - 1] : '';
    }
    if (!firstName) errs.push('First name is required');
    if (!lastName) errs.push('Last name is required');
    const email = get(row, 'email').toLowerCase();
    if (email && !emailRe.test(email)) errs.push('Email address is invalid');
    const resolve = (f: 'program' | 'department' | 'level', m: Map<string, string>) => {
      const v = get(row, f);
      if (!v) return null;
      const id = m.get(v.toLowerCase());
      if (!id) errs.push(`Unknown ${f} "${v.slice(0, 40)}"`);
      return id ?? null;
    };
    const programId = resolve('program', lookups.programs);
    const departmentId = resolve('department', lookups.departments);
    const levelId = resolve('level', lookups.levels);
    const status = (get(row, 'status').toUpperCase() || 'ACTIVE') as ValidRow['status'];
    if (!STATUS.has(status)) errs.push(`Unknown status "${status.slice(0, 20)}"`);
    if (idCheck.valid) {
      const prev = seen.get(idCheck.normalized);
      if (prev) errs.push(`Duplicate student ID (also on line ${prev})`);
      else seen.set(idCheck.normalized, line);
    }
    if (errs.length || !idCheck.valid) {
      errors.push({ line, studentNumber: rawId.slice(0, 64), errors: errs });
      return;
    }
    valid.push({
      line, studentNumber: rawId, normalizedNumber: idCheck.normalized, firstName, lastName,
      fullName: `${firstName} ${lastName}`.trim(), email: email || null, phone: get(row, 'phone') || null,
      programId, departmentId, levelId, academicYear: get(row, 'academicYear') || null, status,
    });
  });
  return { valid, errors };
}

// ── API operations ─────────────────────────────────────────────────────────

export async function upload(ctx: TenantContext, file: Express.Multer.File | undefined, req: Request) {
  if (!file) throw badRequest('Upload a CSV or Excel file', 'FILE_REQUIRED');
  const parsed = await parseSpreadsheet(file.buffer, file.originalname);
  if (parsed.rows.length === 0) throw unprocessable('The file has no data rows', 'IMPORT_EMPTY');
  const ext = parsed.headers && /\.xlsx$/i.test(file.originalname) ? 'xlsx' : 'csv';
  const key = tenantKey(ctx.organizationId, 'imports', ext);
  await storage.put(key, file.buffer, ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
  const imp = await ctx.db.studentImport.create({
    data: {
      organizationId: ctx.organizationId, uploadedById: ctx.userId, fileName: file.originalname.slice(0, 200),
      fileKey: key, totalRows: parsed.rows.length,
    },
  });
  await audit({ action: 'student_import.uploaded', targetType: 'StudentImport', targetId: imp.id, metadata: { rows: parsed.rows.length }, req });
  return {
    id: imp.id, fileName: imp.fileName, totalRows: parsed.rows.length, headers: parsed.headers,
    suggestedMapping: suggestMapping(parsed.headers), sample: parsed.rows.slice(0, 10), fields: IMPORT_FIELDS,
  };
}

async function loadImport(ctx: TenantContext, id: string) {
  const imp = await ctx.db.studentImport.findFirst({ where: { id, resource: 'students' } });
  if (!imp) throw notFound('Import');
  return imp;
}

export const PREVIEW_TABLE_LIMIT = 2000;

export type PreviewRow = {
  line: number;
  status: 'new' | 'existing' | 'error';
  studentNumber: string;
  fullName: string;
  email: string;
  program: string;
  department: string;
  level: string;
  errors: string[];
};

export async function preview(ctx: TenantContext, id: string, mapping: Mapping, opts: { table?: boolean } = {}) {
  const imp = await loadImport(ctx, id);
  const { rows } = await parseSpreadsheet(await storage.get(imp.fileKey), imp.fileName);
  const { valid, errors } = await validateRows(ctx.organizationId, rows, mapping);
  const existing = await ctx.db.student.findMany({
    where: { normalizedNumber: { in: valid.map((v) => v.normalizedNumber) } },
    select: { normalizedNumber: true },
  });
  const existingSet = new Set(existing.map((e) => e.normalizedNumber));
  const base = {
    totalRows: rows.length, validRows: valid.length, invalidRows: errors.length,
    existingStudents: existing.length, newStudents: valid.length - existing.length,
    errors: errors.slice(0, 100), preview: valid.slice(0, 20),
  };
  if (!opts.table) return base;

  // Row-by-row table of what was read from the file and what will happen to each row.
  const validByLine = new Map(valid.map((v) => [v.line, v]));
  const errorsByLine = new Map(errors.map((e) => [e.line, e.errors]));
  const cell = (row: Record<string, string>, f: ImportField) => (mapping[f] ? String(row[mapping[f]!] ?? '').trim().slice(0, 120) : '');
  const table: PreviewRow[] = rows.slice(0, PREVIEW_TABLE_LIMIT).map((row, i) => {
    const line = i + 2;
    const v = validByLine.get(line);
    const full = cell(row, 'fullName') || `${cell(row, 'firstName')} ${cell(row, 'lastName')}`.trim();
    return {
      line,
      status: v ? (existingSet.has(v.normalizedNumber) ? 'existing' : 'new') : 'error',
      studentNumber: cell(row, 'studentNumber'),
      fullName: v?.fullName ?? full,
      email: cell(row, 'email'),
      program: cell(row, 'program'),
      department: cell(row, 'department'),
      level: cell(row, 'level'),
      errors: errorsByLine.get(line) ?? [],
    };
  });
  // Same shape as the generic importer so one upload component serves every form.
  const columns = [
    { key: 'studentNumber', label: 'Student ID' }, { key: 'fullName', label: 'Name' }, { key: 'email', label: 'Email' },
    { key: 'program', label: 'Program' }, { key: 'level', label: 'Level' },
  ];
  return {
    ...base, table: table.map((t) => ({ ...t, values: { studentNumber: t.studentNumber, fullName: t.fullName, email: t.email, program: t.program, level: t.level } })),
    columns, newRecords: base.newStudents, existingRecords: base.existingStudents, tableTruncated: rows.length > PREVIEW_TABLE_LIMIT,
  };
}

export async function commit(ctx: TenantContext, id: string, mapping: Mapping, mode: 'create_only' | 'upsert', req: Request) {
  const imp = await loadImport(ctx, id);
  if (imp.status !== 'PENDING') throw conflict('This import has already been processed', 'IMPORT_ALREADY_PROCESSED');
  const claimed = await ctx.db.studentImport.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PROCESSING', mapping: { ...mapping, __mode: mode } } });
  if (claimed.count !== 1) throw conflict('This import has already been processed', 'IMPORT_ALREADY_PROCESSED');
  await enqueue('student-import', { organizationId: ctx.organizationId, importId: id });
  await audit({ action: 'student_import.started', targetType: 'StudentImport', targetId: id, metadata: { mode }, req });
  return { id, status: 'PROCESSING' };
}

export async function status(ctx: TenantContext, id: string) {
  const imp = await loadImport(ctx, id);
  const errorReportUrl = imp.errorReportKey ? await storage.signedUrl(imp.errorReportKey, 300, `import-errors-${id}.csv`) : null;
  const { fileKey: _k, errorReportKey: _e, ...rest } = imp;
  return { ...rest, errorReportUrl };
}

export async function listImports(ctx: TenantContext) {
  const items = await ctx.db.studentImport.findMany({ where: { resource: 'students' }, orderBy: { createdAt: 'desc' }, take: 50 });
  return items.map(({ fileKey: _k, errorReportKey: _e, ...i }) => i);
}

/** BullMQ job: tenant id comes from the payload and every query is tenant-scoped. */
export async function runImportJob(data: { organizationId: string; importId: string }) {
  const db = tenantDb(data.organizationId);
  const imp = await db.studentImport.findUnique({ where: { id: data.importId } });
  if (!imp || imp.status !== 'PROCESSING') return;
  if (imp.resource !== 'students') return runGenericImportJob(data);
  try {
    const { __mode, ...mapping } = (imp.mapping ?? {}) as Mapping & { __mode?: string };
    const { rows } = await parseSpreadsheet(await storage.get(imp.fileKey), imp.fileName);
    const { valid, errors } = await validateRows(data.organizationId, rows, mapping);
    let success = 0;
    const failures: RowError[] = [...errors];
    for (let i = 0; i < valid.length; i += 500) {
      const batch = valid.slice(i, i + 500);
      await withTenant(data.organizationId, async (tx) => {
        const existing = await tx.student.findMany({
          where: { normalizedNumber: { in: batch.map((b) => b.normalizedNumber) } },
          select: { id: true, normalizedNumber: true },
        });
        const byNumber = new Map(existing.map((e) => [e.normalizedNumber, e.id]));
        const toCreate = batch.filter((b) => !byNumber.has(b.normalizedNumber));
        if (toCreate.length) {
          const res = await tx.student.createMany({
            data: toCreate.map(({ line: _l, ...b }) => ({ ...b, organizationId: data.organizationId })),
            skipDuplicates: true,
          });
          success += res.count;
        }
        for (const b of batch.filter((x) => byNumber.has(x.normalizedNumber))) {
          if (__mode === 'upsert') {
            const { line: _l, normalizedNumber: _n, ...fields } = b;
            await tx.student.update({ where: { id: byNumber.get(b.normalizedNumber)! }, data: fields });
            success += 1;
          } else {
            failures.push({ line: b.line, studentNumber: b.studentNumber, errors: ['Student ID already exists'] });
          }
        }
      }, { timeout: 60_000 });
    }
    let errorReportKey: string | null = null;
    if (failures.length) {
      const csv = stringify(failures.sort((a, b) => a.line - b.line).map((f) => ({ line: f.line, studentId: f.studentNumber, errors: f.errors.join('; ') })), { header: true });
      errorReportKey = tenantKey(data.organizationId, 'imports', 'csv');
      await storage.put(errorReportKey, Buffer.from(csv), 'text/csv');
    }
    await db.studentImport.update({
      where: { id: imp.id },
      data: {
        status: 'COMPLETED', successCount: success, failureCount: failures.length, completedAt: new Date(), errorReportKey,
        errorSummary: failures.slice(0, 20).map((f) => ({ line: f.line, errors: f.errors })),
      },
    });
    await notifyUser({
      userId: imp.uploadedById, organizationId: data.organizationId, type: 'import.completed', title: 'Student import completed',
      body: `${success} students imported, ${failures.length} rows failed.`, data: { importId: imp.id },
    });
    await audit({ action: 'student_import.completed', organizationId: data.organizationId, actorType: 'SYSTEM', targetType: 'StudentImport', targetId: imp.id, metadata: { success, failed: failures.length } });
  } catch (err) {
    await db.studentImport.update({ where: { id: imp.id }, data: { status: 'FAILED', completedAt: new Date(), errorSummary: [{ error: 'Import failed' }] } });
    throw err;
  }
}
