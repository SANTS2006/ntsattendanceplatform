import { Router } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import { importUpload } from '../students/import.service.js';
import { RESOURCES } from './resources.js';
import * as svc from './imports.service.js';

/** Generic file import for lecturers, academic structure and events (students use /students/import). */
export const importsRouter = Router();
const r = routes(importsRouter, '/imports');
const T = ['Imports'];
const resource = z.enum(Object.keys(RESOURCES) as [string, ...string[]]);
const params = z.object({ resource });
const idParams = z.object({ resource, id: z.string().uuid() });
const mapping = z.record(z.string().max(40), z.string().max(120).optional());
const perms = ['academics.manage', 'lecturers.manage', 'events.manage'] as const;

r(
  {
    method: 'post', path: '/:resource', summary: 'Upload a CSV/XLSX file for a resource (returns headers and suggested column matching)', tags: T,
    access: 'tenant', permission: [...perms], params, multipart: true, status: 201, middleware: [importUpload.single('file')],
  },
  async (req, res) => created(res, await svc.upload(tenantCtx(req), req.valid.params.resource, req.file, req), 'File uploaded'),
);

r(
  {
    method: 'post', path: '/:resource/:id/preview', summary: 'Row-by-row preview: new, existing or error (with reasons)', tags: T, access: 'tenant',
    permission: [...perms], params: idParams, body: z.object({ mapping }),
  },
  async (req, res) => ok(res, await svc.preview(tenantCtx(req), req.valid.params.resource, req.valid.params.id, req.valid.body.mapping)),
);

r(
  {
    method: 'post', path: '/:resource/:id/commit', summary: 'Start the background import', tags: T, access: 'tenant', permission: [...perms], params: idParams,
    body: z.object({ mapping, mode: z.enum(['create_only', 'upsert']).default('create_only') }),
  },
  async (req, res) =>
    ok(res, await svc.commit(tenantCtx(req), req.valid.params.resource, req.valid.params.id, req.valid.body.mapping, req.valid.body.mode, req), { status: 202, message: 'Import started' }),
);

r(
  { method: 'get', path: '/:resource/:id', summary: 'Import status and error report link', tags: T, access: 'tenant', permission: [...perms], params: idParams },
  async (req, res) => ok(res, await svc.status(tenantCtx(req), req.valid.params.resource, req.valid.params.id)),
);
