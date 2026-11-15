import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { testOutbox } from '../../src/infra/mailer.js';
import { drainInlineJobs } from '../../src/infra/queue.js';
import { totp } from '../../src/lib/totp.js';
import { PASSWORD, api, createOrg, getApp, registerUser, resetDb, uniqueEmail } from '../helpers.js';

beforeAll(resetDb);

const refresh = async (cookie: string) => request(await getApp()).post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]).set('X-NTS-CSRF', '1');

describe('registration and login', () => {
  it('emails a 6-character code and only creates the account once it is verified', async () => {
    const a = await getApp();
    const email = uniqueEmail('reg');
    const start = await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'Ada', lastName: 'B', acceptTerms: true });
    expect(start.status).toBe(202);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull(); // no account yet
    await drainInlineJobs();
    const mail = testOutbox().filter((m) => m.to === email).pop()!;
    const code = /^\s{4}([A-Z0-9]{6})$/m.exec(mail.text)![1];
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/); // no ambiguous 0/O/1/I/L
    expect(mail.subject).toContain(code);
    const pending = await prisma.pendingRegistration.findUniqueOrThrow({ where: { email } });
    expect(pending.codeHash).not.toContain(code); // only a keyed hash is stored

    const res = await request(a).post('/api/v1/auth/register/verify').send({ email, code: code.toLowerCase() });
    expect(res.status).toBe(201);
    expect(res.body.data.user.emailVerified).toBe(true);
    expect(res.body.data.refreshToken).toBeUndefined(); // only in HttpOnly cookie
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(await prisma.pendingRegistration.findUnique({ where: { email } })).toBeNull();
    // Code is single use
    expect((await request(a).post('/api/v1/auth/register/verify').send({ email, code })).status).toBe(400);
  });

  it('requires agreeing to the Terms and Privacy Policy and records it', async () => {
    const a = await getApp();
    const email = uniqueEmail('terms');
    const no = await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'A', lastName: 'B' });
    expect(no.status).toBe(422);
    expect(JSON.stringify(no.body.errors)).toMatch(/Terms of Service/);
    const u = await registerUser({ email });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('counts wrong codes down and discards the sign-up after 5 attempts', async () => {
    const a = await getApp();
    const email = uniqueEmail('wrong');
    await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'A', lastName: 'B', acceptTerms: true });
    const first = await request(a).post('/api/v1/auth/register/verify').send({ email, code: 'ZZZZZZ' });
    expect(first.body.code).toBe('CODE_INVALID');
    expect(first.body.errors.attemptsLeft).toBe(4);
    for (let i = 0; i < 3; i++) await request(a).post('/api/v1/auth/register/verify').send({ email, code: 'ZZZZZZ' });
    const last = await request(a).post('/api/v1/auth/register/verify').send({ email, code: 'ZZZZZZ' });
    expect(last.status).toBe(429);
    expect(await prisma.pendingRegistration.findUnique({ where: { email } })).toBeNull();
  });

  it('expires codes and enforces a resend cooldown', async () => {
    const a = await getApp();
    const email = uniqueEmail('exp');
    const start = await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'A', lastName: 'B', acceptTerms: true });
    expect((await request(a).post('/api/v1/auth/register/resend').send({ email })).body.code).toBe('RESEND_COOLDOWN');
    await prisma.pendingRegistration.update({ where: { email }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const resent = await request(a).post('/api/v1/auth/register/resend').send({ email });
    expect(resent.status).toBe(200);
    expect(resent.body.data._testCode).not.toBe(start.body.data._testCode);
    // the previous code no longer works
    expect((await request(a).post('/api/v1/auth/register/verify').send({ email, code: start.body.data._testCode })).status).toBe(400);
    await prisma.pendingRegistration.update({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(a).post('/api/v1/auth/register/verify').send({ email, code: resent.body.data._testCode })).body.code).toBe('CODE_EXPIRED');
  });

  it('does not reveal whether an email is registered and rejects weak passwords', async () => {
    const a = await getApp();
    expect((await request(a).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: 'short', firstName: 'A', lastName: 'B', acceptTerms: true })).status).toBe(422);
    const u = await registerUser();
    const dup = await request(a).post('/api/v1/auth/register').send({ email: u.email, password: PASSWORD, firstName: 'A', lastName: 'B', acceptTerms: true });
    const fresh = await request(a).post('/api/v1/auth/register').send({ email: uniqueEmail(), password: PASSWORD, firstName: 'A', lastName: 'B', acceptTerms: true });
    expect(dup.status).toBe(fresh.status);
    expect(Object.keys(dup.body.data).filter((k) => k !== '_testCode').sort()).toEqual(Object.keys(fresh.body.data).filter((k) => k !== '_testCode').sort());
    await drainInlineJobs();
    expect(testOutbox().filter((m) => m.to === u.email).pop()!.text).toMatch(/already exists/);
  });

  it('rejects invalid credentials with a generic message and locks after repeated failures', async () => {
    const u = await registerUser();
    const a = await getApp();
    const bad = await request(a).post('/api/v1/auth/login').send({ email: u.email, password: 'Wrong-passw0rd' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(a).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'Wrong-passw0rd' });
    expect(unknown.body.message).toBe(bad.body.message);
    for (let i = 0; i < 4; i++) await request(a).post('/api/v1/auth/login').send({ email: u.email, password: 'Wrong-passw0rd' });
    const locked = await request(a).post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(await prisma.securityEvent.count({ where: { userId: u.userId, type: 'auth.account_locked' } })).toBe(1);
  });

  it('rejects expired, malformed and wrongly-signed access tokens', async () => {
    const u = await registerUser();
    const expired = jwt.sign({ sub: u.userId, org: null, sid: 'x', typ: 'access' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: -10, issuer: 'nts-api', audience: 'nts-app' });
    const r1 = await api({ token: expired }, 'get', '/auth/me');
    expect(r1.status).toBe(401);
    expect(r1.body.code).toBe('TOKEN_EXPIRED');
    const forged = jwt.sign({ sub: u.userId, org: null, sid: 'x', typ: 'access' }, 'not-the-secret-not-the-secret-123456', { issuer: 'nts-api', audience: 'nts-app' });
    expect((await api({ token: forged }, 'get', '/auth/me')).status).toBe(401);
    expect((await api(null, 'get', '/auth/me')).status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates, and detects reuse by revoking the whole family', async () => {
    const u = await registerUser();
    const r1 = await refresh(u.cookie);
    expect(r1.status).toBe(200);
    const newCookie = (r1.headers['set-cookie'] as unknown as string[])[0];
    // Move the rotation outside the concurrency grace window, then reuse the old cookie.
    await prisma.refreshToken.updateMany({ where: { userId: u.userId, revokedReason: 'rotated' }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    const reuse = await refresh(u.cookie);
    expect(reuse.status).toBe(401);
    expect(await prisma.securityEvent.count({ where: { userId: u.userId, type: 'auth.refresh_token_reuse' } })).toBe(1);
    // ...and the legitimate new token in the same family is now revoked too
    expect((await refresh(newCookie)).status).toBe(401);
  });

  it('tolerates concurrent refreshes from two tabs within the grace window', async () => {
    const u = await registerUser();
    const [r1, r2] = await Promise.all([refresh(u.cookie), refresh(u.cookie)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await prisma.securityEvent.count({ where: { userId: u.userId, type: 'auth.refresh_token_reuse' } })).toBe(0);
    // Sequential reuse right after rotation is also tolerated (reload racing an in-flight refresh)
    expect((await refresh(u.cookie)).status).toBe(200);
  });

  it('requires the CSRF header for cookie-authenticated endpoints', async () => {
    const u = await registerUser();
    const res = await request(await getApp()).post('/api/v1/auth/refresh').set('Cookie', u.cookie.split(';')[0]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_FAILED');
  });

  it('logout revokes the refresh token', async () => {
    const u = await registerUser();
    await request(await getApp()).post('/api/v1/auth/logout').set('Cookie', u.cookie.split(';')[0]).set('X-NTS-CSRF', '1');
    expect((await refresh(u.cookie)).status).toBe(401);
  });
});

describe('password reset', () => {
  it('does not reveal unknown emails and resets with a single-use token', async () => {
    const u = await registerUser();
    const a = await getApp();
    expect((await request(a).post('/api/v1/auth/forgot-password').send({ email: uniqueEmail() })).status).toBe(200);
    await request(a).post('/api/v1/auth/forgot-password').send({ email: u.email });
    await drainInlineJobs();
    const mail = testOutbox().filter((m) => m.to === u.email && /reset/i.test(m.subject)).pop()!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    const newPw = 'An0ther-Str0ng-pass';
    expect((await request(a).post('/api/v1/auth/reset-password').send({ token, password: newPw })).status).toBe(200);
    expect((await request(a).post('/api/v1/auth/reset-password').send({ token, password: newPw })).status).toBe(400);
    expect((await refresh(u.cookie)).status).toBe(401); // all sessions revoked
    expect((await request(a).post('/api/v1/auth/login').send({ email: u.email, password: newPw })).status).toBe(200);
  });
});

describe('MFA', () => {
  it('requires a TOTP code after enrolment', async () => {
    const u = await registerUser();
    const setup = await api(u, 'post', '/auth/mfa/setup');
    const secret = setup.body.data.secret as string;
    expect((await api(u, 'post', '/auth/mfa/enable', { code: totp(secret) })).status).toBe(200);
    const a = await getApp();
    const login = await request(a).post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD });
    expect(login.body.data.mfaRequired).toBe(true);
    expect(login.body.data.accessToken).toBeUndefined();
    const wrong = await request(a).post('/api/v1/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await request(a).post('/api/v1/auth/mfa/verify').send({ mfaToken: login.body.data.mfaToken, code: totp(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
  });
});

describe('organization onboarding', () => {
  it('requires a verified email before creating an organization', async () => {
    const u = await registerUser({ verified: false });
    const res = await api(u, 'post', '/organizations', { name: 'Unverified School', type: 'SCHOOL', officialEmail: 'a@b.test', country: 'SL', timezone: 'UTC' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('creates the organization, owner membership, system roles and settings', async () => {
    const u = await registerUser();
    const org = await createOrg(u, 'Onboard College', 'COLLEGE');
    const me = await api(u, 'get', '/auth/me');
    expect(me.body.data.activeOrganizationId).toBe(org.id);
    expect(me.body.data.organizations[0]).toMatchObject({ isOwner: true });
    const roles = await api(u, 'get', '/roles');
    expect(roles.body.data.map((r: { key: string }) => r.key).sort()).toEqual(['admin', 'department_admin', 'lecturer', 'viewer']);
    const settings = await api(u, 'get', '/organizations/settings');
    expect(settings.body.data.organizationId).toBe(org.id);
  });

  it('rejects an unknown time zone', async () => {
    const u = await registerUser();
    const res = await api(u, 'post', '/organizations', { name: 'Timezone School', type: 'SCHOOL', officialEmail: 'a@b.test', country: 'SL', timezone: 'Mars/Olympus' });
    expect(res.status).toBe(400);
  });
});
