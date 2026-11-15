import { Router } from 'express';
import { z } from 'zod';
import { ok, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import * as svc from './reports.service.js';

export const reportsRouter = Router();
const r = routes(reportsRouter, '/reports');
const T = ['Reports'];

const filters = z.object({
  sessionId: z.string().uuid().optional(), classId: z.string().uuid().optional(), eventId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(), programId: z.string().uuid().optional(), levelId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(), lecturerId: z.string().uuid().optional(), studentId: z.string().uuid().optional(),
  status: z.enum(['PRESENT', 'LATE', 'EXCUSED', 'INVALIDATED']).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(), search: z.string().trim().max(100).optional(),
});

r({ method: 'get', path: '/attendance', summary: 'Attendance analytics (totals, trend, breakdowns)', tags: T, access: 'tenant', permission: 'reports.read', query: filters }, async (req, res) =>
  ok(res, await svc.analytics(tenantCtx(req), req.valid.query)),
);

r(
  {
    method: 'get', path: '/classes/:id/summary', summary: 'Per-student attendance rates for a class', tags: T, access: 'tenant', permission: 'reports.read',
    params: uuidParam, query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
  },
  async (req, res) => ok(res, await svc.classSummary(tenantCtx(req), req.valid.params.id, req.valid.query)),
);

r(
  {
    method: 'post', path: '/export', summary: 'Queue a CSV / Excel / PDF export (generated in the background)', tags: T, access: 'tenant',
    permission: ['reports.export', 'attendance.export'],
    body: z.object({
      format: z.enum(['CSV', 'XLSX', 'PDF']),
      reportType: z.enum(['records', 'class_summary']).default('records'),
      filters: filters.default({}),
    }),
  },
  async (req, res) => ok(res, await svc.requestExport(tenantCtx(req), req.valid.body, req), { status: 202, message: 'Export queued' }),
);

r({ method: 'get', path: '/export', summary: 'My recent exports', tags: T, access: 'tenant', permission: ['reports.export', 'attendance.export'] }, async (req, res) =>
  ok(res, await svc.listExports(tenantCtx(req))),
);

r(
  { method: 'get', path: '/export/:id', summary: 'Export status and temporary download link', tags: T, access: 'tenant', permission: ['reports.export', 'attendance.export'], params: uuidParam },
  async (req, res) => ok(res, await svc.getExport(tenantCtx(req), req.valid.params.id, req)),
);
