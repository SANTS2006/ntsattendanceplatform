import { isPlaceholderAccount } from '../lecturers/accounts.js';
import { invalidateMembership, resolveActiveRole } from '../../middleware/auth.js';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { OAuth2Client } from 'google-auth-library';
import { decrypt, encrypt, hmac, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, tooMany, unauthorized } from '../../lib/errors.js';
import { signAccessToken, signMfaToken, verifyMfaToken } from '../../lib/jwt.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp.js';
import { audit, securityEvent } from '../audit/audit.service.js';
import { emails } from '../notifications/notify.js';
import { storage, userKey } from '../../infra/storage.js';
import { processImage } from '../media/image.js';
import { dummyVerify, hashPassword, verifyPassword } from './password.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REFRESH_GRACE_MS = 20_000;

type Meta = { ip?: string; userAgent?: string; req?: Request };

export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  phone: u.phone,
  emailVerified: !!u.emailVerifiedAt,
  mfaEnabled: u.mfaEnabled,
  hasPassword: !!u.passwordHash,
  googleLinked: !!u.googleId,
  avatarUrl: u.avatarUrl,
  status: u.status,
  createdAt: u.createdAt,
});

async function createUserToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', ttlMinutes: number) {
  const raw = randomToken(32);
  await prisma.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.userToken.create({
    data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
  return raw;
}

async function consumeUserToken(raw: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
  const token = await prisma.userToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
    throw badRequest('This link is invalid or has expired', 'TOKEN_INVALID');
  }
  const res = await prisma.userToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (res.count !== 1) throw badRequest('This link is invalid or has expired', 'TOKEN_INVALID');
  return token;
}

// ── Sign-up with an emailed verification code ────────────────────────────────
// The User row is only created after the 6-character code is confirmed.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L look-alikes
const CODE_TTL_MS = 10 * 60_000;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS = 5;

export function generateCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) {
    if (b >= 248) continue; // 248 = 31*8: rejection sampling keeps the distribution uniform
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (out.length === length) break;
  }
  return out.length === length ? out : generateCode(length);
}
const codeHash = (email: string, code: string) => hmac(`registration:${email}:${code.toUpperCase()}`);

type RegistrationStart = { email: string; expiresAt: Date; resendAvailableAt: Date; _testCode?: string };

export async function startRegistration(
  input: { email: string; password: string; firstName: string; lastName: string; phone?: string; acceptTerms: true },
  meta: Meta,
): Promise<RegistrationStart> {
  const email = input.email.toLowerCase();
  const now = Date.now();
  const response = (code?: string): RegistrationStart => ({
    email,
    expiresAt: new Date(now + CODE_TTL_MS),
    resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS),
    ...(env.isTest && code ? { _testCode: code } : {}),
  });
  // Existing account: identical response, but the email says "sign in instead" (no enumeration).
  // Exception: an account an organization created for this person (e.g. as a lecturer) that was
  // never set up — they may register it themselves; verifying the emailed code completes it and
  // keeps every membership it already has.
  const existing = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true, googleId: true } });
  if (existing && !isPlaceholderAccount(existing)) {
    await emails.accountExists(email);
    return response();
  }
  const code = generateCode();
  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    passwordHash: await hashPassword(input.password),
    codeHash: codeHash(email, code),
    attempts: 0,
    expiresAt: new Date(now + CODE_TTL_MS),
    lastSentAt: new Date(now),
    termsAcceptedAt: new Date(now),
  };
  await prisma.pendingRegistration.upsert({ where: { email }, create: { email, ...data, sendCount: 1 }, update: { ...data, sendCount: 1 } });
  await emails.registrationCode(email, input.firstName, code);
  await audit({ action: 'auth.registration_started', actorType: 'PUBLIC', metadata: { email }, req: meta.req });
  return response(code);
}

