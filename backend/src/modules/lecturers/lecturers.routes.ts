import { Router } from 'express';
import { z } from 'zod';
import { registerCrud } from '../../lib/crud.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { ok, nullableStr, nullableUuid, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import { invite } from '../members/members.service.js';

export const lecturersRouter = Router();
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
    membership: { select: { id: true, status: true } },
    classes: { include: { class: { select: { id: true, name: true, code: true } } } },
  },
  searchFields: ['firstName', 'lastName', 'email', 'staffNumber'],
  orderBy: { lastName: 'asc' },
  softDelete: true,
});

r(
  {
    method: 'post', path: '/lecturers/:id/invite', summary: 'Send the lecturer an account invitation (lecturer role)', tags: T, access: 'tenant',
    permission: ['lecturers.manage'], params: uuidParam,
  },
  async (req, res) => {
    const ctx = tenantCtx(req);
    ctx.require('members.manage');
    const lecturer = await ctx.db.lecturer.findUnique({ where: { id: req.valid.params.id } });
    if (!lecturer) throw notFound('Lecturer');
    if (lecturer.membershipId) throw badRequest('This lecturer already has an account', 'ALREADY_LINKED');
    const role = await ctx.db.role.findFirst({ where: { key: 'lecturer' } });
    if (!role) throw notFound('Lecturer role');
    ok(res, await invite(ctx, { email: lecturer.email, roleId: role.id, departmentId: null, createLecturer: true }, req), { message: 'Invitation sent' });
  },
);
