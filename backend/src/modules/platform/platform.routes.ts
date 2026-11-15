import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { cacheDel, cacheKeys } from '../../infra/cache.js';
import { jobCounts } from '../../infra/queue.js';
import { getRedis } from '../../infra/redis.js';
import { storage } from '../../infra/storage.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { audit } from '../audit/audit.service.js';
import { revokeAllSessions } from '../auth/auth.service.js';

/**
 * Platform administration. Every route requires an explicit PlatformAdmin grant
 * (organization roles never confer platform access). Reads of tenant data are audited.
 * These routes intentionally use the unscoped client: cross-tenant visibility is the point,
 * and is gated by requirePlatformAdmin.
 */
export const platformRouter = Router();
const r = routes(platformRouter, '/platform');
const T = ['Platform administration'];

r({ method: 'get', path: '/dashboard', summary: 'Platform-wide statistics', tags: T, access: 'platform' }, async (req, res) => {
  const since = new Date(Date.now() - 86_400_000);
  const [orgs, users, students, lecturers, sessions, records, records24h, selfieBytes, openIncidents, highIncidents] = await Promise.all([
    prisma.organization.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.count(),
    prisma.student.count(),
    prisma.lecturer.count(),
    prisma.attendanceSession.count(),
    prisma.attendanceRecord.count(),
    prisma.attendanceRecord.count({ where: { submittedAt: { gte: since } } }),
    prisma.attendanceSelfie.aggregate({ _sum: { sizeBytes: true }, where: { deletedAt: null } }),
    prisma.securityEvent.count({ where: { resolvedAt: null } }),
    prisma.securityEvent.count({ where: { resolvedAt: null, severity: { in: ['HIGH', 'CRITICAL'] } } }),
  ]);
  const byStatus = Object.fromEntries(orgs.map((o) => [o.status, o._count._all]));
  await audit({ action: 'platform.dashboard_viewed', req, actorType: 'PLATFORM_ADMIN' });
  ok(res, {
    organizations: { total: orgs.reduce((a, b) => a + b._count._all, 0), active: byStatus.ACTIVE ?? 0, suspended: byStatus.SUSPENDED ?? 0, deactivated: byStatus.DEACTIVATED ?? 0 },
    users, students, lecturers, attendanceSessions: sessions, attendanceSubmissions: records, submissionsLast24h: records24h,
    storage: { selfieBytes: selfieBytes._sum.sizeBytes ?? 0 },
    security: { openIncidents, highSeverityOpen: highIncidents },
  });
});