export async function resendRegistrationCode(emailRaw: string): Promise<RegistrationStart> {
  const email = emailRaw.toLowerCase();
  const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
  const now = Date.now();
  if (!pending) return { email, expiresAt: new Date(now + CODE_TTL_MS), resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS) };
  const wait = pending.lastSentAt.getTime() + RESEND_COOLDOWN_MS - now;
  if (wait > 0) throw tooMany(`Please wait ${Math.ceil(wait / 1000)} seconds before requesting another code.`, 'RESEND_COOLDOWN');
  if (pending.sendCount >= MAX_SENDS) {
    await prisma.pendingRegistration.delete({ where: { email } });
    throw tooMany('Too many codes requested. Please start the sign-up again.', 'TOO_MANY_CODES');
  }
  const code = generateCode();
  await prisma.pendingRegistration.update({
    where: { email },
    data: { codeHash: codeHash(email, code), attempts: 0, expiresAt: new Date(now + CODE_TTL_MS), lastSentAt: new Date(now), sendCount: { increment: 1 } },
  });
  await emails.registrationCode(email, pending.firstName, code);
  return { email, expiresAt: new Date(now + CODE_TTL_MS), resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS), ...(env.isTest ? { _testCode: code } : {}) };
}

export async function verifyRegistration(emailRaw: string, codeRaw: string, meta: Meta) {
  const email = emailRaw.toLowerCase();
  const code = codeRaw.trim().toUpperCase();
  const invalid = () => badRequest('That code is incorrect or has expired.', 'CODE_INVALID');
  const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
  if (!pending) throw invalid();
  if (pending.expiresAt < new Date()) {
    await prisma.pendingRegistration.delete({ where: { email } }).catch(() => undefined);
    throw badRequest('That code has expired. Request a new one.', 'CODE_EXPIRED');
  }
  if (!safeEqual(pending.codeHash, codeHash(email, code))) {
    const attempts = pending.attempts + 1;
    if (attempts >= CODE_MAX_ATTEMPTS) {
      await prisma.pendingRegistration.delete({ where: { email } });
      throw tooMany('Too many incorrect codes. Please start the sign-up again.', 'TOO_MANY_ATTEMPTS');
    }
    await prisma.pendingRegistration.update({ where: { email }, data: { attempts } });
    throw badRequest(`That code is incorrect. ${CODE_MAX_ATTEMPTS - attempts} attempt(s) left.`, 'CODE_INVALID', { attemptsLeft: CODE_MAX_ATTEMPTS - attempts });
  }
  // Atomically consume the pending registration and create the verified account.
  const user = await prisma.$transaction(async (tx) => {
    const claimed = await tx.pendingRegistration.deleteMany({ where: { id: pending.id } });
    if (claimed.count !== 1) throw invalid();
    const current = await tx.user.findUnique({ where: { email } });
    if (current && !isPlaceholderAccount(current)) throw conflict('An account with this email already exists. Please sign in.', 'EMAIL_TAKEN');
    if (current) {
      // Complete the account an organization created for this person; memberships are untouched.
      return tx.user.update({
        where: { id: current.id },
        data: {
          firstName: pending.firstName, lastName: pending.lastName, phone: pending.phone ?? current.phone,
          passwordHash: pending.passwordHash, passwordChangedAt: new Date(), emailVerifiedAt: current.emailVerifiedAt ?? new Date(), termsAcceptedAt: pending.termsAcceptedAt,
        },
      });
    }
    return tx.user.create({
      data: {
        email, firstName: pending.firstName, lastName: pending.lastName, phone: pending.phone,
        passwordHash: pending.passwordHash, emailVerifiedAt: new Date(), termsAcceptedAt: pending.termsAcceptedAt,
      },
    });
  });
  await audit({ action: 'auth.register', actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req: meta.req });
  return issueSession(user, null, meta);
}

// ── Google sign-in / sign-up ────────────────────────────────────────────────

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; givenName?: string; familyName?: string; picture?: string };

/** Replaceable in tests. Verifies the Google ID token signature, audience, issuer and expiry. */
export const googleVerifier = {
  client: null as OAuth2Client | null,
  async verify(idToken: string): Promise<GoogleProfile> {
    if (!env.GOOGLE_CLIENT_ID) throw badRequest('Google sign-in is not configured', 'GOOGLE_DISABLED');
    this.client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
    let payload;
    try {
      payload = (await this.client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })).getPayload();
    } catch {
      throw unauthorized('Google sign-in failed. Please try again.', 'GOOGLE_TOKEN_INVALID');
    }
    if (!payload?.sub || !payload.email) throw unauthorized('Google sign-in failed. Please try again.', 'GOOGLE_TOKEN_INVALID');
    return {
      sub: payload.sub, email: payload.email.toLowerCase(), emailVerified: !!payload.email_verified,
      givenName: payload.given_name, familyName: payload.family_name, picture: payload.picture,
    };
  },
};

