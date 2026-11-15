import type { Request } from 'express';
import type { ExportFormat, Prisma } from '@prisma/client';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../../db/prisma.js';
import { tenantDb } from '../../db/tenant.js';
import { enqueue } from '../../infra/queue.js';
import { storage, tenantKey } from '../../infra/storage.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { timeInZone } from '../../lib/time.js';
import { buildTenantContext } from '../../middleware/auth.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { classScopeWhere, sessionScopeWhere } from '../attendance/access.js';
import { recordWhere, type RecordQuery } from '../attendance/sessions.service.js';
import { notifyUser } from '../notifications/notify.js';

export type ReportFilters = Omit<RecordQuery, 'page' | 'pageSize' | 'sort'>;

const MAX_ROWS: Record<ExportFormat, number> = { CSV: 250_000, XLSX: 100_000, PDF: 5_000 };

export async function analytics(ctx: TenantContext, f: ReportFilters) {
  const where = recordWhere(ctx, f);
  const sessionScope = sessionScopeWhere(ctx, 'read');
  const db = ctx.db;
  const [total, byStatus, byDate, byContext, byProgram, byLevel, sessions] = await Promise.all([
    db.attendanceRecord.count({ where }),
    db.attendanceRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.attendanceRecord.groupBy({ by: ['attendanceDate'], where, _count: { _all: true }, orderBy: { attendanceDate: 'asc' } }),
    db.attendanceRecord.groupBy({ by: ['contextSnapshot'], where, _count: { _all: true }, orderBy: { _count: { contextSnapshot: 'desc' } }, take: 10 }),
    db.attendanceRecord.groupBy({ by: ['programSnapshot'], where, _count: { _all: true }, orderBy: { _count: { programSnapshot: 'desc' } }, take: 10 }),
    db.attendanceRecord.groupBy({ by: ['levelSnapshot'], where, _count: { _all: true }, orderBy: { _count: { levelSnapshot: 'desc' } }, take: 10 }),
    db.attendanceSession.count({
      where: {
        AND: [
          sessionScope,
          f.classId ? { classId: f.classId } : {},
          f.eventId ? { eventId: f.eventId } : {},
          f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {},
        ],
      },
    }),
  ]);
  const verificationFailures = await db.attendanceVerification.count({
    where: {
      success: false,
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      ...(f.sessionId ? { sessionId: f.sessionId } : {}),
      session: sessionScope,
    },
  });
  return {
    totalRecords: total,
    sessions,
    verificationFailures,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    trend: byDate.map((d) => ({ date: d.attendanceDate.toISOString().slice(0, 10), count: d._count._all })),
    topContexts: byContext.map((c) => ({ label: c.contextSnapshot, count: c._count._all })),
    byProgram: byProgram.map((c) => ({ label: c.programSnapshot ?? 'Unassigned', count: c._count._all })),
    byLevel: byLevel.map((c) => ({ label: c.levelSnapshot ?? 'Unassigned', count: c._count._all })),
  };
}

