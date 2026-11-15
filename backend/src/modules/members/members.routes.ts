import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { created, nullableUuid, ok, pageMeta, paginationQuery, uuidParam } from '../../lib/http.js';
import { routes } from '../../lib/route.js';
import { tenantCtx } from '../../middleware/context.js';
import { limits } from '../../middleware/rateLimit.js';
import { REFRESH_COOKIE } from '../auth/auth.routes.js';
import { passwordSchema } from '../auth/password.js';
import * as svc from './members.service.js';

export const membersRouter = Router();
const T = ['Members & Roles'];

const org = routes(membersRouter, '');

org(
  {
    method: 'get', path: '/organizations/members', summary: 'List organization members', tags: T, access: 'tenant', permission: 'members.read',
    query: paginationQuery.extend({ search: z.string().trim().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }),
  },
  async (req, res) => {
    const out = await svc.listMembers(tenantCtx(req), req.valid.query);
    ok(res, out.items, { meta: pageMeta(req.valid.query, out.total) });
  },
);

org(
  {
    method: 'patch', path: '/organizations/members/:id', summary: 'Suspend/reactivate a member or change title', tags: T, access: 'tenant',
    permission: 'members.manage', params: uuidParam,
    body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), title: z.string().trim().max(80).nullable().optional() }),
  },
  async (req, res) => ok(res, await svc.updateMember(tenantCtx(req), req.valid.params.id, req.valid.body, req)),
);

org(
  {
    method: 'put', path: '/organizations/members/:id/roles', summary: 'Replace a member’s roles', tags: T, access: 'tenant',
    permission: 'members.manage', params: uuidParam,
    body: z.object({ roles: z.array(z.object({ roleId: z.string().uuid(), departmentId: nullableUuid() })).max(20) }),
  },
  async (req, res) => ok(res, await svc.setMemberRoles(tenantCtx(req), req.valid.params.id, req.valid.body.roles, req)),
);

org(
  { method: 'delete', path: '/organizations/members/:id', summary: 'Remove a member', tags: T, access: 'tenant', permission: 'members.manage', params: uuidParam },
  async (req, res) => {
    await svc.removeMember(tenantCtx(req), req.valid.params.id, req);
    ok(res, null, { message: 'Member removed' });
  },
);

org(
  {
    method: 'post', path: '/organizations/invitations', summary: 'Invite a user to the organization', tags: T, access: 'tenant',
    permission: 'members.manage', status: 201,
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      roleId: z.string().uuid(),
      departmentId: nullableUuid(),
      createLecturer: z.boolean().optional(),
    }),
  },
  async (req, res) => created(res, await svc.invite(tenantCtx(req), req.valid.body, req), 'Invitation sent'),
);

org({ method: 'get', path: '/organizations/invitations', summary: 'List pending invitations', tags: T, access: 'tenant', permission: 'members.read' }, async (req, res) =>
  ok(res, await svc.listInvitations(tenantCtx(req))),
);

org(
  { method: 'delete', path: '/organizations/invitations/:id', summary: 'Revoke an invitation', tags: T, access: 'tenant', permission: 'members.manage', params: uuidParam },
  async (req, res) => {
    await svc.revokeInvitation(tenantCtx(req), req.valid.params.id, req);
    ok(res, null, { message: 'Invitation revoked' });
  },
);

org(
  {
    method: 'get', path: '/invitations/lookup', summary: 'Describe an invitation from its token', tags: T, access: 'public',
    middleware: [limits.emailVerify()], query: z.object({ token: z.string().min(20).max(200) }),
  },
  async (req, res) => ok(res, await svc.lookupInvitation(req.valid.query.token)),
);

org(
  {
    method: 'post', path: '/invitations/accept', summary: 'Accept an invitation (creates the account if needed)', tags: T, access: 'public',
    middleware: [limits.emailVerify()],
    body: z.object({
      token: z.string().min(20).max(200),
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().min(1).max(80).optional(),
      password: passwordSchema.optional(),
    }),
  },
  async (req, res) => {
    const h = req.headers.authorization;
    const s = await svc.acceptInvitation(req.valid.body.token, req.valid.body, h?.startsWith('Bearer ') ? h.slice(7) : undefined, req);
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/api/v1/auth', maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    });
    const { refreshToken: _r, refreshTokenId: _i, ...body } = s;
    ok(res, body, { message: 'Invitation accepted' });
  },
);

org({ method: 'get', path: '/permissions', summary: 'Permission catalogue', tags: T, access: 'tenant' }, async (_req, res) => ok(res, await svc.listPermissions()));

org({ method: 'get', path: '/roles', summary: 'List roles', tags: T, access: 'tenant', permission: ['members.read', 'roles.manage'] }, async (req, res) =>
  ok(res, await svc.listRoles(tenantCtx(req))),
);

const roleBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().max(60)).max(100),
});

org(
  { method: 'post', path: '/roles', summary: 'Create a custom role', tags: T, access: 'tenant', permission: 'roles.manage', body: roleBody, status: 201 },
  async (req, res) => created(res, await svc.createRole(tenantCtx(req), req.valid.body, req)),
);
org(
  { method: 'patch', path: '/roles/:id', summary: 'Update a custom role', tags: T, access: 'tenant', permission: 'roles.manage', params: uuidParam, body: roleBody.partial() },
  async (req, res) => ok(res, await svc.updateRole(tenantCtx(req), req.valid.params.id, req.valid.body, req)),
);
org(
  { method: 'delete', path: '/roles/:id', summary: 'Delete a custom role', tags: T, access: 'tenant', permission: 'roles.manage', params: uuidParam },
  async (req, res) => {
    await svc.deleteRole(tenantCtx(req), req.valid.params.id, req);
    ok(res, null, { message: 'Role deleted' });
  },
);