export async function googleSignIn(credential: string, meta: Meta) {
  const g = await googleVerifier.verify(credential);
  if (!g.emailVerified) throw forbidden('Your Google account email is not verified.', 'GOOGLE_EMAIL_UNVERIFIED');
  let user = await prisma.user.findUnique({ where: { googleId: g.sub } });
  let created = false;
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: g.email } });
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== g.sub) throw forbidden('This email is linked to a different Google account.', 'GOOGLE_ACCOUNT_MISMATCH');
      // Google has verified ownership of this email, which is the same proof our email code gives.
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: g.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(), avatarUrl: byEmail.avatarUrl ?? g.picture ?? null },
      });
      await audit({ action: 'auth.google_linked', actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req: meta.req });
    } else {
      user = await prisma.user.create({
        data: {
          email: g.email, googleId: g.sub, firstName: g.givenName ?? g.email.split('@')[0], lastName: g.familyName ?? '',
          avatarUrl: g.picture ?? null, emailVerifiedAt: new Date(), passwordHash: null, termsAcceptedAt: new Date(),
        },
      });
      created = true;
      await audit({ action: 'auth.register_google', actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req: meta.req });
    }
  }
  if (user.status !== 'ACTIVE') throw forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  if (user.mfaEnabled) return { mfaRequired: true as const, mfaToken: signMfaToken(user.id), created };
  return { ...(await completeLogin(user, meta)), created };
}

/** Picks the requested org (if member) or the user's first active membership. */
async function resolveActiveOrg(userId: string, preferred: string | null): Promise<string | null> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (preferred && memberships.some((m) => m.organizationId === preferred)) return preferred;
  return memberships[0]?.organizationId ?? null;
}

export async function issueSession(user: User, preferredOrg: string | null, meta: Meta, familyId?: string) {
  const org = await resolveActiveOrg(user.id, preferredOrg);
  const raw = randomToken(48);
  const family = familyId ?? crypto.randomUUID();
  const rt = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      familyId: family,
      tokenHash: sha256(raw),
      activeOrganizationId: org,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, org, sid: rt.familyId }),
    refreshToken: raw,
    refreshTokenId: rt.id,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: publicUser(user),
    activeOrganizationId: org,
  };
}

export async function login(input: { email: string; password: string }, meta: Meta) {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const record = (success: boolean, reason?: string) =>
    prisma.loginAttempt.create({
      data: { email, userId: user?.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), success, reason },
    });

  if (!user) {
    await dummyVerify(input.password);
    await record(false, 'unknown_email');
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await record(false, 'locked');
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Your account is temporarily locked. Try again later or reset your password.',
    );
  }
  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined },
    });
    await record(false, 'bad_password');
    if (lock) {
      await securityEvent({
        type: 'auth.account_locked',
        severity: 'MEDIUM',
        description: `Account locked after ${MAX_FAILED} failed sign-in attempts`,
        userId: user.id,
        req: meta.req,
      });
    }
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'ACTIVE') {
    await record(false, 'inactive');
    throw forbidden('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  }
  await detectSuspiciousLogin(user, meta);
  if (user.mfaEnabled) {
    await record(true, 'mfa_pending');
    return { mfaRequired: true as const, mfaToken: signMfaToken(user.id) };
  }
  return completeLogin(user, meta);
}

async function completeLogin(user: User, meta: Meta) {
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await prisma.loginAttempt.create({ data: { email: user.email, userId: user.id, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300), success: true } });
  await audit({ action: 'auth.login', actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req: meta.req });
  return { mfaRequired: false as const, ...(await issueSession(user, null, meta)) };
}

/** Flags bursts of failures across many IPs and first-time sign-ins from a new network. */
async function detectSuspiciousLogin(user: User, meta: Meta) {
  const since = new Date(Date.now() - 60 * 60_000);
  const failures = await prisma.loginAttempt.findMany({
    where: { userId: user.id, success: false, createdAt: { gte: since } },
    select: { ip: true },
  });
  const ips = new Set(failures.map((f) => f.ip));
  if (ips.size >= 3) {
    await securityEvent({
      type: 'auth.distributed_failures',
      severity: 'HIGH',
      description: `Failed sign-ins from ${ips.size} different addresses within an hour before a successful sign-in`,
      userId: user.id,
      req: meta.req,
    });
  }
  if (meta.ip && user.lastLoginAt) {
    const seen = await prisma.loginAttempt.count({ where: { userId: user.id, success: true, ip: meta.ip } });
    if (seen === 0) {
      await securityEvent({ type: 'auth.new_network', severity: 'LOW', description: 'Sign-in from a previously unseen network', userId: user.id, req: meta.req });
    }
  }
}

