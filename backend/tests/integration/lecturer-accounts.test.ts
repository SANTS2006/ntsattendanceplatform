import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { testOutbox } from '../../src/infra/mailer.js';
import { drainInlineJobs } from '../../src/infra/queue.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { PASSWORD, api, createOrg, getApp, registerUser, resetDb, uniqueEmail, type Session } from '../helpers.js';

/**
 * Lecturer accounts: adding a lecturer creates their account in that organization and emails a
 * setup link; the same person can register themselves and own their own organization, keeping
 * their lecturer role elsewhere; organizations never see each other's data.
 */
let owner: Session;
let orgId: string;
const lecturerBody = (email: string, firstName = 'Grace') => ({ firstName, lastName: 'Hopper', email });
const mailTo = async (email: string) => {
  await drainInlineJobs();
  return testOutbox().filter((m) => m.to === email);
};

beforeAll(async () => {
  await resetDb();
  owner = await registerUser();
  orgId = (await createOrg(owner, 'Lecture University')).id;
});
// Long runs over a slow database link can outlive the 15-minute access token.
beforeEach(() => {
  const c = jwt.decode(owner.token) as { sub: string; org: string | null; sid: string };
  owner.token = signAccessToken({ sub: c.sub, org: c.org, sid: c.sid });
});

async function lecturerRow(email: string) {
  const list = await api(owner, 'get', `/lecturers?search=${encodeURIComponent(email)}`);
  return list.body.data.find((l: { email: string }) => l.email === email);
}

describe('lecturer accounts', () => {
  it('adding a lecturer creates an account in the organization and emails a setup link', async () => {
    const email = uniqueEmail('lect');
    const res = await api(owner, 'post', '/lecturers', lecturerBody(email));
    expect(res.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: { include: { roles: { include: { role: true } } } } } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]).toMatchObject({ organizationId: orgId, isOwner: false });
    expect(user.memberships[0].roles.map((r) => r.role.key)).toEqual(['lecturer']);

    const row = await lecturerRow(email);
    expect(row.accountStatus).toBe('PENDING_SETUP');
    expect(JSON.stringify(row)).not.toMatch(/passwordHash|googleId/); // credentials never leave the API

    const mail = (await mailTo(email)).pop()!;
    expect(mail.subject).toContain('lecturer account');
    const token = /accept-invitation\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];

    // A placeholder account cannot sign in until it is set up.
    expect((await request(await getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(401);

    const lookup = await request(await getApp()).get('/api/v1/invitations/lookup').query({ token });
    expect(lookup.body.data).toMatchObject({ accountExists: false, setupRequired: true, firstName: 'Grace', lastName: 'Hopper', organizationName: 'Lecture University' });

    const accept = await request(await getApp()).post('/api/v1/invitations/accept').send({ token, firstName: 'Grace', lastName: 'Hopper', password: PASSWORD });
    expect(accept.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordHash).toBeTruthy();
    expect(after.emailVerifiedAt).toBeTruthy();
    expect(await prisma.membershipRole.count({ where: { membership: { userId: after.id } } })).toBe(1); // no duplicate role
    expect((await lecturerRow(email)).accountStatus).toBe('ACTIVE');
    expect((await request(await getApp()).post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    // The setup link is single-use.
    expect((await request(await getApp()).post('/api/v1/invitations/accept').send({ token, password: PASSWORD })).status).toBe(400);
  });

  it('the lecturer can register with the same email, keep their lecturer role and own a separate organization', async () => {
    const email = uniqueEmail('self');
    await api(owner, 'post', '/lecturers', lecturerBody(email, 'Ada'));
    const a = await getApp();

    // Self sign-up with the same email: the code flow completes the account the institution created.
    const start = await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'Ada', lastName: 'Lovelace', acceptTerms: true });
    expect(start.status).toBe(202);
    expect(start.body.data._testCode).toBeTruthy();
    const verify = await request(a).post('/api/v1/auth/register/verify').send({ email, code: start.body.data._testCode });
    expect(verify.status).toBe(201);
    const me: Session = { token: verify.body.data.accessToken, userId: verify.body.data.user.id, cookie: '', email };
    expect(await prisma.user.count({ where: { email } })).toBe(1);

    let profile = (await api(me, 'get', '/auth/me')).body.data;
    expect(profile.organizations).toEqual([expect.objectContaining({ id: orgId, isOwner: false, isLecturer: true })]);

    // Own organization space, fully administered by them.
    const own = await createOrg(me, 'Ada Academy');
    profile = (await api(me, 'get', '/auth/me')).body.data;
    expect(profile.organizations.map((o: { name: string; isOwner: boolean }) => [o.name, o.isOwner]).sort()).toEqual([['Ada Academy', true], ['Lecture University', false]]);
    expect(profile.activeOrganizationId).toBe(own.id);
    expect((await api(me, 'post', '/departments', { name: 'Maths', code: 'MTH' })).status).toBe(201);

    // Data stays separate: in their own organization they see none of the institution's lecturers…
    const ownLecturers = (await api(me, 'get', '/lecturers')).body.data;
    expect(ownLecturers.some((l: { email: string }) => l.email === email)).toBe(false);
    // …and in the institution they are a lecturer, not an administrator.
    const sw = await api(me, 'post', '/auth/switch-organization', { organizationId: orgId });
    expect(sw.status).toBe(200);
    me.token = sw.body.data.accessToken;
    expect((await api(me, 'post', '/departments', { name: 'Hijack', code: 'HJK' })).status).toBe(403);
    expect((await api(me, 'get', '/lecturers/me')).body.data.email).toBe(email);
  });

  it('a person who already has an account is added to the organization and notified', async () => {
    const existing = await registerUser();
    const res = await api(owner, 'post', '/lecturers', lecturerBody(existing.email, 'Alan'));
    expect(res.status).toBe(201);
    expect((await lecturerRow(existing.email)).accountStatus).toBe('ACTIVE');
    const mail = (await mailTo(existing.email)).pop()!;
    expect(mail.subject).toContain('You were added to Lecture University');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: existing.email } });
    expect(user.passwordHash).toBeTruthy(); // their credentials are untouched
  });

  it('resends the setup email for pending accounts and refuses for active ones', async () => {
    const email = uniqueEmail('resend');
    await api(owner, 'post', '/lecturers', lecturerBody(email));
    const id = (await lecturerRow(email)).id;
    const again = await api(owner, 'post', `/lecturers/${id}/invite`);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('SETUP_EMAIL_SENT');
    // Only the newest link works.
    const links = (await mailTo(email)).map((m) => /accept-invitation\?token=([A-Za-z0-9_-]+)/.exec(m.text)![1]);
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect((await request(await getApp()).get('/api/v1/invitations/lookup').query({ token: links[0] })).status).toBe(400);
    expect((await request(await getApp()).post('/api/v1/invitations/accept').send({ token: links.at(-1), password: PASSWORD })).status).toBe(200);
    expect((await api(owner, 'post', `/lecturers/${id}/invite`)).body.code).toBe('ALREADY_LINKED');
  });

  it('"Forgot password" also completes a pending account and verifies the email', async () => {
    const email = uniqueEmail('forgot');
    await api(owner, 'post', '/lecturers', lecturerBody(email));
    const a = await getApp();
    await request(a).post('/api/v1/auth/forgot-password').send({ email });
    const mail = (await mailTo(email)).filter((m) => /reset-password\?token=/.test(m.text)).pop()!;
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    expect((await request(a).post('/api/v1/auth/reset-password').send({ token, password: PASSWORD })).status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeTruthy();
    expect((await request(a).post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  });
});
