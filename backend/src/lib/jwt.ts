import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

const ISSUER = 'nts-api';

export type AccessClaims = { sub: string; org: string | null; sid: string; typ: 'access' };
export type MfaClaims = { sub: string; typ: 'mfa' };
export type AttemptClaims = {
  typ: 'attempt';
  org: string;
  ses: string; // attendance session id
  qrt: string; // QR token id (not the raw token)
  stu?: string; // verified student id
};

export function signAccessToken(c: Omit<AccessClaims, 'typ'>) {
  return jwt.sign({ ...c, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
    audience: 'nts-app',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const c = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: 'nts-app' }) as AccessClaims;
    if (c.typ !== 'access') throw new Error('wrong type');
    return c;
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw unauthorized('Access token expired', 'TOKEN_EXPIRED');
    throw unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
}

export function signMfaToken(userId: string) {
  return jwt.sign({ sub: userId, typ: 'mfa' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: 300,
    issuer: ISSUER,
    audience: 'nts-mfa',
  });
}

export function verifyMfaToken(token: string): MfaClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: 'nts-mfa' }) as MfaClaims;
  } catch {
    throw unauthorized('MFA challenge expired. Please sign in again.', 'MFA_EXPIRED');
  }
}

/** Short-lived token chaining the anonymous public attendance steps together. */
export function signAttemptToken(c: Omit<AttemptClaims, 'typ'>, ttlSeconds = 900) {
  return jwt.sign({ ...c, typ: 'attempt' }, env.JWT_PUBLIC_SECRET, {
    algorithm: 'HS256',
    expiresIn: ttlSeconds,
    issuer: ISSUER,
    audience: 'nts-public-attendance',
  });
}

export function verifyAttemptToken(token: string | undefined): AttemptClaims {
  if (!token) throw unauthorized('Attendance verification has expired. Please scan the QR code again.', 'ATTEMPT_REQUIRED');
  try {
    const c = jwt.verify(token, env.JWT_PUBLIC_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: 'nts-public-attendance',
    }) as AttemptClaims;
    if (c.typ !== 'attempt') throw new Error('wrong type');
    return c;
  } catch {
    throw unauthorized('Attendance verification has expired. Please scan the QR code again.', 'ATTEMPT_INVALID');
  }
}