export async function verifyMfaLogin(mfaToken: string, code: string, meta: Meta) {
  const claims = verifyMfaToken(mfaToken);
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.mfaEnabled || !user.mfaSecret || user.status !== 'ACTIVE') throw unauthorized('Invalid MFA challenge', 'MFA_INVALID');
  if (!verifyTotp(decrypt(user.mfaSecret), code)) {
    await prisma.loginAttempt.create({ data: { email: user.email, userId: user.id, ip: meta.ip, success: false, reason: 'bad_mfa' } });
    throw unauthorized('Invalid verification code', 'MFA_INVALID');
  }
  return completeLogin(user, meta);
}

/**
 * Refresh token rotation with reuse detection: presenting an already-rotated token revokes the
 * whole token family (the legitimate user must sign in again) and records a security event.
 */
export async function refresh(raw: string | undefined, meta: Meta) {
  if (!raw) throw unauthorized('Session expired', 'REFRESH_REQUIRED');
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!token) throw unauthorized('Session expired', 'REFRESH_INVALID');
  // Concurrency grace: two tabs (or a reload racing an in-flight refresh) can present the same
  // cookie within moments. A token rotated less than REFRESH_GRACE_MS ago is treated as a
  // legitimate concurrent request and gets its own successor in the same family. Outside the
  // window, presenting a rotated token is reuse and revokes the family.
  const inGrace =
    token.revokedAt && token.revokedReason === 'rotated' && Date.now() - token.revokedAt.getTime() < REFRESH_GRACE_MS;
  if (inGrace) {
    const family = await prisma.refreshToken.count({ where: { familyId: token.familyId, revokedReason: { in: ['reuse_detected', 'logout', 'user_revoked', 'password_reset', 'password_changed', 'platform_suspension'] } } });
    if (family === 0 && token.expiresAt > new Date() && token.user.status === 'ACTIVE') {
      return issueSession(token.user, token.activeOrganizationId, meta, token.familyId);
    }
  }
  if (token.revokedAt) {
    if (token.replacedById) {
      await prisma.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'reuse_detected' },
      });
      await securityEvent({
        type: 'auth.refresh_token_reuse',
        severity: 'HIGH',
        description: 'A rotated refresh token was presented again; the session family was revoked',
        userId: token.userId,
        req: meta.req,
      });
    }
    throw unauthorized('Session expired', 'REFRESH_REVOKED');
  }
  if (token.expiresAt < new Date() || token.user.status !== 'ACTIVE') throw unauthorized('Session expired', 'REFRESH_EXPIRED');

  const next = await issueSession(token.user, token.activeOrganizationId, meta, token.familyId);
  // Atomic compare-and-set: only one concurrent refresh can rotate a given token.
  const rotated = await prisma.refreshToken.updateMany({
    where: { id: token.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'rotated', replacedById: next.refreshTokenId, lastUsedAt: new Date() },
  });
  if (rotated.count !== 1) {
    await prisma.refreshToken.update({ where: { id: next.refreshTokenId }, data: { revokedAt: new Date(), revokedReason: 'race' } });
    throw unauthorized('Session expired', 'REFRESH_REVOKED');
  }
  return next;
}

export async function logout(raw: string | undefined) {
  if (!raw) return;
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!token) return;
  await prisma.refreshToken.updateMany({ where: { familyId: token.familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'logout' } });
}

export async function revokeAllSessions(userId: string, reason: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
}

export async function listSessions(userId: string, currentFamily: string) {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: { familyId: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
  });
  return tokens.map((t) => ({ ...t, id: t.familyId, current: t.familyId === currentFamily }));
}

export async function revokeSession(userId: string, familyId: string) {
  const res = await prisma.refreshToken.updateMany({
    where: { userId, familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'user_revoked' },
  });
  return res.count;
}

