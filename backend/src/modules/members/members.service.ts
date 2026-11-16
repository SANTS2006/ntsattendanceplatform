import type { Request } from 'express';
import { env } from '../../config/env.js';
import type { PermissionKey } from '../../config/permissions.js';
import { prisma } from '../../db/prisma.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { invalidateMembership } from '../../middleware/auth.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { issueSession } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { emails } from '../notifications/notify.js';
import { isPlaceholderAccount } from '../lecturers/accounts.js';

const INVITE_DAYS = 7;

/** Prevents privilege escalation: non-owners can only grant permissions they hold organization-wide. */
function assertCanGrant(ctx: TenantContext, keys: string[]) {
  if (ctx.isOwner) return;
  const missing = keys.filter((k) => ctx.scope(k as PermissionKey) !== 'all');
  if (missing.length) throw forbidden(`You cannot grant permissions you do not hold: ${missing.join(', ')}`, 'PRIVILEGE_ESCALATION');
}

async function rolePermissionKeys(ctx: TenantContext, roleIds: string[]) {
  const roles = await ctx.db.role.findMany({
    where: { id: { in: roleIds } },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  if (roles.length !== new Set(roleIds).size) throw notFound('Role');
  return roles.flatMap((r) => r.permissions.map((p) => p.permission.key));
}

// ── Members ────────────────────────────────────────────────────────────────

export async function listMembers(ctx: TenantContext, q: { page: number; pageSize: number; search?: string; status?: 'ACTIVE' | 'SUSPENDED' }) {
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? {
          user: {
            OR: [
              { email: { contains: q.search, mode: 'insensitive' as const } },
              { firstName: { contains: q.search, mode: 'insensitive' as const } },
              { lastName: { contains: q.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    ctx.db.organizationMembership.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, status: true, lastLoginAt: true, emailVerifiedAt: true } },
        roles: { include: { role: { select: { id: true, key: true, name: true } }, department: { select: { id: true, name: true } } } },
        lecturer: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    ctx.db.organizationMembership.count({ where }),
  ]);
  return { items, total };
}

export async function updateMember(ctx: TenantContext, id: string, data: { status?: 'ACTIVE' | 'SUSPENDED'; title?: string | null }, req: Request) {
  const m = await ctx.db.organizationMembership.findUnique({ where: { id } });
  if (!m) throw notFound('Member');
  if (m.isOwner && data.status === 'SUSPENDED') throw forbidden('The organization owner cannot be suspended', 'OWNER_PROTECTED');
  if (m.userId === ctx.userId && data.status === 'SUSPENDED') throw badRequest('You cannot suspend yourself');
  const updated = await ctx.db.organizationMembership.update({ where: { id }, data });
  await invalidateMembership(ctx.organizationId, m.userId);
  await audit({ action: data.status ? `member.${data.status.toLowerCase()}` : 'member.updated', targetType: 'OrganizationMembership', targetId: id, req });
  return updated;
}

export async function setMemberRoles(ctx: TenantContext, id: string, roles: { roleId: string; departmentId?: string | null }[], req: Request) {
  const m = await ctx.db.organizationMembership.findUnique({ where: { id } });
  if (!m) throw notFound('Member');
  if (m.isOwner && !ctx.isOwner) throw forbidden('Only the owner can change the owner’s roles', 'OWNER_PROTECTED');
  assertCanGrant(ctx, await rolePermissionKeys(ctx, roles.map((r) => r.roleId)));
  await ctx.db.membershipRole.deleteMany({ where: { membershipId: id } });
  if (roles.length) {
    await ctx.db.membershipRole.createMany({
      data: roles.map((r) => ({ organizationId: ctx.organizationId, membershipId: id, roleId: r.roleId, departmentId: r.departmentId ?? null })),
    });
  }
  await invalidateMembership(ctx.organizationId, m.userId);
  await audit({ action: 'member.roles_changed', targetType: 'OrganizationMembership', targetId: id, metadata: { roles }, req });
  return ctx.db.membershipRole.findMany({ where: { membershipId: id }, include: { role: { select: { key: true, name: true } } } });
}

export async function removeMember(ctx: TenantContext, id: string, req: Request) {
  const m = await ctx.db.organizationMembership.findUnique({ where: { id } });
  if (!m) throw notFound('Member');
  if (m.isOwner) throw forbidden('The organization owner cannot be removed', 'OWNER_PROTECTED');
  if (m.userId === ctx.userId) throw badRequest('You cannot remove yourself');
  await ctx.db.organizationMembership.delete({ where: { id } });
  await invalidateMembership(ctx.organizationId, m.userId);
  await audit({ action: 'member.removed', targetType: 'OrganizationMembership', targetId: id, metadata: { userId: m.userId }, req });
}

// ── Roles ──────────────────────────────────────────────────────────────────

export const listPermissions = () => prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });

export async function listRoles(ctx: TenantContext) {
  const roles = await ctx.db.role.findMany({
    include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { memberships: true } } },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
  return roles.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description, isSystem: r.isSystem, permissionsCustomized: r.permissionsCustomized,
    permissions: r.permissions.map((p) => p.permission.key), memberCount: r._count.memberships,
  }));
}

