import type { Request } from 'express';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { invalidateMembership } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';
import { emails } from '../notifications/notify.js';

const SETUP_DAYS = 7;

/** An account created for someone (e.g. as a lecturer) who has not set a password or linked Google yet. */
export const isPlaceholderAccount = (u: { passwordHash: string | null; googleId: string | null }) => !u.passwordHash && !u.googleId;

export type ProvisionResult = {
  status: 'SETUP_EMAIL_SENT' | 'ADDED_EXISTING_ACCOUNT' | 'ALREADY_LINKED';
  userId: string;
  membershipId: string;
  _testToken?: string;
};

/**
 * Gives a lecturer record a sign-in account in its organization.
 *
 * - No account for the email → a placeholder account is created (no password, email unverified),
 *   joined to the organization with the Lecturer role, and emailed a single-use setup link.
 * - Existing account that was never set up → same, with a fresh setup link.
 * - Existing, active account (the person already uses NTSAttend, e.g. owns another organization)
 *   → joined to this organization with the Lecturer role and notified; nothing else changes.
 *
 * The account is one global identity: the same person can own their own organization(s) and act
 * as a lecturer here, switching between them. Membership in one organization never grants
 * anything in another.
 */
export async function provisionLecturerAccount(input: {
  organizationId: string;
  lecturerId: string;
  actorUserId: string | null;
  req?: Request;
  /** Re-send the setup email even if the account is already linked (placeholder accounts only). */
  resend?: boolean;
}): Promise<ProvisionResult> {
  const { organizationId, lecturerId } = input;
  const lecturer = await prisma.lecturer.findFirst({ where: { id: lecturerId, organizationId } });
  if (!lecturer) throw notFound('Lecturer');
  if (lecturer.status !== 'ACTIVE') throw badRequest('Archived lecturers cannot be given an account', 'LECTURER_ARCHIVED');
  const role = await prisma.role.findFirst({ where: { organizationId, key: 'lecturer' } });
  if (!role) throw notFound('Lecturer role');
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
  const email = lecturer.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.status !== 'ACTIVE') throw badRequest('The account for this email is suspended', 'ACCOUNT_SUSPENDED');

  const { account, membershipId, alreadyLinked } = await prisma.$transaction(async (tx) => {
    const account =
      existing ??
      (await tx.user.create({
        data: { email, firstName: lecturer.firstName, lastName: lecturer.lastName, phone: lecturer.phone, passwordHash: null, emailVerifiedAt: null },
      }));
    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: account.id } },
      create: { organizationId, userId: account.id },
      update: {},
    });
    const hasRole = await tx.membershipRole.findFirst({ where: { membershipId: membership.id, roleId: role.id } });
    if (!hasRole) await tx.membershipRole.create({ data: { organizationId, membershipId: membership.id, roleId: role.id, departmentId: null } });
    const alreadyLinked = lecturer.membershipId === membership.id;
    if (!alreadyLinked) await tx.lecturer.update({ where: { id: lecturer.id }, data: { membershipId: membership.id } });
    return { account, membershipId: membership.id, alreadyLinked };
  });
  await invalidateMembership(organizationId, account.id);

  if (isPlaceholderAccount(account)) {
    if (alreadyLinked && !input.resend) return { status: 'ALREADY_LINKED', userId: account.id, membershipId };
    // Single-use setup link: an invitation whose acceptance sets the password (the link proves email ownership).
    await prisma.invitation.updateMany({ where: { organizationId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const raw = randomToken(32);
    const inv = await prisma.invitation.create({
      data: {
        organizationId, email, roleId: role.id, departmentId: null, createLecturer: true, tokenHash: sha256(raw),
        invitedById: input.actorUserId ?? account.id, expiresAt: new Date(Date.now() + SETUP_DAYS * 86_400_000),
      },
    });
    await emails.lecturerAccountCreated(email, lecturer.firstName, org.name, raw);
    await audit({
      action: existing ? 'lecturer.account_setup_sent' : 'lecturer.account_created', organizationId, actorUserId: input.actorUserId ?? undefined,
      targetType: 'Lecturer', targetId: lecturer.id, metadata: { email, invitationId: inv.id }, req: input.req,
    });
    return { status: 'SETUP_EMAIL_SENT', userId: account.id, membershipId, ...(env.isTest ? { _testToken: raw } : {}) };
  }

  if (alreadyLinked) return { status: 'ALREADY_LINKED', userId: account.id, membershipId };
  await emails.addedToOrganization(email, account.firstName, org.name, role.name);
  await audit({ action: 'lecturer.account_linked', organizationId, actorUserId: input.actorUserId ?? undefined, targetType: 'Lecturer', targetId: lecturer.id, metadata: { email, userId: account.id }, req: input.req });
  return { status: 'ADDED_EXISTING_ACCOUNT', userId: account.id, membershipId };
}

/** Account state shown on the lecturer list. */
export type LecturerAccountState = 'NONE' | 'PENDING_SETUP' | 'ACTIVE' | 'SUSPENDED';
export function lecturerAccountState(m: { status: string; user: { passwordHash: string | null; googleId: string | null } } | null | undefined): LecturerAccountState {
  if (!m) return 'NONE';
  if (m.status !== 'ACTIVE') return 'SUSPENDED';
  return isPlaceholderAccount(m.user) ? 'PENDING_SETUP' : 'ACTIVE';
}