export async function verifyEmail(raw: string) {
  const token = await consumeUserToken(raw, 'EMAIL_VERIFICATION');
  await prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
  await audit({ action: 'auth.email_verified', actorUserId: token.userId, actorType: 'USER', targetType: 'User', targetId: token.userId });
}

export async function resendVerification(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const token = await createUserToken(user.id, 'EMAIL_VERIFICATION', 24 * 60);
  await emails.verify(user.email, user.firstName, token);
}

/** Always succeeds from the caller's perspective (no account enumeration). */
export async function forgotPassword(emailRaw: string, meta: Meta) {
  const user = await prisma.user.findUnique({ where: { email: emailRaw.toLowerCase() } });
  if (!user || user.status !== 'ACTIVE') return;
  const token = await createUserToken(user.id, 'PASSWORD_RESET', 30);
  await emails.reset(user.email, user.firstName, token);
  await audit({ action: 'auth.password_reset_requested', actorUserId: user.id, actorType: 'USER', targetType: 'User', targetId: user.id, req: meta.req });
}

export async function resetPassword(raw: string, password: string, meta: Meta) {
  const token = await consumeUserToken(raw, 'PASSWORD_RESET');
  await prisma.user.update({
    where: { id: token.userId },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
  });
  // The reset link was delivered to the address, which proves ownership (completes accounts that
  // an organization created and the person set up via "Forgot password").
  await prisma.user.updateMany({ where: { id: token.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  await revokeAllSessions(token.userId, 'password_reset');
  await audit({ action: 'auth.password_reset', actorUserId: token.userId, actorType: 'USER', targetType: 'User', targetId: token.userId, req: meta.req });
}

export async function changePassword(userId: string, current: string | undefined, next: string, keepFamily: string, meta: Meta) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, current ?? ''))) throw badRequest('Current password is incorrect', 'INVALID_PASSWORD');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, NOT: { familyId: keepFamily } },
    data: { revokedAt: new Date(), revokedReason: 'password_changed' },
  });
  await audit({ action: 'auth.password_changed', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, req: meta.req });
}

export async function me(userId: string, activeOrg: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      platformAdmin: true,
      emailChange: { select: { newEmail: true, expiresAt: true, lastSentAt: true } },
      memberships: {
        where: { status: 'ACTIVE' },
        include: {
          organization: { select: { id: true, name: true, slug: true, type: true, status: true, logoKey: true, timezone: true } },
          roles: { include: { role: { select: { key: true, name: true } }, department: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
          lecturer: { select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Account not available', 'ACCOUNT_INACTIVE');
  const pending = user.emailChange && user.emailChange.expiresAt > new Date() ? user.emailChange : null;
  return {
    user: { ...publicUser(user), avatarUrl: await avatarUrlFor(user) },
    pendingEmailChange: pending ? { newEmail: pending.newEmail, expiresAt: pending.expiresAt, resendAvailableAt: new Date(pending.lastSentAt.getTime() + RESEND_COOLDOWN_MS) } : null,
    platformRole: user.platformAdmin?.role ?? null,
    activeOrganizationId: activeOrg,
    organizations: user.memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      type: m.organization.type,
      status: m.organization.status,
      timezone: m.organization.timezone,
      isOwner: m.isOwner,
      isLecturer: !!m.lecturer,
      roles: m.roles.map((r) => ({ key: r.role.key, name: r.role.name })),
      // Roles the member can act as; exactly one is active at a time.
      roleOptions: [
        ...(m.isOwner ? [{ id: 'owner', key: 'owner', name: 'Owner', department: null as string | null }] : []),
        ...m.roles.map((r) => ({ id: r.id, key: r.role.key, name: r.role.name, department: r.department?.name ?? null })),
      ],
      activeRole: resolveActiveRole(m.isOwner, m.roles.map((r) => r.id), m.activeRole),
    })),
  };
}

export async function switchOrganization(userId: string, familyId: string, organizationId: string) {
  const m = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: { select: { status: true } } },
  });
  if (!m || m.status !== 'ACTIVE') throw forbidden('You are not a member of this organization', 'NOT_A_MEMBER');
  if (m.organization.status !== 'ACTIVE') throw forbidden('This organization is suspended or deactivated', 'ORGANIZATION_INACTIVE');
  await prisma.refreshToken.updateMany({ where: { userId, familyId, revokedAt: null }, data: { activeOrganizationId: organizationId } });
  return { accessToken: signAccessToken({ sub: userId, org: organizationId, sid: familyId }), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, activeOrganizationId: organizationId };
}