/** Per-student attendance rate for one class across all its sessions. */
export async function classSummary(ctx: TenantContext, classId: string, f: { from?: Date; to?: Date }) {
  const scope = classScopeWhere(ctx);
  const cls = await ctx.db.class.findFirst({ where: { AND: [{ id: classId }, scope ?? {}] }, include: { course: { select: { code: true, title: true } } } });
  if (!cls) throw notFound('Class');
  const dateWhere = f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {};
  const sessions = await ctx.db.attendanceSession.findMany({ where: { classId, status: { not: 'REVOKED' }, ...dateWhere }, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  const [enrollments, counts] = await Promise.all([
    ctx.db.enrollment.findMany({
      where: { classId, status: 'ACTIVE' },
      include: { student: { select: { id: true, studentNumber: true, fullName: true, email: true, program: { select: { name: true } }, level: { select: { name: true } } } } },
      orderBy: { student: { fullName: 'asc' } },
    }),
    ctx.db.attendanceRecord.groupBy({ by: ['studentId', 'status'], where: { sessionId: { in: sessionIds } }, _count: { _all: true } }),
  ]);
  const stat = new Map<string, { present: number; late: number; excused: number }>();
  for (const c of counts) {
    const s = stat.get(c.studentId) ?? { present: 0, late: 0, excused: 0 };
    if (c.status === 'PRESENT') s.present += c._count._all;
    if (c.status === 'LATE') s.late += c._count._all;
    if (c.status === 'EXCUSED') s.excused += c._count._all;
    stat.set(c.studentId, s);
  }
  const total = sessionIds.length;
  return {
    class: { id: cls.id, name: cls.name, code: cls.code, course: cls.course },
    totalSessions: total,
    students: enrollments.map((e) => {
      const s = stat.get(e.student.id) ?? { present: 0, late: 0, excused: 0 };
      const attended = s.present + s.late;
      return {
        studentId: e.student.id, studentNumber: e.student.studentNumber, fullName: e.student.fullName, email: e.student.email,
        program: e.student.program?.name ?? null, level: e.student.level?.name ?? null,
        attended, late: s.late, excused: s.excused, absent: Math.max(0, total - attended - s.excused),
        rate: total ? Math.round((attended / total) * 1000) / 10 : null,
      };
    }),
  };
}

// ── Exports ────────────────────────────────────────────────────────────────

export async function requestExport(ctx: TenantContext, input: { format: ExportFormat; reportType: 'records' | 'class_summary'; filters: ReportFilters & { classId?: string } }, req: Request) {
  if (input.reportType === 'class_summary' && !input.filters.classId) throw forbidden('classId is required for a class summary', 'CLASS_REQUIRED');
  // Validate scope now (fails fast with 403) — the job re-checks with fresh permissions.
  recordWhere(ctx, input.filters);
  const exp = await ctx.db.reportExport.create({
    data: {
      organizationId: ctx.organizationId, requestedById: ctx.userId, reportType: input.reportType, format: input.format,
      filters: JSON.parse(JSON.stringify(input.filters)) as Prisma.InputJsonValue,
    },
  });
  await enqueue('report-export', { organizationId: ctx.organizationId, exportId: exp.id });
  await audit({ action: 'report.export_requested', targetType: 'ReportExport', targetId: exp.id, metadata: { format: input.format, reportType: input.reportType }, req });
  return exp;
}

async function loadExport(ctx: TenantContext, id: string) {
  const exp = await ctx.db.reportExport.findUnique({ where: { id } });
  // Exports are private to the requester (plus organization-wide administrators).
  if (!exp || (exp.requestedById !== ctx.userId && !(ctx.isOwner || ctx.scope('attendance.read_all') === 'all'))) throw notFound('Export');
  return exp;
}

export async function getExport(ctx: TenantContext, id: string, req: Request) {
  const exp = await loadExport(ctx, id);
  let downloadUrl: string | null = null;
  if (exp.status === 'COMPLETED' && exp.storageKey && (!exp.expiresAt || exp.expiresAt > new Date())) {
    downloadUrl = await storage.signedUrl(exp.storageKey, 300, `attendance-${exp.reportType}-${exp.id.slice(0, 8)}.${exp.format.toLowerCase()}`);
    await audit({ action: 'report.downloaded', targetType: 'ReportExport', targetId: exp.id, req });
  }
  const { storageKey: _k, ...rest } = exp;
  return { ...rest, downloadUrl };
}

export async function listExports(ctx: TenantContext) {
  const items = await ctx.db.reportExport.findMany({ where: { requestedById: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 30 });
  return items.map(({ storageKey: _k, ...i }) => i);
}

type Row = Record<string, string | number | null>;

async function buildRows(ctx: TenantContext, reportType: string, filters: ReportFilters & { classId?: string }): Promise<{ title: string; columns: string[]; rows: Row[] }> {
  if (reportType === 'class_summary') {
    const s = await classSummary(ctx, filters.classId!, filters);
    return {
      title: `Class attendance summary — ${s.class.course?.code ?? s.class.code} ${s.class.name} (${s.totalSessions} sessions)`,
      columns: ['Student ID', 'Name', 'Email', 'Program', 'Level', 'Attended', 'Late', 'Excused', 'Absent', 'Rate %'],
      rows: s.students.map((r) => ({
        'Student ID': r.studentNumber, Name: r.fullName, Email: r.email, Program: r.program, Level: r.level,
        Attended: r.attended, Late: r.late, Excused: r.excused, Absent: r.absent, 'Rate %': r.rate,
      })),
    };
  }
  const where = recordWhere(ctx, filters);
  const rows: Row[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await ctx.db.attendanceRecord.findMany({
      where, orderBy: { id: 'asc' }, take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, referenceNumber: true, studentNumberSnapshot: true, studentNameSnapshot: true, studentEmailSnapshot: true,
        programSnapshot: true, levelSnapshot: true, contextSnapshot: true, attendanceDate: true, submittedAt: true, status: true,
        locationVerified: true, distanceM: true,
      },
    });
    for (const r of batch) {
      rows.push({
        Reference: r.referenceNumber, 'Student ID': r.studentNumberSnapshot, Name: r.studentNameSnapshot, Email: r.studentEmailSnapshot,
        Program: r.programSnapshot, Level: r.levelSnapshot, 'Course/Class/Event': r.contextSnapshot,
        Date: r.attendanceDate.toISOString().slice(0, 10), Time: timeInZone(r.submittedAt, ctx.timezone), Status: r.status,
        'Location verified': r.locationVerified == null ? 'N/A' : r.locationVerified ? 'Yes' : 'No',
        'Distance (m)': r.distanceM != null ? Math.round(r.distanceM) : null,
      });
    }
    if (batch.length < 2000) break;
    cursor = batch[batch.length - 1].id;
  }
  rows.sort((a, b) => `${a.Date}${a.Time}`.localeCompare(`${b.Date}${b.Time}`));
  return {
    title: 'Attendance records',
    columns: ['Reference', 'Student ID', 'Name', 'Email', 'Program', 'Level', 'Course/Class/Event', 'Date', 'Time', 'Status', 'Location verified', 'Distance (m)'],
    rows,
  };
}

/** Neutralise spreadsheet formula injection (=, +, -, @ prefixes). */
const safeCell = (v: string | number | null) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

async function render(format: ExportFormat, title: string, columns: string[], rows: Row[], orgName: string): Promise<{ buf: Buffer; contentType: string; ext: string }> {
  if (format === 'CSV') {
    const csv = stringify(rows.map((r) => Object.fromEntries(columns.map((c) => [c, safeCell(r[c] ?? null)]))), { header: true, columns });
    return { buf: Buffer.from(`﻿${csv}`), contentType: 'text/csv', ext: 'csv' };
  }
  if (format === 'XLSX') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'NTS';
    const ws = wb.addWorksheet('Attendance');
    ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(12, c.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c, safeCell(r[c] ?? null)])));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return { buf: Buffer.from(await wb.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(16).text(orgName).moveDown(0.2).fontSize(12).text(title).fontSize(8).fillColor('#666').text(`Generated ${new Date().toISOString()} · ${rows.length} rows`).fillColor('#000').moveDown();
  const cols = columns.slice(0, 9);
  const width = (doc.page.width - 72) / cols.length;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(7);
    const y = doc.y;
    cols.forEach((c, i) => doc.text(c, 36 + i * width, y, { width: width - 4 }));
    doc.moveDown(0.6).font('Helvetica');
  };
  header();
  for (const r of rows) {
    if (doc.y > doc.page.height - 50) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    cols.forEach((c, i) => doc.text(String(r[c] ?? ''), 36 + i * width, y, { width: width - 4, height: 18, ellipsis: true }));
    doc.moveDown(0.3);
  }
  doc.end();
  return { buf: await done, contentType: 'application/pdf', ext: 'pdf' };
}

