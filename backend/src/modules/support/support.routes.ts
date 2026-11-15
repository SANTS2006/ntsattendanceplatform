import { Router } from 'express';
import { z } from 'zod';
import { created, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import * as svc from './support.service.js';

const status = z.enum(['OPEN', 'AWAITING_ORGANIZATION', 'RESOLVED', 'CLOSED']);
const category = z.enum(['GENERAL', 'TECHNICAL', 'BILLING', 'ACCOUNT', 'FEATURE_REQUEST']);
const priority = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const fbCategory = z.enum(['BUG', 'FEATURE', 'IMPROVEMENT', 'PRAISE', 'OTHER']);
const fbStatus = z.enum(['NEW', 'REVIEWED', 'PLANNED', 'DONE']);
const message = z.string().trim().min(2, 'Write a message').max(5000);

/** Organization ↔ platform support conversations and feedback (organization side). */
export const supportRouter = Router();
const r = routes(supportRouter, '');
const T = ['Support & feedback'];

r(
  { method: 'get', path: '/support/tickets', summary: 'My organization’s support requests', tags: T, access: 'tenant', query: paginationQuery.extend({ status: status.optional() }) },
  async (req, res) => {
    const out = await svc.listTickets(tenantCtx(req), req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);
r({ method: 'get', path: '/support/unread', summary: 'Unread replies from the platform team', tags: T, access: 'tenant' }, async (req, res) =>
  ok(res, await svc.orgUnreadCount(tenantCtx(req))),
);
r(
  {
    method: 'post', path: '/support/tickets', summary: 'Contact the platform team', tags: T, access: 'tenant', status: 201,
    body: z.object({ subject: z.string().trim().min(3, 'Enter a subject').max(150), category: category.default('GENERAL'), priority: priority.default('NORMAL'), message }),
  },
  async (req, res) => created(res, await svc.createTicket(tenantCtx(req), req.valid.body, req), 'Message sent to the NTSAttend team'),
);
r({ method: 'get', path: '/support/tickets/:id', summary: 'A support conversation', tags: T, access: 'tenant', params: uuidParam }, async (req, res) =>
  ok(res, await svc.getTicket(tenantCtx(req), req.valid.params.id)),
);
r(
  { method: 'post', path: '/support/tickets/:id/messages', summary: 'Reply in a support conversation', tags: T, access: 'tenant', params: uuidParam, body: z.object({ body: message }) },
  async (req, res) => ok(res, await svc.replyAsOrganization(tenantCtx(req), req.valid.params.id, req.valid.body.body, req), { message: 'Reply sent' }),
);
r({ method: 'post', path: '/support/tickets/:id/close', summary: 'Close a support conversation', tags: T, access: 'tenant', params: uuidParam }, async (req, res) =>
  ok(res, await svc.closeTicket(tenantCtx(req), req.valid.params.id, req), { message: 'Conversation closed' }),
);

r(
  {
    method: 'post', path: '/feedback', summary: 'Send feedback to the platform team', tags: T, access: 'tenant', status: 201,
    body: z.object({ category: fbCategory, rating: z.number().int().min(1).max(5).nullable().optional(), message: z.string().trim().min(5, 'Tell us a little more (at least 5 characters)').max(5000) }),
  },
  async (req, res) => created(res, await svc.submitFeedback(tenantCtx(req), req.valid.body, req), 'Thank you for your feedback'),
);
r({ method: 'get', path: '/feedback', summary: 'Feedback sent by my organization', tags: T, access: 'tenant' }, async (req, res) =>
  ok(res, await svc.myFeedback(tenantCtx(req))),
);

/** Platform (Super Admin) side — mounted under /platform. */
export const platformSupportRouter = Router();
const p = routes(platformSupportRouter, '/platform');
const PT = ['Platform administration'];

p(
  {
    method: 'get', path: '/support/tickets', summary: 'Support inbox across all organizations', tags: PT, access: 'platform',
    query: paginationQuery.extend({ status: status.optional(), search: z.string().trim().max(100).optional(), unread: z.enum(['true', 'false']).optional() }),
  },
  async (req, res) => {
    const q = req.valid.query;
    const out = await svc.platformList({ ...q, unread: q.unread === 'true' });
    ok(res, out.items, { meta: { ...pageMeta(q, out.total), unread: out.unread, open: out.open } });
  },
);
p({ method: 'get', path: '/support/tickets/:id', summary: 'A support conversation', tags: PT, access: 'platform', params: uuidParam }, async (req, res) =>
  ok(res, await svc.platformGet(req.valid.params.id)),
);
p(
  {
    method: 'post', path: '/support/tickets/:id/messages', summary: 'Reply to an organization (emails and notifies them)', tags: PT, access: 'platform',
    params: uuidParam, body: z.object({ body: message, status: status.optional() }),
  },
  async (req, res) => ok(res, await svc.platformReply(req.valid.params.id, req.auth!.sub, req.valid.body, req), { message: 'Reply sent' }),
);
p(
  {
    method: 'patch', path: '/support/tickets/:id', summary: 'Change status or priority', tags: PT, access: 'platform', params: uuidParam,
    body: z.object({ status: status.optional(), priority: priority.optional() }),
  },
  async (req, res) => ok(res, await svc.platformUpdate(req.valid.params.id, req.valid.body, req)),
);
p(
  {
    method: 'get', path: '/feedback', summary: 'Feedback from all organizations', tags: PT, access: 'platform',
    query: paginationQuery.extend({ status: fbStatus.optional(), category: fbCategory.optional() }),
  },
  async (req, res) => {
    const out = await svc.platformFeedback(req.valid.query);
    ok(res, out.items, { meta: { ...pageMeta(req.valid.query, out.total), summary: out.summary } });
  },
);
p(
  {
    method: 'patch', path: '/feedback/:id', summary: 'Triage feedback (status and note)', tags: PT, access: 'platform', params: uuidParam,
    body: z.object({ status: fbStatus.optional(), adminNote: z.string().trim().max(1000).nullable().optional() }),
  },
  async (req, res) => ok(res, await svc.platformUpdateFeedback(req.valid.params.id, req.valid.body, req)),
);
