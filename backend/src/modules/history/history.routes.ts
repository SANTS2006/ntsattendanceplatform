import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { ok, pageMeta, paginationQuery } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx, type TenantContext } from '../../middleware/context.js';
import { classScopeWhere, eventScopeWhere } from '../attendance/access.js';

/**
 * History: the organization's append-only audit trail presented per module and per record —
 * status changes (with before/after and reason), creations, updates, enrolments and other actions.
 */
export const historyRouter = Router();
const r = routes(historyRouter, '');
const T = ['History'];

/** Modules → the audit target types and action prefixes they cover. */
export const HISTORY_MODULES: Record<string, { targetTypes: string[]; actions: string[] }> = {
  students: { targetTypes: ['Student', 'StudentImport'], actions: ['student.', 'student_import.', 'students_import.'] },
  classes: { targetTypes: ['Class', 'Enrollment'], actions: ['class.', 'enrollment.', 'classes_import.'] },
  events: { targetTypes: ['Event'], actions: ['event.', 'events_import.'] },
  lecturers: { targetTypes: ['Lecturer'], actions: ['lecturer.', 'lecturers_import.'] },
  attendance: { targetTypes: ['AttendanceSession', 'AttendanceRecord', 'ReportExport'], actions: ['attendance', 'qr.', 'selfie.', 'report.'] },
  academics: {
    targetTypes: ['Faculty', 'Department', 'Program', 'Academic level', 'Academic year', 'Semester', 'Course'],
    actions: ['faculty.', 'department.', 'program.', 'academicLevel.', 'academicYear.', 'semester.', 'course.'],
  },
  people: { targetTypes: ['Membership', 'OrganizationMembership', 'Role', 'Invitation'], actions: ['member.', 'role.', 'invitation.'] },
  organization: { targetTypes: ['Organization', 'OrganizationSettings'], actions: ['organization.', 'support.', 'feedback.'] },
};

const listQuery = paginationQuery.extend({
  module: z.enum(Object.keys(HISTORY_MODULES) as [string, ...string[]]).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(64).optional(),
  action: z.string().trim().max(80).optional(),
  actorUserId: z.string().uuid().optional(),
  statusChangesOnly: z.enum(['true', 'false']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const moduleWhere = (m: string): Prisma.AuditLogWhereInput => {
  const def = HISTORY_MODULES[m];
  return { OR: [{ targetType: { in: def.targetTypes } }, ...def.actions.map((a) => ({ action: { startsWith: a } }))] };
};

const LABELERS: Record<string, (ids: string[], org: string) => Promise<[string, string][]>> = {
  Student: async (ids, org) => (await prisma.student.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, fullName: true, studentNumber: true } })).map((s) => [s.id, `${s.fullName} (${s.studentNumber})`]),
  Class: async (ids, org) => (await prisma.class.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true, code: true } })).map((c) => [c.id, `${c.code} · ${c.name}`]),
  Event: async (ids, org) => (await prisma.event.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
  Lecturer: async (ids, org) => (await prisma.lecturer.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, firstName: true, lastName: true, title: true } })).map((l) => [l.id, `${l.title ? `${l.title} ` : ''}${l.firstName} ${l.lastName}`]),
  Course: async (ids, org) => (await prisma.course.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, code: true, title: true } })).map((c) => [c.id, `${c.code} · ${c.title}`]),
  Department: async (ids, org) => (await prisma.department.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]),
  Program: async (ids, org) => (await prisma.program.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]),
  Faculty: async (ids, org) => (await prisma.faculty.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]),
  Role: async (ids, org) => (await prisma.role.findMany({ where: { organizationId: org, id: { in: ids } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]),
};

/** Adds actor names and readable target labels. IP addresses are never returned. */
async function enrich(org: string, items: Prisma.AuditLogGetPayload<object>[]) {
  const actorIds = [...new Set(items.map((i) => i.actorUserId).filter(Boolean))] as string[];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, email: true } })).map((a) => [a.id, a]));
  const labels = new Map<string, string>();
  const byType = new Map<string, Set<string>>();
  for (const i of items) if (i.targetType && i.targetId && LABELERS[i.targetType]) (byType.get(i.targetType) ?? byType.set(i.targetType, new Set()).get(i.targetType)!).add(i.targetId);
  await Promise.all([...byType].map(async ([type, ids]) => {
    for (const [id, label] of await LABELERS[type]([...ids].filter((x) => /^[0-9a-f-]{36}$/i.test(x)), org)) labels.set(`${type}:${id}`, label);
  }));
  return items.map(({ ip: _ip, userAgent: _ua, ...i }) => ({
    ...i,
    actor: i.actorUserId ? actors.get(i.actorUserId) ?? null : null,
    targetLabel: (i.targetType && i.targetId && labels.get(`${i.targetType}:${i.targetId}`)) || (i.metadata as { name?: string } | null)?.name || null,
  }));
}

