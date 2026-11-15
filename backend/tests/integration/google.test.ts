import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AppError } from '../../src/lib/errors.js';
import { totp } from '../../src/lib/totp.js';
import { googleVerifier, type GoogleProfile } from '../../src/modules/auth/auth.service.js';
import { PASSWORD, api, getApp, registerUser, resetDb, uniqueEmail } from '../helpers.js';

/**
 * Google's signature verification is replaced by a test double: the real verifier needs network
 * access to Google's certificates. Everything after verification (account creation, linking,
 * MFA, cookies) runs for real.
 */
const asGoogle = (p: Partial<GoogleProfile> & { email: string }) =>
  vi.spyOn(googleVerifier, 'verify').mockResolvedValue({ sub: `g-${p.email}`, emailVerified: true, givenName: 'Gina', familyName: 'Google', ...p });

const google = async () => request(await getApp()).post('/api/v1/auth/google').send({ credential: 'x'.repeat(40) });

beforeAll(resetDb);
afterEach(() => vi.restoreAllMocks());

describe('Google sign-in', () => {
  it('creates a verified, password-less account on first sign-in', async () => {
    const email = uniqueEmail('g');
    asGoogle({ email, picture: 'https://lh3.googleusercontent.com/a/x' });
    const res = await google();
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, emailVerified: true, hasPassword: false, googleLinked: true });
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/HttpOnly/);
    // Password login is impossible for this account
    const pw = await request(await getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(pw.status).toBe(401);
    // Second Google sign-in is a login, not a new account
    expect((await google()).status).toBe(200);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('links Google to an existing password account with the same verified email', async () => {
    const u = await registerUser();
    asGoogle({ email: u.email });
    const res = await google();
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(u.userId);
    expect(res.body.data.user).toMatchObject({ hasPassword: true, googleLinked: true });
  });

  it('rejects Google accounts whose email is not verified', async () => {
    asGoogle({ email: uniqueEmail('unverified'), emailVerified: false });
    const res = await google();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GOOGLE_EMAIL_UNVERIFIED');
  });

  it('rejects invalid Google tokens', async () => {
    vi.spyOn(googleVerifier, 'verify').mockRejectedValue(new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Please try again.'));
    const res = await google();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('still requires the TOTP code when MFA is enabled', async () => {
    const u = await registerUser();
    const { secret } = (await api(u, 'post', '/auth/mfa/setup')).body.data;
    await api(u, 'post', '/auth/mfa/enable', { code: totp(secret) });
    asGoogle({ email: u.email });
    const res = await google();
    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('Google-only users can set a first password without a current password', async () => {
    const email = uniqueEmail('setpw');
    asGoogle({ email });
    const res = await google();
    const s = { token: res.body.data.accessToken };
    expect((await api(s, 'post', '/auth/change-password', { newPassword: 'Brand-new-passw0rd' })).status).toBe(200);
    expect((await request(await getApp()).post('/api/v1/auth/login').send({ email, password: 'Brand-new-passw0rd' })).status).toBe(200);
  });

  it('exposes only the public client id in /auth/config', async () => {
    const res = await request(await getApp()).get('/api/v1/auth/config');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['emailCodeLength', 'googleClientId']);
  });
});
