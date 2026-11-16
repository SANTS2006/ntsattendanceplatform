import { classScopeWhere, eventScopeWhere, sessionScopeWhere } from '../attendance/access.js';
import type { Request } from 'express';
import type { OrganizationType, Prisma } from '@prisma/client';
import { SYSTEM_ROLES } from '../../config/permissions.js';
import { prisma } from '../../db/prisma.js';
import { cacheDel, cacheKeys } from '../../infra/cache.js';
import { imageStorage, tenantKey } from '../../infra/storage.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/jwt.js';
import { isValidTimeZone } from '../../lib/time.js';
import { env } from '../../config/env.js';
import type { TenantContext } from '../../middleware/context.js';
import { audit } from '../audit/audit.service.js';
import { processImage } from '../media/image.js';

export async function ensurePermissionCatalogue() {
  // Few round trips: the database may be far away (e.g. Neon from a developer laptop), and this
  // runs on every boot. Read once, insert what is missing, update only what changed.
  const { PERMISSIONS } = await import('../../config/permissions.js');
  const wanted = Object.entries(PERMISSIONS).map(([key, [group, description]]) => ({ key, group, description }));
  const existing = new Map((await prisma.permission.findMany({ select: { key: true, group: true, description: true } })).map((p) => [p.key, p]));
  const missing = wanted.filter((p) => !existing.has(p.key));
  const changed = wanted.filter((p) => {
    const e = existing.get(p.key);
    return e && (e.group !== p.group || e.description !== p.description);
  });
  if (missing.length) await prisma.permission.createMany({ data: missing, skipDuplicates: true });
  await syncSystemRolePermissions();
  if (changed.length) await prisma.$transaction(changed.map((p) => prisma.permission.update({ where: { key: p.key }, data: { group: p.group, description: p.description } })));
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';

export type CreateOrganizationInput = {
  name: string;
  type: OrganizationType;
  officialEmail: string;
  contactNumber?: string;
  country: string;
  address?: string;
  timezone: string;
  website?: string;
  description?: string;
};

/** Creates an organization, its settings, system roles and the owner membership atomically. */
export async function createOrganization(userId: string, familyId: string, input: CreateOrganizationInput, req: Request) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.emailVerifiedAt) throw forbidden('Verify your email address before creating an organization', 'EMAIL_NOT_VERIFIED');
  if (!isValidTimeZone(input.timezone)) throw badRequest('Unknown time zone', 'INVALID_TIMEZONE');
  const owned = await prisma.organizationMembership.count({ where: { userId, isOwner: true } });
  if (owned >= 20) throw forbidden('Organization limit reached for this account', 'ORG_LIMIT');

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permId = new Map(permissions.map((p) => [p.key, p.id]));

  const org = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { ...input, slug: `${slugify(input.name)}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`, createdById: userId },
    });
    const isEvent = input.type === 'EVENT_ORGANIZER';
    await tx.organizationSettings.create({
      data: { organizationId: org.id, requireEnrollment: !isEvent, selfieRequired: !isEvent },
    });
    for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
      await tx.role.create({
        data: {
          organizationId: org.id,
          key,
          name: def.name,
          description: def.description,
          isSystem: true,
          permissions: { create: def.permissions.filter((p) => permId.has(p)).map((p) => ({ permissionId: permId.get(p)! })) },
        },
      });
    }
    const adminRole = await tx.role.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: 'admin' } } });
    const membership = await tx.organizationMembership.create({
      data: { organizationId: org.id, userId, isOwner: true, title: 'Owner' },
    });
    await tx.membershipRole.create({ data: { organizationId: org.id, membershipId: membership.id, roleId: adminRole.id } });
    return org;
  });

  await prisma.refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { activeOrganizationId: org.id } });
  await audit({ action: 'organization.created', organizationId: org.id, actorUserId: userId, targetType: 'Organization', targetId: org.id, req });
  return {
    organization: org,
    accessToken: signAccessToken({ sub: userId, org: org.id, sid: familyId }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    activeOrganizationId: org.id,
  };
}

export async function getCurrent(ctx: TenantContext) {
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId } });
  if (!org) throw notFound('Organization');
  const logoUrl = org.logoKey ? await imageStorage.signedUrl(org.logoKey, 3600) : null;
  return { ...org, logoUrl, myPermissions: ctx.isOwner ? 'ALL' : ctx.permissionList(), isOwner: ctx.isOwner, lecturerId: ctx.lecturerId };
}

export async function updateCurrent(ctx: TenantContext, data: Partial<CreateOrganizationInput>, req: Request) {
  if (data.timezone && !isValidTimeZone(data.timezone)) throw badRequest('Unknown time zone', 'INVALID_TIMEZONE');
  // `type` is immutable after creation (it drives defaults); everything else is editable.
  const { type: _type, ...rest } = data;
  const org = await prisma.organization.update({ where: { id: ctx.organizationId }, data: rest });
  await cacheDel(cacheKeys.tenant(ctx.organizationId, 'settings'));
  await audit({ action: 'organization.updated', targetType: 'Organization', targetId: org.id, metadata: { fields: Object.keys(rest) }, req });
  return org;
}

export async function uploadLogo(ctx: TenantContext, file: Buffer | undefined, req: Request) {
  const img = await processImage(file, { maxDimension: 512, quality: 88 });
  const key = tenantKey(ctx.organizationId, 'logos', 'jpg');
  await imageStorage.put(key, img.buffer, img.contentType);
  const old = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { logoKey: true } });
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { logoKey: key } });
  if (old.logoKey) await imageStorage.delete(old.logoKey).catch(() => undefined);
  await audit({ action: 'organization.logo_updated', targetType: 'Organization', targetId: ctx.organizationId, req });
  return { logoUrl: await imageStorage.signedUrl(key, 3600) };
}