export async function mfaSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabled) throw conflict('MFA is already enabled', 'MFA_ALREADY_ENABLED');
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecret: encrypt(secret) } });
  return { secret, otpauthUri: otpauthUri(secret, user.email) };
}

export async function mfaEnable(userId: string, code: string, req: Request) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecret) throw badRequest('Start MFA setup first', 'MFA_NOT_STARTED');
  if (!verifyTotp(decrypt(user.mfaSecret), code)) throw badRequest('Invalid verification code', 'MFA_INVALID');
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  await audit({ action: 'auth.mfa_enabled', actorUserId: userId, targetType: 'User', targetId: userId, req });
}

export async function mfaDisable(userId: string, password: string, code: string, req: Request) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabled || !user.mfaSecret) throw badRequest('MFA is not enabled', 'MFA_NOT_ENABLED');
  if ((user.passwordHash && !(await verifyPassword(user.passwordHash, password))) || !verifyTotp(decrypt(user.mfaSecret), code)) {
    throw badRequest('Invalid password or verification code', 'MFA_INVALID');
  }
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
  await audit({ action: 'auth.mfa_disabled', actorUserId: userId, targetType: 'User', targetId: userId, req });
}

export async function updateProfile(userId: string, data: { firstName?: string; lastName?: string; phone?: string | null }) {
  const user = await prisma.user.update({ where: { id: userId }, data });
  return { ...publicUser(user), avatarUrl: await avatarUrlFor(user) };
}

// ── Profile picture ─────────────────────────────────────────────────────────

/** Uploaded picture (private Cloudinary asset, signed URL) takes priority over the Google photo. */
export async function avatarUrlFor(user: Pick<User, 'avatarKey' | 'avatarUrl'>) {
  if (user.avatarKey) return storage.signedUrl(user.avatarKey, 6 * 3600).catch(() => user.avatarUrl ?? null);
  return user.avatarUrl ?? null;
}

export async function uploadAvatar(userId: string, file: Buffer | undefined, req: Request) {
  const img = await processImage(file, { maxDimension: 512, minDimension: 64, quality: 86 });
  const key = userKey(userId, 'avatars', 'jpg');
  await storage.put(key, img.buffer, img.contentType);
  const prev = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarKey: true } });
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
  if (prev.avatarKey) await storage.delete(prev.avatarKey).catch(() => undefined);
  await audit({ action: 'auth.avatar_updated', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, req });
  return { avatarUrl: await avatarUrlFor(user) };
}

export async function removeAvatar(userId: string, req: Request) {
  const prev = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarKey: true } });
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarKey: null } });
  if (prev.avatarKey) await storage.delete(prev.avatarKey).catch(() => undefined);
  await audit({ action: 'auth.avatar_removed', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, req });
  return { avatarUrl: await avatarUrlFor(user) };
}

// ── Email change with a 6-character code sent to the NEW address ─────────────

const emailChangeHash = (userId: string, email: string, code: string) => hmac(`email-change:${userId}:${email}:${code.toUpperCase()}`);

export async function startEmailChange(userId: string, input: { newEmail: string; password?: string }, req: Request) {
  const newEmail = input.newEmail.toLowerCase();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (newEmail === user.email) throw badRequest('That is already your email address', 'SAME_EMAIL', { newEmail: ['That is already your email address'] });
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, input.password ?? ''))) {
    throw badRequest('Your current password is incorrect', 'INVALID_PASSWORD', { password: ['Your current password is incorrect'] });
  }
  if (await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
    throw conflict('Another account already uses this email address', 'EMAIL_TAKEN');
  }
  const existing = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (existing && existing.newEmail === newEmail && existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS > Date.now()) {
    throw tooMany('A code was just sent. Please wait a minute before requesting another.', 'RESEND_COOLDOWN');
  }
  const code = generateCode();
  const now = Date.now();
  const data = { newEmail, codeHash: emailChangeHash(userId, newEmail, code), attempts: 0, expiresAt: new Date(now + CODE_TTL_MS), lastSentAt: new Date(now) };
  await prisma.emailChangeRequest.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await emails.emailChangeCode(newEmail, user.firstName, code);
  await emails.emailChangeAlert(user.email, user.firstName, newEmail);
  await audit({ action: 'auth.email_change_requested', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, metadata: { newEmail }, req });
  return { newEmail, expiresAt: data.expiresAt, resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS), ...(env.isTest ? { _testCode: code } : {}) };
}