r(
  { method: 'get', path: '/analytics', summary: 'Platform activity over time', tags: T, access: 'platform', query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
  async (req, res) => {
    const since = new Date(Date.now() - req.valid.query.days * 86_400_000);
    const [submissions, signups, orgSignups, apiActivity] = await Promise.all([
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', "submittedAt") AS day, count(*) AS count FROM attendance_records WHERE "submittedAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', "createdAt") AS day, count(*) AS count FROM users WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', "createdAt") AS day, count(*) AS count FROM organizations WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`SELECT date_trunc('day', "createdAt") AS day, count(*) AS count FROM audit_logs WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);
    const fmt = (rows: { day: Date; count: bigint }[]) => rows.map((x) => ({ date: x.day.toISOString().slice(0, 10), count: Number(x.count) }));
    const topOrgs = await prisma.attendanceRecord.groupBy({ by: ['organizationId'], where: { submittedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { organizationId: 'desc' } }, take: 10 });
    const names = await prisma.organization.findMany({ where: { id: { in: topOrgs.map((t) => t.organizationId) } }, select: { id: true, name: true } });
    ok(res, {
      submissions: fmt(submissions), userSignups: fmt(signups), organizationSignups: fmt(orgSignups), auditedActions: fmt(apiActivity),
      topOrganizations: topOrgs.map((t) => ({ organizationId: t.organizationId, name: names.find((n) => n.id === t.organizationId)?.name ?? '—', submissions: t._count._all })),
    });
  },
);

r(
  {
    method: 'get', path: '/organizations', summary: 'Search and filter all organizations', tags: T, access: 'platform',
    query: paginationQuery.extend({
      search: z.string().trim().max(100).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
      type: z.enum(['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'TRAINING_INSTITUTION', 'EVENT_ORGANIZER', 'OTHER']).optional(),
    }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { officialEmail: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { _count: { select: { memberships: true, students: true } } },
      }),
      prisma.organization.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r({ method: 'get', path: '/organizations/:id', summary: 'Organization details and usage', tags: T, access: 'platform', params: uuidParam }, async (req, res) => {
  const id = req.valid.params.id;
  const org = await prisma.organization.findUnique({ where: { id }, include: { settings: true } });
  if (!org) throw notFound('Organization');
  const [members, students, lecturers, classes, sessions, records, selfies, owner] = await Promise.all([
    prisma.organizationMembership.count({ where: { organizationId: id } }),
    prisma.student.count({ where: { organizationId: id } }),
    prisma.lecturer.count({ where: { organizationId: id } }),
    prisma.class.count({ where: { organizationId: id } }),
    prisma.attendanceSession.count({ where: { organizationId: id } }),
    prisma.attendanceRecord.count({ where: { organizationId: id } }),
    prisma.attendanceSelfie.aggregate({ where: { organizationId: id, deletedAt: null }, _sum: { sizeBytes: true }, _count: { _all: true } }),
    prisma.user.findUnique({ where: { id: org.createdById }, select: { id: true, email: true, firstName: true, lastName: true } }),
  ]);
  await audit({ action: 'platform.organization_viewed', organizationId: id, targetType: 'Organization', targetId: id, req, actorType: 'PLATFORM_ADMIN' });
  ok(res, { ...org, owner, usage: { members, students, lecturers, classes, sessions, records, selfies: selfies._count._all, selfieBytes: selfies._sum.sizeBytes ?? 0 } });
});

r(
  {
    method: 'patch', path: '/organizations/:id/status', summary: 'Activate, suspend, reactivate or deactivate an organization', tags: T, access: 'platform',
    params: uuidParam, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().min(3).max(500) }),
  },
  async (req, res) => {
    const id = req.valid.params.id;
    const before = await prisma.organization.findUnique({ where: { id }, select: { status: true } });
    if (!before) throw notFound('Organization');
    const org = await prisma.organization.update({ where: { id }, data: { status: req.valid.body.status, statusReason: req.valid.body.reason } });
    const members = await prisma.organizationMembership.findMany({ where: { organizationId: id }, select: { userId: true } });
    await cacheDel(...members.map((m) => cacheKeys.tenant(id, 'membership', m.userId)));
    await audit({
      action: `platform.organization_${req.valid.body.status.toLowerCase()}`, organizationId: id, targetType: 'Organization', targetId: id,
      metadata: { from: before.status, to: req.valid.body.status, reason: req.valid.body.reason }, req, actorType: 'PLATFORM_ADMIN',
    });
    ok(res, org, { message: `Organization status set to ${org.status}` });
  },
);

r(
  {
    method: 'get', path: '/users', summary: 'Search platform users', tags: T, access: 'platform',
    query: paginationQuery.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional() }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        select: {
          id: true, email: true, firstName: true, lastName: true, status: true, emailVerifiedAt: true, mfaEnabled: true, lastLoginAt: true, createdAt: true,
          platformAdmin: { select: { role: true } }, _count: { select: { memberships: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r(
  {
    method: 'patch', path: '/users/:id/status', summary: 'Suspend or reactivate a platform user (revokes sessions on suspension)', tags: T, access: 'platform',
    params: uuidParam, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().min(3).max(500) }),
  },
  async (req, res) => {
    const id = req.valid.params.id;
    if (id === req.auth!.sub) throw badRequest('You cannot change your own status');
    const user = await prisma.user.update({ where: { id }, data: { status: req.valid.body.status } });
    if (req.valid.body.status !== 'ACTIVE') await revokeAllSessions(id, 'platform_suspension');
    const memberships = await prisma.organizationMembership.findMany({ where: { userId: id }, select: { organizationId: true } });
    await cacheDel(...memberships.map((m) => cacheKeys.tenant(m.organizationId, 'membership', id)));
    await audit({ action: `platform.user_${req.valid.body.status.toLowerCase()}`, targetType: 'User', targetId: id, metadata: { reason: req.valid.body.reason }, req, actorType: 'PLATFORM_ADMIN' });
    ok(res, { id: user.id, status: user.status });
  },
);

r(
  {
    method: 'get', path: '/audit-logs', summary: 'Platform audit trail', tags: T, access: 'platform',
    query: paginationQuery.extend({ organizationId: z.string().uuid().optional(), action: z.string().max(80).optional(), actorUserId: z.string().uuid().optional() }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const where: Prisma.AuditLogWhereInput = {
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r(
  {
    method: 'get', path: '/security-events', summary: 'Security incidents', tags: T, access: 'platform',
    query: paginationQuery.extend({ severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), open: z.enum(['true', 'false']).optional() }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const where: Prisma.SecurityEventWhereInput = {
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.open === 'true' ? { resolvedAt: null } : q.open === 'false' ? { resolvedAt: { not: null } } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.securityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.securityEvent.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r({ method: 'post', path: '/security-events/:id/resolve', summary: 'Mark a security event as resolved', tags: T, access: 'platform', params: uuidParam }, async (req, res) => {
  const ev = await prisma.securityEvent.update({ where: { id: req.valid.params.id }, data: { resolvedAt: new Date(), resolvedById: req.auth!.sub } });
  await audit({ action: 'platform.security_event_resolved', targetType: 'SecurityEvent', targetId: ev.id, req, actorType: 'PLATFORM_ADMIN' });
  ok(res, ev);
});

r({ method: 'get', path: '/system-health', summary: 'Detailed system health (database, Redis, storage, jobs)', tags: T, access: 'platform' }, async (_req, res) => {
  const check = async (fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await fn();
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: e instanceof Error ? e.message.slice(0, 200) : 'error' };
    }
  };
  const redis = getRedis();
  ok(res, {
    database: await check(() => prisma.$queryRaw`SELECT 1`),
    redis: redis ? await check(() => redis.ping()) : { ok: true, mode: 'disabled (development)' },
    storage: await check(() => storage.healthy()),
    jobs: await jobCounts().catch(() => ({ error: 'unavailable' })),
    process: { uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1e6), node: process.version },
  });
});

r({ method: 'get', path: '/settings', summary: 'Platform configuration', tags: T, access: 'platform' }, async (_req, res) =>
  ok(res, await prisma.platformSetting.findMany({ orderBy: { key: 'asc' } })),
);

r(
  {
    method: 'put', path: '/settings/:key', summary: 'Set a platform configuration value', tags: T, access: 'platform',
    params: z.object({ key: z.string().regex(/^[a-z][a-z0-9_.]{1,60}$/) }), body: z.object({ value: z.any() }),
  },
  async (req, res) => {
    const s = await prisma.platformSetting.upsert({
      where: { key: req.valid.params.key },
      create: { key: req.valid.params.key, value: req.valid.body.value ?? null, updatedById: req.auth!.sub },
      update: { value: req.valid.body.value ?? null, updatedById: req.auth!.sub },
    });
    await audit({ action: 'platform.setting_changed', targetType: 'PlatformSetting', targetId: s.key, metadata: { value: req.valid.body.value ?? null }, req, actorType: 'PLATFORM_ADMIN' });
    ok(res, s);
  },
);

r({ method: 'get', path: '/admins', summary: 'List platform administrators', tags: T, access: 'platform' }, async (_req, res) =>
  ok(res, await prisma.platformAdmin.findMany({ include: { user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } } } })),
);

r(
  {
    method: 'post', path: '/admins', summary: 'Grant platform administrator access (Super Admin only)', tags: T, access: 'platform',
    body: z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['SUPER_ADMIN', 'PLATFORM_ADMIN']) }),
  },
  async (req, res) => {
    if (req.platformRole !== 'SUPER_ADMIN') throw badRequest('Only Super Admins can grant platform access', 'SUPER_ADMIN_REQUIRED');
    const user = await prisma.user.findUnique({ where: { email: req.valid.body.email } });
    if (!user) throw notFound('User');
    const admin = await prisma.platformAdmin.upsert({
      where: { userId: user.id }, create: { userId: user.id, role: req.valid.body.role, grantedById: req.auth!.sub }, update: { role: req.valid.body.role },
    });
    await audit({ action: 'platform.admin_granted', targetType: 'User', targetId: user.id, metadata: { role: admin.role }, req, actorType: 'PLATFORM_ADMIN' });
    ok(res, admin);
  },
);

r({ method: 'delete', path: '/admins/:id', summary: 'Revoke platform administrator access', tags: T, access: 'platform', params: uuidParam }, async (req, res) => {
  if (req.platformRole !== 'SUPER_ADMIN') throw badRequest('Only Super Admins can revoke platform access', 'SUPER_ADMIN_REQUIRED');
  if (req.valid.params.id === req.auth!.sub) throw badRequest('You cannot revoke your own access');
  await prisma.platformAdmin.delete({ where: { userId: req.valid.params.id } });
  await audit({ action: 'platform.admin_revoked', targetType: 'User', targetId: req.valid.params.id, req, actorType: 'PLATFORM_ADMIN' });
  ok(res, null, { message: 'Platform access revoked' });
});
