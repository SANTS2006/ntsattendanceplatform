import { forbidden } from '../../lib/errors.js';
import { Router } from 'express';
import { z } from 'zod';
import { registerCrud } from '../../lib/crud.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ok, nullableStr, nullableUuid, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import { logger } from '../../lib/logger.js';
import { lecturerAccountState, provisionLecturerAccount } from './accounts.js';

export const lecturersRouter = Router();
const lecturerScope = (ctx: ReturnType<typeof tenantCtx>) => {
  const s = ctx.scope('lecturers.read') ?? ctx.scope('lecturers.manage');
  return Array.isArray(s) ? { departmentId: { in: s } } : {};
};
const r = routes(lecturersRouter, '');
const T = ['Lecturers'];

/* "My teaching" view for the signed-in lecturer — registered before /lecturers/:id. */
r({ method: 'get', path: '/lecturers/me', summary: 'Signed-in lecturer profile with assigned classes and events', tags: T, access: 'tenant' }, async (req, res) => {
  const ctx = tenantCtx(req);
  if (!ctx.lecturerId) return ok(res, null, { message: 'You do not have a lecturer profile in this organization' });
  const lecturer = await ctx.db.lecturer.findUnique({
    where: { id: ctx.lecturerId },
    include: {
      department: { select: { id: true, name: true } },
      classes: {
        include: {
          class: {
            select: {
              id: true, name: true, code: true, room: true, status: true, defaultLatitude: true, defaultLongitude: true,
              course: { select: { id: true, code: true, title: true } }, _count: { select: { enrollments: true } },
            },
          },
        },
      },
      events: { include: { event: { select: { id: true, name: true, startsAt: true, endsAt: true, venue: true, status: true } } } },
    },
  });
  ok(res, lecturer);
});

registerCrud(lecturersRouter, {
  path: '/lecturers', model: 'lecturer', entity: 'Lecturer', tag: 'Lecturers',
  readPermission: 'lecturers.read', managePermission: 'lecturers.manage',
  create: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    title: nullableStr(30),
    staffNumber: nullableStr(40),
    phone: nullableStr(30),
    departmentId: nullableUuid(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  }),
  filters: { departmentId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'ARCHIVED']).optional() },
  include: {
    department: { select: { id: true, name: true } },
    // user credentials are only read to derive accountStatus in `present` and are never returned.
    membership: { select: { id: true, status: true, user: { select: { passwordHash: true, googleId: true } } } },
    classes: { include: { class: { select: { id: true, name: true, code: true } } } },
  },
  searchFields: ['firstName', 'lastName', 'email', 'staffNumber'],
  orderBy: { lastName: 'asc' },
  softDelete: true,
  present: ({ membership, ...row }) => ({
    ...row,
    membership: membership ? { id: membership.id, status: membership.status } : null,
    accountStatus: lecturerAccountState(membership),
  }),
  // Every new lecturer gets a sign-in account in this organization (setup link by email, or the
  // person's existing account is added). A failure here never undoes the lecturer record; the
  // administrator can resend from the lecturer list.
  afterCreate: async (ctx, row, req) => {
    try {
      await provisionLecturerAccount({ organizationId: ctx.organizationId, lecturerId: row.id, actorUserId: ctx.userId, req });
    } catch (err) {
      logger.warn({ lecturerId: row.id, err: err instanceof Error ? err.message : err }, 'lecturer account provisioning failed');
    }
  },
  // Department administrators see and manage only their department's lecturers.
  scopeWhere: (ctx) => {
    const w = lecturerScope(ctx);
    return 'departmentId' in w ? w : undefined;
  },
  guardWrite: (ctx, data, existing) => {
    const s = ctx.scope('lecturers.manage');
    if (s === 'all' || s === null) return;
    const dept = (data.departmentId ?? existing?.departmentId) as string | null | undefined;
    if (!dept || !s.includes(dept)) throw forbidden('This lecturer is outside your department', 'OUT_OF_SCOPE');
  },
});

r(
  {
    method: 'post', path: '/lecturers/:id/invite', summary: 'Create an account for the lecturer, or resend the account setup email', tags: T, access: 'tenant',
    permission: ['lecturers.manage'], params: uuidParam,
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    const lecturer = await ctx.db.lecturer.findFirst({ where: { id: req.valid.params.id, ...lecturerScope(ctx) } });
    if (!lecturer) throw notFound('Lecturer');
    const result = await provisionLecturerAccount({ organizationId: ctx.organizationId, lecturerId: lecturer.id, actorUserId: ctx.userId, req, resend: true });
    if (result.status === 'ALREADY_LINKED') throw badRequest('This lecturer already has an active account', 'ALREADY_LINKED');
    ok(res, result, { message: result.status === 'SETUP_EMAIL_SENT' ? 'Account setup email sent' : 'Lecturer added to the organization with their existing account' });
  },
);