r(
  { method: 'get', path: '/history', summary: 'Organization history (all modules, filterable)', tags: T, access: 'tenant', permission: 'audit.read', query: listQuery },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const q = req.valid.query;
    const and: Prisma.AuditLogWhereInput[] = [{ organizationId: ctx.organizationId }, { NOT: { action: { startsWith: 'platform.' } } }];
    if (q.module) and.push(moduleWhere(q.module));
    if (q.targetType) and.push({ targetType: q.targetType });
    if (q.targetId) and.push({ targetId: q.targetId });
    if (q.action) and.push({ action: { contains: q.action, mode: 'insensitive' } });
    if (q.actorUserId) and.push({ actorUserId: q.actorUserId });
    if (q.statusChangesOnly === 'true') and.push({ OR: [{ action: { endsWith: '.status_changed' } }, { action: { endsWith: '.archived' } }] });
    if (q.from || q.to) and.push({ createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
    const where = { AND: and };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, await enrich(ctx.organizationId, items), { meta: pageMeta(q, total) });
  },
);

/** Can the caller see this record? (History is shown only for records the caller can open.) */
async function assertVisible(ctx: TenantContext, type: string, id: string) {
  if (ctx.has('audit.read') && ctx.scope('audit.read') === 'all') return;
  const found = await (async () => {
    switch (type) {
      case 'Student': {
        const s = ctx.scope('students.read');
        if (s === null) return null;
        return ctx.db.student.findFirst({ where: { id, ...(Array.isArray(s) ? { departmentId: { in: s } } : {}) }, select: { id: true } });
      }
      case 'Class':
        return ctx.db.class.findFirst({ where: { AND: [{ id }, classScopeWhere(ctx) ?? {}] }, select: { id: true } });
      case 'Event':
        return ctx.db.event.findFirst({ where: { AND: [{ id }, eventScopeWhere(ctx) ?? {}] }, select: { id: true } });
      case 'Lecturer': {
        const s = ctx.scope('lecturers.read');
        if (s === null) return null;
        return ctx.db.lecturer.findFirst({ where: { id, ...(Array.isArray(s) ? { departmentId: { in: s } } : {}) }, select: { id: true } });
      }
      default:
        throw forbidden();
    }
  })();
  if (!found) throw notFound('Record');
}

r(
  {
    method: 'get', path: '/history/:targetType/:targetId', summary: "A record's history (status changes and actions)", tags: T, access: 'tenant',
    params: z.object({ targetType: z.enum(['Student', 'Class', 'Event', 'Lecturer', 'Course', 'Department', 'Program', 'Faculty', 'Role']), targetId: z.string().uuid() }),
    query: paginationQuery,
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const { targetType, targetId } = req.valid.params;
    await assertVisible(ctx, targetType, targetId);
    const q = req.valid.query;
    const or: Prisma.AuditLogWhereInput[] = [{ targetType, targetId }];
    // A student's history also includes being enrolled in / removed from classes and events.
    if (targetType === 'Student') {
      or.push({ metadata: { path: ['studentId'], equals: targetId } });
      or.push({ metadata: { path: ['studentIds'], array_contains: [targetId] } });
    }
    const where: Prisma.AuditLogWhereInput = { organizationId: ctx.organizationId, OR: or };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, await enrich(ctx.organizationId, items), { meta: pageMeta(q, total) });
  },
);
