import { Router } from 'express';
import { z } from 'zod';
import { registerCrud } from '../../lib/crud.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { created, nullableStr, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx, type TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { eventScopeWhere } from '../attendance/access.js';

export const eventsRouter = Router();
const T = ['Events'];

const eventBody = z.object({
  name: z.string().trim().min(2).max(150),
  description: nullableStr(2000),
  venue: nullableStr(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  requireRegistration: z.boolean().optional(),
  defaultLatitude: z.number().min(-90).max(90).nullable().optional(),
  defaultLongitude: z.number().min(-180).max(180).nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

registerCrud(eventsRouter, {
  path: '/events', model: 'event', entity: 'Event', tag: 'Events',
  readPermission: ['events.read', 'attendance.sessions.create'], managePermission: 'events.manage',
  create: eventBody,
  filters: { status: z.enum(['ACTIVE', 'ARCHIVED']).optional() },
  include: {
    managers: { include: { lecturer: { select: { id: true, firstName: true, lastName: true } } } },
    _count: { select: { participants: true, attendanceSessions: true } },
  },
  searchFields: ['name', 'venue'], orderBy: { startsAt: 'desc' }, softDelete: true,
  scopeWhere: (ctx) => eventScopeWhere(ctx),
  guardWrite: (_ctx, data, existing) => {
    const s = (data.startsAt ?? existing?.startsAt) as Date | undefined;
    const e = (data.endsAt ?? existing?.endsAt) as Date | undefined;
    if (s && e && e <= s) throw badRequest('Event end must be after its start', 'INVALID_DATES');
  },
});

const r = routes(eventsRouter, '');

async function loadEvent(ctx: TenantContext, id: string) {
  const ev = await ctx.db.event.findFirst({ where: { AND: [{ id }, eventScopeWhere(ctx) ?? {}] } });
  if (!ev) throw notFound('Event');
  return ev;
}

r(
  {
    method: 'get', path: '/events/:id/participants', summary: 'List event participants', tags: T, access: 'tenant',
    permission: ['events.read', 'attendance.sessions.create'], params: uuidParam, query: paginationQuery.extend({ search: z.string().max(100).optional() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const ev = await loadEvent(ctx, req.valid.params.id);
    const q = req.valid.query;
    const where = {
      eventId: ev.id,
      ...(q.search ? { student: { OR: [{ fullName: { contains: q.search, mode: 'insensitive' as const } }, { studentNumber: { contains: q.search, mode: 'insensitive' as const } }] } } : {}),
    };
    const [items, total] = await Promise.all([
      ctx.db.eventParticipant.findMany({
        where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: { createdAt: 'desc' },
        include: { student: { select: { id: true, studentNumber: true, fullName: true, email: true } } },
      }),
      ctx.db.eventParticipant.count({ where }),
    ]);
    ok(res, items, { meta: pageMeta(q, total) });
  },
);

r(
  {
    method: 'post', path: '/events/:id/participants', summary: 'Register participants (bulk, idempotent)', tags: T, access: 'tenant',
    permission: 'events.manage', params: uuidParam, status: 201, body: z.object({ studentIds: z.array(z.string().uuid()).min(1).max(2000) }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const ev = await loadEvent(ctx, req.valid.params.id);
    const ids = [...new Set<string>(req.valid.body.studentIds)];
    const found = await ctx.db.student.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw notFound('One or more students');
    const out = await ctx.db.eventParticipant.createMany({
      data: ids.map((studentId) => ({ organizationId: ctx.organizationId, eventId: ev.id, studentId })),
      skipDuplicates: true,
    });
    await audit({ action: 'event.participants_added', targetType: 'Event', targetId: ev.id, metadata: { count: out.count }, req });
    created(res, { added: out.count });
  },
);

r(
  {
    method: 'delete', path: '/events/:id/participants/:studentId', summary: 'Remove a participant', tags: T, access: 'tenant', permission: 'events.manage',
    params: z.object({ id: z.string().uuid(), studentId: z.string().uuid() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const ev = await loadEvent(ctx, req.valid.params.id);
    await ctx.db.eventParticipant.deleteMany({ where: { eventId: ev.id, studentId: req.valid.params.studentId } });
    ok(res, null, { message: 'Participant removed' });
  },
);

r(
  {
    method: 'post', path: '/events/:id/managers', summary: 'Assign a lecturer/staff member to run attendance for the event', tags: T, access: 'tenant',
    permission: 'events.manage', params: uuidParam, body: z.object({ lecturerId: z.string().uuid() }), status: 201,
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const ev = await loadEvent(ctx, req.valid.params.id);
    const row = await ctx.db.eventManager.upsert({
      where: { eventId_lecturerId: { eventId: ev.id, lecturerId: req.valid.body.lecturerId } },
      create: { organizationId: ctx.organizationId, eventId: ev.id, lecturerId: req.valid.body.lecturerId },
      update: {},
    });
    await audit({ action: 'event.manager_assigned', targetType: 'Event', targetId: ev.id, metadata: { lecturerId: req.valid.body.lecturerId }, req });
    created(res, row);
  },
);

r(
  {
    method: 'delete', path: '/events/:id/managers/:lecturerId', summary: 'Unassign an event manager', tags: T, access: 'tenant', permission: 'events.manage',
    params: z.object({ id: z.string().uuid(), lecturerId: z.string().uuid() }),
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const ev = await loadEvent(ctx, req.valid.params.id);
    await ctx.db.eventManager.deleteMany({ where: { eventId: ev.id, lecturerId: req.valid.params.lecturerId } });
    ok(res, null, { message: 'Manager removed' });
  },
);
