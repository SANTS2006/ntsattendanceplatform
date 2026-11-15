import type { NextFunction, Request, Response } from 'express';
import type { PermissionKey } from '../config/permissions.js';
import { prisma } from '../db/prisma.js';
import { tenantDb } from '../db/tenant.js';
import { cacheKeys, cached, cacheDel } from '../infra/cache.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { TenantContext, type PermissionScope } from './context.js';

/** Verifies the Bearer access token. Does not resolve an organization. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  req.auth = verifyAccessToken(h.slice(7));
  next();
}

type MembershipSnapshot = {
  membershipId: string;
  organizationId: string;
  orgStatus: string;
  timezone: string;
  userStatus: string;
  isOwner: boolean;
  lecturerId: string | null;
  grants: { key: PermissionKey; departmentId: string | null }[];
};

export async function loadMembership(userId: string, organizationId: string): Promise<MembershipSnapshot | null> {
  return cached(cacheKeys.tenant(organizationId, 'membership', userId), 30, async () => {
    const m = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: {
        organization: { select: { status: true, timezone: true } },
        user: { select: { status: true } },
        lecturer: { select: { id: true, status: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } },
      },
    });
    if (!m || m.status !== 'ACTIVE') return null;
    return {
      membershipId: m.id,
      organizationId: m.organizationId,
      orgStatus: m.organization.status,
      timezone: m.organization.timezone,
      userStatus: m.user.status,
      isOwner: m.isOwner,
      lecturerId: m.lecturer && m.lecturer.status === 'ACTIVE' ? m.lecturer.id : null,
      grants: m.roles.flatMap((mr) =>
        mr.role.permissions.map((rp) => ({ key: rp.permission.key as PermissionKey, departmentId: mr.departmentId })),
      ),
    };
  });
}

export const invalidateMembership = (organizationId: string, userId: string) =>
  cacheDel(cacheKeys.tenant(organizationId, 'membership', userId));

/**
 * Resolves the active tenant from the authenticated user's verified membership.
 * The organization id comes from the signed access token (set only after a membership
 * check at login/switch) and is re-verified against the database on every request.
 * A client-supplied organization id is never trusted.
 */
export async function requireTenant(req: Request, _res: Response, next: NextFunction) {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  if (!auth.org) throw forbidden('Select or create an organization first', 'NO_ORGANIZATION');
  req.ctx = await buildTenantContext(auth.sub, auth.org);
  next();
}

/** Shared by HTTP middleware and Socket.IO room authorization. */
export async function buildTenantContext(userId: string, organizationId: string): Promise<TenantContext> {
  const m = await loadMembership(userId, organizationId);
  if (!m) throw forbidden('You are not a member of this organization', 'NOT_A_MEMBER');
  if (m.userStatus !== 'ACTIVE') throw forbidden('Your account is not active', 'ACCOUNT_INACTIVE');
  if (m.orgStatus !== 'ACTIVE') throw forbidden('This organization is suspended or deactivated', 'ORGANIZATION_INACTIVE');
  const perms = new Map<PermissionKey, PermissionScope>();
  for (const g of m.grants) {
    const cur = perms.get(g.key);
    if (cur === 'all') continue;
    if (g.departmentId === null) perms.set(g.key, 'all');
    else perms.set(g.key, [...new Set([...(cur ?? []), g.departmentId])]);
  }
  return new TenantContext(userId, m.organizationId, m.membershipId, m.isOwner, perms, m.lecturerId, m.timezone, tenantDb(m.organizationId));
}

export const requirePermission =
  (...anyOf: PermissionKey[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) throw forbidden();
    if (!anyOf.some((p) => ctx.has(p))) throw forbidden();
    next();
  };

/** Platform (Super Admin) authorization — completely independent of organization roles. */
export async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw unauthorized();
  const admin = await prisma.platformAdmin.findUnique({
    where: { userId: req.auth.sub },
    include: { user: { select: { status: true } } },
  });
  if (!admin || admin.user.status !== 'ACTIVE') throw forbidden('Platform administrator access required', 'PLATFORM_FORBIDDEN');
  req.platformRole = admin.role;
  next();
}