export async function resendEmailChange(userId: string, req: Request) {
  const pending = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!pending) throw badRequest('There is no pending email change', 'NO_PENDING_CHANGE');
  const wait = pending.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now();
  if (wait > 0) throw tooMany(`Please wait ${Math.ceil(wait / 1000)} seconds before requesting another code.`, 'RESEND_COOLDOWN');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const code = generateCode();
  const now = Date.now();
  await prisma.emailChangeRequest.update({
    where: { userId },
    data: { codeHash: emailChangeHash(userId, pending.newEmail, code), attempts: 0, expiresAt: new Date(now + CODE_TTL_MS), lastSentAt: new Date(now) },
  });
  await emails.emailChangeCode(pending.newEmail, user.firstName, code);
  await audit({ action: 'auth.email_change_resent', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, req });
  return { newEmail: pending.newEmail, expiresAt: new Date(now + CODE_TTL_MS), resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS), ...(env.isTest ? { _testCode: code } : {}) };
}

export async function confirmEmailChange(userId: string, codeRaw: string, req: Request) {
  const pending = await prisma.emailChangeRequest.findUnique({ where: { userId } });
  if (!pending) throw badRequest('There is no pending email change', 'NO_PENDING_CHANGE');
  if (pending.expiresAt < new Date()) {
    await prisma.emailChangeRequest.delete({ where: { userId } });
    throw badRequest('That code has expired. Start the change again.', 'CODE_EXPIRED');
  }
  if (!safeEqual(pending.codeHash, emailChangeHash(userId, pending.newEmail, codeRaw.trim()))) {
    const attempts = pending.attempts + 1;
    if (attempts >= CODE_MAX_ATTEMPTS) {
      await prisma.emailChangeRequest.delete({ where: { userId } });
      throw tooMany('Too many incorrect codes. Start the change again.', 'TOO_MANY_ATTEMPTS');
    }
    await prisma.emailChangeRequest.update({ where: { userId }, data: { attempts } });
    throw badRequest(`That code is incorrect. ${CODE_MAX_ATTEMPTS - attempts} attempt(s) left.`, 'CODE_INVALID', { attemptsLeft: CODE_MAX_ATTEMPTS - attempts });
  }
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true } });
  const user = await prisma.$transaction(async (tx) => {
    await tx.emailChangeRequest.delete({ where: { userId } });
    if (await tx.user.findFirst({ where: { email: pending.newEmail, NOT: { id: userId } }, select: { id: true } })) {
      throw conflict('Another account already uses this email address', 'EMAIL_TAKEN');
    }
    return tx.user.update({ where: { id: userId }, data: { email: pending.newEmail, emailVerifiedAt: new Date() } });
  });
  await emails.emailChanged(before.email, before.firstName, pending.newEmail);
  await audit({ action: 'auth.email_changed', actorUserId: userId, actorType: 'USER', targetType: 'User', targetId: userId, metadata: { from: before.email, to: pending.newEmail }, req });
  return { ...publicUser(user), avatarUrl: await avatarUrlFor(user) };
}

export async function cancelEmailChange(userId: string) {
  await prisma.emailChangeRequest.deleteMany({ where: { userId } });
}

/** Act as one of the member's roles (or "owner"). Only that role's permissions apply afterwards. */
export async function switchRole(userId: string, organizationId: string, role: string, req: Request) {
  const m = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { roles: { select: { id: true } } },
  });
  if (!m || m.status !== 'ACTIVE') throw forbidden('You are not a member of this organization', 'NOT_A_MEMBER');
  const allowed = role === 'owner' ? m.isOwner : m.roles.some((r) => r.id === role);
  if (!allowed) throw badRequest('You do not hold this role', 'INVALID_ROLE');
  const from = resolveActiveRole(m.isOwner, m.roles.map((r) => r.id), m.activeRole);
  await prisma.organizationMembership.update({ where: { id: m.id }, data: { activeRole: role } });
  await invalidateMembership(organizationId, userId);
  await audit({ action: 'member.role_switched', organizationId, targetType: 'Membership', targetId: m.id, metadata: { from, to: role }, req });
  return { activeRole: role };
}
