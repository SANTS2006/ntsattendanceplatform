import { Router } from 'express';
import { z } from 'zod';
import { created, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import * as svc from './backups.service.js';

/** Super Admin: database backups to Cloudflare R2 (mounted under /platform). */
export const backupsRouter = Router();
const r = routes(backupsRouter, '/platform');
const T = ['Platform administration'];

r({ method: 'get', path: '/backups', summary: 'Backup history and configuration', tags: T, access: 'platform', query: paginationQuery }, async (req, res) => {
  const out = await svc.listBackups(req.valid.query);
  ok(res, out.items, { meta: { ...pageMeta(req.valid.query, out.total), config: out.config } });
});

r({ method: 'post', path: '/backups', summary: 'Start a database backup to R2 (background job)', tags: T, access: 'platform', status: 201 }, async (req, res) =>
  created(res, await svc.requestBackup(req.auth!.sub, req), 'Backup started'),
);

r({ method: 'get', path: '/backups/:id/download', summary: 'Five-minute signed download link for a backup', tags: T, access: 'platform', params: uuidParam }, async (req, res) =>
  ok(res, await svc.downloadUrl(req.valid.params.id, req)),
);

r(
  {
    method: 'post', path: '/backups/:id/restore', summary: 'Restore the database from a backup (Super Admin; takes a safety backup first)', tags: T,
    access: 'platform', params: uuidParam, body: z.object({ confirm: z.literal('RESTORE', { errorMap: () => ({ message: 'Type RESTORE to confirm' }) }) }),
  },
  async (req, res) => ok(res, await svc.requestRestore(req.valid.params.id, req.auth!.sub, req.platformRole, req), { status: 202, message: 'Restore started' }),
);

r({ method: 'delete', path: '/backups/:id', summary: 'Delete a backup (Super Admin)', tags: T, access: 'platform', params: uuidParam }, async (req, res) => {
  await svc.deleteBackup(req.valid.params.id, req.platformRole, req);
  ok(res, null, { message: 'Backup deleted' });
});
