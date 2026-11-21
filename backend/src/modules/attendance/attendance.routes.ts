import { Router } from 'express';
import { z } from 'zod';
import { created, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import * as svc from './sessions.service.js';

export const attendanceRouter = Router();
const r = routes(attendanceRouter, '/attendance');
const T = ['Attendance sessions'];
const READ = ['attendance.read_all', 'attendance.read_assigned', 'attendance.sessions.create'] as const;
const MANAGE = ['attendance.sessions.create', 'attendance.sessions.manage_all'] as const;

/** The lecturer's device location. Ranges are checked by the location service. */
const devicePoint = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  accuracy: z.number().finite().nullable().optional(),
});

const createBody = z
  .object({
    classId: z.string().uuid().nullable().optional(),
    eventId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2).max(150).optional(),
    durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
    locationVerificationEnabled: z.boolean().optional(),
    selfieRequired: z.boolean().optional(),
    requireEnrollment: z.boolean().optional(),
    lateAfterMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
    allowLate: z.boolean().optional(),
    qrRotationSeconds: z.number().int().min(15).max(3600).nullable().optional(),
  })
  .refine((b) => !!b.classId !== !!b.eventId, { message: 'Choose exactly one class or event', path: ['classId'] });

const statusEnum = z.enum(['ACTIVE', 'EXPIRED', 'CLOSED', 'REVOKED']);
const recordStatus = z.enum(['PRESENT', 'LATE', 'EXCUSED', 'INVALIDATED']);

r(
  {
    method: 'get', path: '/sessions', summary: 'List attendance sessions visible to the caller', tags: T, access: 'tenant', permission: [...READ],
    query: paginationQuery.extend({
      status: statusEnum.optional(), classId: z.string().uuid().optional(), eventId: z.string().uuid().optional(),
      from: z.coerce.date().optional(), to: z.coerce.date().optional(), mine: z.enum(['true', 'false']).optional(),
    }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const out = await svc.listSessions(tenantCtx(req), { ...q, mine: q.mine === 'true' });
    ok(res, out.items, { meta: pageMeta(q, out.total) });
  },
);

r(
  { method: 'post', path: '/sessions', summary: 'Create an attendance session and its first QR code', tags: T, access: 'tenant', permission: [...MANAGE], body: createBody, status: 201 },
  async (req, res) => created(res, await svc.createSession(tenantCtx(req), req.valid.body, req), 'Attendance session started'),
);

r({ method: 'get', path: '/sessions/:id', summary: 'Session details with live statistics', tags: T, access: 'tenant', permission: [...READ], params: uuidParam }, async (req, res) =>
  ok(res, await svc.getSession(tenantCtx(req), req.valid.params.id)),
);

r(
  { method: 'post', path: '/sessions/:id/qr', summary: 'Issue a fresh QR token for an active session', tags: T, access: 'tenant', permission: [...MANAGE], params: uuidParam },
  async (req, res) => ok(res, await svc.issueQr(tenantCtx(req), req.valid.params.id, req)),
);

r(
  {
    method: 'post', path: '/sessions/:id/location', summary: "Save the lecturer's current location for this session (students are compared with it); audited",
    tags: T, access: 'tenant', permission: [...MANAGE], params: uuidParam, body: devicePoint,
  },
  async (req, res) => ok(res, await svc.saveLecturerLocation(tenantCtx(req), req.valid.params.id, req.valid.body, req), { message: 'Location saved' }),
);

r({ method: 'post', path: '/sessions/:id/close', summary: 'Close a session (no further submissions)', tags: T, access: 'tenant', permission: [...MANAGE], params: uuidParam }, async (req, res) =>
  ok(res, await svc.closeSession(tenantCtx(req), req.valid.params.id, req), { message: 'Session closed' }),
);

r({ method: 'post', path: '/sessions/:id/revoke', summary: 'Revoke a session and all of its QR codes', tags: T, access: 'tenant', permission: [...MANAGE], params: uuidParam }, async (req, res) =>
  ok(res, await svc.revokeSession(tenantCtx(req), req.valid.params.id, req), { message: 'QR code revoked' }),
);

r(
  {
    method: 'post', path: '/sessions/:id/replace', summary: 'Revoke and replace a session with a new QR code', tags: T, access: 'tenant', permission: [...MANAGE],
    params: uuidParam, body: z.object({ durationMinutes: z.number().int().min(1).max(24 * 60).optional() }), status: 201,
  },
  async (req, res) => created(res, await svc.replaceSession(tenantCtx(req), req.valid.params.id, req.valid.body.durationMinutes, req), 'Replacement session started'),
);

r(
  {
    method: 'get', path: '/sessions/:id/records', summary: 'Attendance records for a session', tags: T, access: 'tenant', permission: [...READ], params: uuidParam,
    query: paginationQuery.extend({ search: z.string().trim().max(100).optional(), status: recordStatus.optional(), sort: z.string().max(40).optional() }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const out = await svc.listRecords(tenantCtx(req), { ...q, sessionId: req.valid.params.id });
    ok(res, out.items, { meta: pageMeta(q, out.total) });
  },
);

r(
  { method: 'get', path: '/sessions/:id/absentees', summary: 'Enrolled students without attendance in this session', tags: T, access: 'tenant', permission: [...READ], params: uuidParam, query: paginationQuery },
  async (req, res) => {
    const out = await svc.absentees(tenantCtx(req), req.valid.params.id, req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);

r(
  {
    method: 'post', path: '/sessions/:id/manual-records', summary: 'Record attendance manually (audited correction workflow)', tags: T, access: 'tenant',
    permission: 'attendance.correct', params: uuidParam, status: 201,
    body: z.object({ studentId: z.string().uuid(), status: z.enum(['PRESENT', 'LATE', 'EXCUSED']).default('PRESENT'), reason: z.string().trim().min(3).max(300) }),
  },
  async (req, res) => created(res, await svc.manualRecord(tenantCtx(req), req.valid.params.id, req.valid.body, req)),
);

r(
  {
    method: 'get', path: '/records', summary: 'Search attendance records (server-side pagination, filters, sorting)', tags: ['Attendance records'], access: 'tenant',
    permission: [...READ],
    query: paginationQuery.extend({
      sessionId: z.string().uuid().optional(), classId: z.string().uuid().optional(), eventId: z.string().uuid().optional(),
      courseId: z.string().uuid().optional(), programId: z.string().uuid().optional(), levelId: z.string().uuid().optional(),
      departmentId: z.string().uuid().optional(), lecturerId: z.string().uuid().optional(), studentId: z.string().uuid().optional(),
      status: recordStatus.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
      search: z.string().trim().max(100).optional(), sort: z.string().max(40).optional(),
    }),
  },
  async (req, res) => {
    const out = await svc.listRecords(tenantCtx(req), req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);

r(
  {
    method: 'patch', path: '/records/:id', summary: 'Correct an attendance record (status change with reason)', tags: ['Attendance records'], access: 'tenant',
    permission: 'attendance.correct', params: uuidParam, body: z.object({ status: recordStatus, reason: z.string().trim().min(3).max(300) }),
  },
  async (req, res) => ok(res, await svc.correctRecord(tenantCtx(req), req.valid.params.id, req.valid.body, req)),
);

r(
  { method: 'get', path: '/records/:id/selfie', summary: 'Short-lived signed URL for a record’s selfie', tags: ['Attendance records'], access: 'tenant', permission: 'selfies.read', params: uuidParam },
  async (req, res) => ok(res, await svc.getSelfieUrl(tenantCtx(req), req.valid.params.id, req)),
);