export async function removeLogo(ctx: TenantContext, req: Request) {
  const old = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { logoKey: true } });
  if (!old.logoKey) return { logoUrl: null };
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { logoKey: null } });
  await imageStorage.delete(old.logoKey).catch(() => undefined);
  await audit({ action: 'organization.logo_removed', targetType: 'Organization', targetId: ctx.organizationId, req });
  return { logoUrl: null };
}

export async function getSettings(ctx: TenantContext) {
  return ctx.db.organizationSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId } });
}

export async function updateSettings(ctx: TenantContext, data: Prisma.OrganizationSettingsUpdateInput & Record<string, unknown>, req: Request) {
  const current = await getSettings(ctx);
  const merged = { ...current, ...data } as typeof current;
  if (merged.studentIdExactLength == null && merged.studentIdMinLength > merged.studentIdMaxLength) {
    throw badRequest('Minimum length cannot exceed maximum length', 'INVALID_SETTINGS');
  }
  if (merged.studentIdCharset === 'CUSTOM' && !merged.studentIdCustomPattern) {
    throw badRequest('A custom character pattern is required for the CUSTOM charset', 'INVALID_SETTINGS');
  }
  const settings = await ctx.db.organizationSettings.update({ where: { organizationId: ctx.organizationId }, data });
  await cacheDel(cacheKeys.tenant(ctx.organizationId, 'settings'));
  await audit({ action: 'organization.settings_updated', targetType: 'OrganizationSettings', targetId: ctx.organizationId, metadata: { changes: data as Prisma.InputJsonValue }, req });
  return settings;
}

export async function overview(ctx: TenantContext) {
  const db = ctx.db;
  const since = new Date(Date.now() - 30 * 86_400_000);
  // Every figure is limited to what the caller's active role may see (department / assignment).
  const classScope = classScopeWhere(ctx);
  const eventScope = eventScopeWhere(ctx);
  const studentScope = ctx.scope('students.read');
  const studentWhere: Prisma.StudentWhereInput =
    studentScope === 'all' ? {} : Array.isArray(studentScope) ? { departmentId: { in: studentScope } }
      : { OR: [{ enrollments: { some: { status: 'ACTIVE', class: classScope ?? {} } } }, { eventEntries: { some: { event: eventScope ?? {} } } }] };
  const lecturerScope = ctx.scope('lecturers.read');
  const canSessions = ['attendance.read_all', 'attendance.read_assigned', 'attendance.sessions.create', 'attendance.sessions.manage_all'].some((p) => ctx.has(p as never));
  const sessionWhere = canSessions ? sessionScopeWhere(ctx, 'read') : { id: { in: [] as string[] } };
  const [students, lecturers, classes, events, activeSessions, records30, members] = await Promise.all([
    db.student.count({ where: { AND: [{ status: 'ACTIVE' }, studentWhere] } }),
    lecturerScope === null ? Promise.resolve(0) : db.lecturer.count({ where: { status: 'ACTIVE', ...(Array.isArray(lecturerScope) ? { departmentId: { in: lecturerScope } } : {}) } }),
    db.class.count({ where: { AND: [{ status: 'ACTIVE' }, classScope ?? {}] } }),
    db.event.count({ where: { AND: [{ status: 'ACTIVE' }, eventScope ?? {}] } }),
    db.attendanceSession.count({ where: { AND: [{ status: 'ACTIVE', expiresAt: { gt: new Date() } }, sessionWhere] } }),
    db.attendanceRecord.count({ where: { AND: [{ submittedAt: { gte: since }, status: { not: 'INVALIDATED' } }, canSessions ? { session: sessionWhere } : { id: { in: [] } }] } }),
    ctx.has('members.read') ? db.organizationMembership.count({ where: { status: 'ACTIVE' } }) : Promise.resolve(0),
  ]);
  return { students, lecturers, classes, events, activeSessions, attendanceLast30Days: records30, members };
}

export async function auditLogs(ctx: TenantContext, q: { page: number; pageSize: number; action?: string }) {
  const where = { organizationId: ctx.organizationId, ...(q.action ? { action: { startsWith: q.action } } : {}) };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const actorIds = [...new Set(items.map((i) => i.actorUserId).filter(Boolean))] as string[];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const byId = new Map(actors.map((a) => [a.id, a]));
  return {
    items: items.map((i) => ({ ...i, ip: undefined, actor: i.actorUserId ? byId.get(i.actorUserId) ?? null : null })),
    total,
  };
}

/**
 * Adds permissions introduced in SYSTEM_ROLES to existing organizations' built-in roles (never removes).
 * Roles whose permissions the organization has edited are skipped, so removals stick.
 */
export async function syncSystemRolePermissions() {
  const perms = new Map((await prisma.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
  const roles = await prisma.role.findMany({ where: { isSystem: true, permissionsCustomized: false }, select: { id: true, key: true, permissions: { select: { permissionId: true } } } });
  const rows: { roleId: string; permissionId: string }[] = [];
  for (const role of roles) {
    const def = SYSTEM_ROLES[role.key];
    if (!def) continue;
    const have = new Set(role.permissions.map((p) => p.permissionId));
    for (const key of def.permissions) {
      const id = perms.get(key);
      if (id && !have.has(id)) rows.push({ roleId: role.id, permissionId: id });
    }
  }
  if (rows.length) await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
}
