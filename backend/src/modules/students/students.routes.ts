import { Router } from 'express';
import { z } from 'zod';
import { created, nullableStr, nullableUuid, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import * as imports from './import.service.js';
import * as svc from './students.service.js';

export const studentsRouter = Router();
const r = routes(studentsRouter, '');
const T = ['Students'];

const studentBody = z.object({
  studentNumber: z.string().trim().min(1).max(64),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email().max(254).nullable().optional()),
  phone: nullableStr(30),
  programId: nullableUuid(),
  departmentId: nullableUuid(),
  levelId: nullableUuid(),
  academicYear: nullableStr(30),
  status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED']).optional(),
  metadata: z.record(z.string().max(60), z.string().max(500)).refine((m) => Object.keys(m).length <= 30, 'Too many fields').optional(),
});

/* Import routes are registered before /students/:id so "import" is never parsed as an id. */
r(
  { method: 'get', path: '/students/import', summary: 'Recent student imports', tags: T, access: 'tenant', permission: 'students.import' },
  async (req, res) => ok(res, await imports.listImports(tenantCtx(req))),
);
r(
  {
    method: 'post', path: '/students/import', summary: 'Upload a CSV/XLSX student file (returns headers and suggested mapping)', tags: T,
    access: 'tenant', permission: 'students.import', multipart: true, status: 201, middleware: [imports.importUpload.single('file')],
  },
  async (req, res) => created(res, await imports.upload(tenantCtx(req), req.file, req), 'File uploaded'),
);
r(
  {
    method: 'post', path: '/students/import/:id/preview', summary: 'Validate the file with a column mapping', tags: T, access: 'tenant',
    permission: 'students.import', params: uuidParam, body: z.object({ mapping: imports.mappingSchema, table: z.boolean().optional() }),
    description: 'With table=true, also returns every row (up to 2,000) with its status: new, existing or error (with reasons).',
  },
  async (req, res) => ok(res, await imports.preview(tenantCtx(req), req.valid.params.id, req.valid.body.mapping, { table: req.valid.body.table })),
);
r(
  {
    method: 'post', path: '/students/import/:id/commit', summary: 'Start the background import job', tags: T, access: 'tenant',
    permission: 'students.import', params: uuidParam,
    body: z.object({ mapping: imports.mappingSchema, mode: z.enum(['create_only', 'upsert']).default('create_only') }),
  },
  async (req, res) => ok(res, await imports.commit(tenantCtx(req), req.valid.params.id, req.valid.body.mapping, req.valid.body.mode, req), { status: 202, message: 'Import started' }),
);
r(
  { method: 'get', path: '/students/import/:id', summary: 'Import status and error report link', tags: T, access: 'tenant', permission: 'students.import', params: uuidParam },
  async (req, res) => ok(res, await imports.status(tenantCtx(req), req.valid.params.id)),
);

r(
  {
    method: 'get', path: '/students', summary: 'List/search students (server-side pagination)', tags: T, access: 'tenant', permission: 'students.read',
    query: paginationQuery.extend({
      search: z.string().trim().max(100).optional(),
      programId: z.string().uuid().optional(),
      departmentId: z.string().uuid().optional(),
      levelId: z.string().uuid().optional(),
      classId: z.string().uuid().optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED']).optional(),
      sort: z.string().max(30).optional(),
    }),
  },
  async (req, res) => {
    const out = await svc.list(tenantCtx(req), req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);

r({ method: 'post', path: '/students', summary: 'Create a student', tags: T, access: 'tenant', permission: 'students.create', body: studentBody, status: 201 }, async (req, res) =>
  created(res, await svc.create(tenantCtx(req), req.valid.body, req)),
);

r({ method: 'get', path: '/students/:id', summary: 'Student details', tags: T, access: 'tenant', permission: 'students.read', params: uuidParam }, async (req, res) =>
  ok(res, await svc.get(tenantCtx(req), req.valid.params.id)),
);

r(
  { method: 'patch', path: '/students/:id', summary: 'Update a student', tags: T, access: 'tenant', permission: 'students.update', params: uuidParam, body: studentBody.partial() },
  async (req, res) => ok(res, await svc.update(tenantCtx(req), req.valid.params.id, req.valid.body, req)),
);

r(
  {
    method: 'post', path: '/students/:id/status', summary: 'Change a student status (reactivate, deactivate, graduate, suspend)', tags: T, access: 'tenant',
    permission: ['students.update', 'students.delete'], params: uuidParam,
    body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED']), reason: z.string().trim().max(500).optional() }),
  },
  async (req, res) =>
    ok(res, await svc.changeStatus(tenantCtx(req), req.valid.params.id, req.valid.body.status, req.valid.body.reason || undefined, req), { message: 'Status updated' }),
);

r(
  {
    method: 'delete', path: '/students/:id', summary: 'Deactivate (default) or permanently delete a student', tags: T, access: 'tenant',
    permission: 'students.delete', params: uuidParam, query: z.object({ permanent: z.enum(['true', 'false']).optional() }),
  },
  async (req, res) => {
    await svc.remove(tenantCtx(req), req.valid.params.id, req.valid.query.permanent === 'true', req);
    ok(res, null, { message: 'Student updated' });
  },
);

r(
  { method: 'get', path: '/students/:id/attendance', summary: 'Student attendance history', tags: T, access: 'tenant', permission: 'students.read', params: uuidParam, query: paginationQuery },
  async (req, res) => {
    const out = await svc.attendanceHistory(tenantCtx(req), req.valid.params.id, req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);