/** Background job. Permissions are re-evaluated for the requester at execution time. */
export async function runExportJob(data: { organizationId: string; exportId: string }) {
  const db = tenantDb(data.organizationId);
  const exp = await db.reportExport.findUnique({ where: { id: data.exportId } });
  if (!exp || exp.status !== 'PENDING') return;
  await db.reportExport.update({ where: { id: exp.id }, data: { status: 'PROCESSING' } });
  try {
    const ctx = await buildTenantContext(exp.requestedById, data.organizationId);
    if (!ctx.has('attendance.export') && !ctx.has('reports.export')) throw forbidden();
    const { title, columns, rows } = await buildRows(ctx, exp.reportType, exp.filters as ReportFilters);
    if (rows.length > MAX_ROWS[exp.format]) throw new Error(`Too many rows for ${exp.format} (${rows.length}); narrow the filters`);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: data.organizationId }, select: { name: true } });
    const out = await render(exp.format, title, columns, rows, org.name);
    const key = tenantKey(data.organizationId, 'reports', out.ext);
    await storage.put(key, out.buf, out.contentType);
    await db.reportExport.update({
      where: { id: exp.id },
      data: { status: 'COMPLETED', storageKey: key, rowCount: rows.length, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    await notifyUser({
      userId: exp.requestedById, organizationId: data.organizationId, type: 'report.ready', title: 'Your report is ready',
      body: `${exp.format} export with ${rows.length} rows is ready to download.`, data: { exportId: exp.id },
    });
  } catch (err) {
    const message = err instanceof Error && err.message.startsWith('Too many rows') ? err.message : 'Report generation failed';
    await db.reportExport.update({ where: { id: exp.id }, data: { status: 'FAILED', error: message, completedAt: new Date() } });
  }
}
