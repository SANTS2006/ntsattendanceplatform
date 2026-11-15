import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { notFound } from '../../lib/errors.js';

/** In-app notifications are per user and (optionally) per organization — users only see their own. */
export const notificationsRouter = Router();
const r = routes(notificationsRouter, '/notifications');
const T = ['Notifications'];

r(
  { method: 'get', path: '/', summary: 'My notifications', tags: T, access: 'user', query: paginationQuery.extend({ unread: z.enum(['true', 'false']).optional() }) },
  async (req, res) => {
    const q = req.valid.query;
    const where = { userId: req.auth!.sub, ...(q.unread === 'true' ? { readAt: null } : {}), OR: [{ organizationId: null }, { organizationId: req.auth!.org ?? undefined }] };
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    ok(res, items, { meta: { ...pageMeta(q, total), unread } });
  },
);

r({ method: 'post', path: '/:id/read', summary: 'Mark a notification read', tags: T, access: 'user', params: uuidParam }, async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.valid.params.id, userId: req.auth!.sub }, data: { readAt: new Date() } });
  ok(res, null);
});

r({ method: 'post', path: '/read-all', summary: 'Mark all notifications read', tags: T, access: 'user' }, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth!.sub, readAt: null }, data: { readAt: new Date() } });
  ok(res, null);
});

r({ method: 'get', path: '/:id', summary: 'One of my notifications (marks it read)', tags: T, access: 'user', params: uuidParam }, async (req, res) => {
  const n = await prisma.notification.findFirst({ where: { id: req.valid.params.id, userId: req.auth!.sub } });
  if (!n) throw notFound('Notification');
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  ok(res, { ...n, readAt: n.readAt ?? new Date() });
});