async function permissionIds(keys: string[]) {
  const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
  if (perms.length !== new Set(keys).size) throw badRequest('Unknown permission', 'INVALID_PERMISSION');
  return perms.map((p) => p.id);
}

export async function createRole(ctx: TenantContext, input: { name: string; description?: string; permissions: string[] }, req: Request) {
  assertCanGrant(ctx, input.permissions);
  const key = `custom_${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const ids = await permissionIds(input.permissions);
  const role = await ctx.db.role.create({
    data: {
      organizationId: ctx.organizationId, key, name: input.name, description: input.description,
      permissions: { create: ids.map((permissionId) => ({ permissionId })) },
    },
  });
  await audit({ action: 'role.created', targetType: 'Role', targetId: role.id, metadata: { permissions: input.permissions }, req });
  return role;
}

export async function updateRole(ctx: TenantContext, id: string, input: { name?: string; description?: string; permissions?: string[] }, req: Request) {
  const role = await ctx.db.role.findUnique({ where: { id }, include: { memberships: { select: { membership: { select: { userId: true } } } } } });
  if (!role) throw notFound('Role');
  // Built-in roles: permissions can be added or removed, but the name and description stay fixed
  // (the app refers to them by key, e.g. the Lecturer role).
  if (role.isSystem && ((input.name !== undefined && input.name !== role.name) || (input.description !== undefined && input.description !== (role.description ?? '')))) {
    throw forbidden('Built-in roles cannot be renamed; you can change their permissions', 'SYSTEM_ROLE');
  }
  let added: string[] = [];
  let removed: string[] = [];
  if (input.permissions) {
    const wanted = [...new Set(input.permissions)];
    const current = await rolePermissionKeys(ctx, [id]);
    added = wanted.filter((k) => !current.includes(k));
    removed = current.filter((k) => !wanted.includes(k));
    // Only permissions being added must be held by the editor; removing is always allowed for roles.manage.
    assertCanGrant(ctx, added);
    if (role.isSystem && role.key === 'admin' && removed.includes('roles.manage')) {
      throw forbidden('The Administrator role must keep "Manage roles" so the organization cannot be locked out', 'SYSTEM_ROLE');
    }
    const ids = await permissionIds(wanted);
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) }),
    ]);
  }
  const updated = await ctx.db.role.update({
    where: { id },
    data: role.isSystem
      ? { permissionsCustomized: input.permissions ? true : undefined }
      : { name: input.name, description: input.description },
  });
  await Promise.all(role.memberships.map((m) => invalidateMembership(ctx.organizationId, m.membership.userId)));
  await audit({ action: 'role.updated', targetType: 'Role', targetId: id, metadata: { permissions: input.permissions ?? null, added, removed, system: role.isSystem }, req });
  return updated;
}

export async function deleteRole(ctx: TenantContext, id: string, req: Request) {
  const role = await ctx.db.role.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('System roles cannot be deleted', 'SYSTEM_ROLE');
  if (role._count.memberships > 0) throw conflict('Remove this role from all members before deleting it', 'ROLE_IN_USE');
  await ctx.db.role.delete({ where: { id } });
  await audit({ action: 'role.deleted', targetType: 'Role', targetId: id, req });
}

// ── Invitations ────────────────────────────────────────────────────────────

export async function invite(
  ctx: TenantContext,
  input: { email: string; roleId: string; departmentId?: string | null; createLecturer?: boolean },
  req: Request,
) {
  const role = await ctx.db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw notFound('Role');
  assertCanGrant(ctx, await rolePermissionKeys(ctx, [role.id]));
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const member = await ctx.db.organizationMembership.findFirst({ where: { userId: existingUser.id } });
    if (member) throw conflict('This person is already a member of the organization', 'ALREADY_MEMBER');
  }
  await ctx.db.invitation.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const raw = randomToken(32);
  const inv = await ctx.db.invitation.create({
    data: {
      organizationId: ctx.organizationId,
      email: input.email,
      roleId: role.id,
      departmentId: input.departmentId ?? null,
      createLecturer: input.createLecturer ?? role.key === 'lecturer',
      tokenHash: sha256(raw),
      invitedById: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    },
  });
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  await emails.invitation(input.email, org.name, role.name, raw);
  await audit({ action: 'invitation.created', targetType: 'Invitation', targetId: inv.id, metadata: { email: input.email, role: role.key }, req });
  const { tokenHash: _h, ...safe } = inv;
  return { ...safe, ...(env.isTest ? { _testToken: raw } : {}) };
}

export async function listInvitations(ctx: TenantContext) {
  const items = await ctx.db.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null },
    include: { role: { select: { name: true, key: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return items.map(({ tokenHash: _h, ...i }) => ({ ...i, expired: i.expiresAt < new Date() }));
}

export async function revokeInvitation(ctx: TenantContext, id: string, req: Request) {
  const res = await ctx.db.invitation.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw notFound('Invitation');
  await audit({ action: 'invitation.revoked', targetType: 'Invitation', targetId: id, req });
}

async function findValidInvitation(raw: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { role: { select: { name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
    throw badRequest('This invitation is invalid or has expired', 'INVITATION_INVALID');
  }
  const org = await prisma.organization.findUnique({ where: { id: inv.organizationId }, select: { id: true, name: true, status: true } });
  if (!org || org.status !== 'ACTIVE') throw badRequest('This invitation is invalid or has expired', 'INVITATION_INVALID');
  return { inv, org };
}

export async function lookupInvitation(raw: string) {
  const { inv, org } = await findValidInvitation(raw);
  const user = await prisma.user.findUnique({ where: { email: inv.email }, select: { firstName: true, lastName: true, passwordHash: true, googleId: true } });
  // An account created for the invitee (e.g. as a lecturer) that was never set up is completed here
  // with a password, like a new account; a real existing account must sign in instead.
  const accountExists = !!user && !isPlaceholderAccount(user);
  return {
    organizationName: org.name, email: inv.email, roleName: inv.role.name, expiresAt: inv.expiresAt, accountExists,
    setupRequired: !!user && !accountExists,
    firstName: user?.firstName ?? null, lastName: user?.lastName ?? null,
  };
}

/**
 * Accept an invitation. Single-use (atomic compare-and-set on acceptedAt), expiring, tenant-specific.
 * New users set a password here (email ownership is proven by the emailed token).
 * Existing users must be signed in as the invited email.
 */
export async function acceptInvitation(
  raw: string,
  input: { firstName?: string; lastName?: string; password?: string },
  bearer: string | undefined,
  req: Request,
) {
  const { inv } = await findValidInvitation(raw);
  let user = await prisma.user.findUnique({ where: { email: inv.email } });
  if (user && isPlaceholderAccount(user)) {
    // Account created for this person by the organization: the emailed link proves ownership.
    if (!input.password) throw badRequest('Choose a password to set up your account', 'ACCOUNT_DETAILS_REQUIRED');
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: input.firstName || user.firstName, lastName: input.lastName || user.lastName,
        passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await audit({ action: 'auth.account_setup_completed', organizationId: inv.organizationId, actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req });
  } else if (user) {
    if (!bearer) throw unauthorized('Sign in with the invited account to accept this invitation', 'SIGN_IN_REQUIRED');
    const claims = verifyAccessToken(bearer);
    if (claims.sub !== user.id) throw forbidden('This invitation was sent to a different email address', 'INVITATION_EMAIL_MISMATCH');
  } else {
    if (!input.password || !input.firstName || !input.lastName) {
      throw badRequest('Name and password are required to create your account', 'ACCOUNT_DETAILS_REQUIRED');
    }
    user = await prisma.user.create({
      data: {
        email: inv.email, firstName: input.firstName, lastName: input.lastName,
        passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date(),
      },
    });
  }
  const userId = user.id;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw badRequest('This invitation is invalid or has expired', 'INVITATION_INVALID');
    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
      create: { organizationId: inv.organizationId, userId },
      update: { status: 'ACTIVE' },
    });
    // Accounts provisioned for lecturers already hold the role; never duplicate it.
    const hasRole = await tx.membershipRole.findFirst({ where: { membershipId: membership.id, roleId: inv.roleId, departmentId: inv.departmentId } });
    if (!hasRole) {
      await tx.membershipRole.create({
        data: { organizationId: inv.organizationId, membershipId: membership.id, roleId: inv.roleId, departmentId: inv.departmentId },
      });
    }
    if (inv.createLecturer) {
      const existing = await tx.lecturer.findUnique({ where: { organizationId_email: { organizationId: inv.organizationId, email: inv.email } } });
      if (existing) {
        if (!existing.membershipId) await tx.lecturer.update({ where: { id: existing.id }, data: { membershipId: membership.id } });
      } else {
        await tx.lecturer.create({
          data: {
            organizationId: inv.organizationId, membershipId: membership.id, email: inv.email,
            firstName: user!.firstName, lastName: user!.lastName, departmentId: inv.departmentId,
          },
        });
      }
    }
  });
  await invalidateMembership(inv.organizationId, userId);
  await audit({ action: 'invitation.accepted', organizationId: inv.organizationId, actorUserId: userId, actorType: 'USER', targetType: 'Invitation', targetId: inv.id, req });
  const session = await issueSession(user, inv.organizationId, { ip: req.ip, userAgent: req.get('user-agent'), req });
  return session;
}

export const accessTokenFor = (userId: string, org: string, sid: string) => signAccessToken({ sub: userId, org, sid });
