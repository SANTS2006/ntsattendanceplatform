import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { testOutbox } from '../../src/infra/mailer.js';
import { drainInlineJobs } from '../../src/infra/queue.js';
import { PASSWORD, api, auth, getApp, registerUser, resetDb, seedTenant, uniqueEmail, type Session } from '../helpers.js';

let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
let admin: Session;

beforeAll(async () => {
  await resetDb();
  A = await seedTenant('Alpha University');
  B = await seedTenant('Beta College');
  admin = await registerUser();
  await prisma.platformAdmin.create({ data: { userId: admin.userId, role: 'SUPER_ADMIN' } });
});

const upload = async (s: Session, url: string, name: string, body: Buffer) => request(await getApp()).post(`/api/v1${url}`).set(auth(s)).attach('file', body, name);

describe('profile picture', () => {
  it('uploads, strips metadata, serves via signed URL and can be removed', async () => {
    const img = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#2563eb' } }).jpeg().withMetadata({ exif: { IFD0: { Make: 'Phone' } } }).toBuffer();
    const res = await upload(A.owner, '/auth/me/avatar', 'me.jpg', img);
    expect(res.status).toBe(200);
    const me = await api(A.owner, 'get', '/auth/me');
    expect(me.body.data.user.avatarUrl).toMatch(/\/api\/v1\/files\?key=users%2F/); // signed, expiring URL
    const url = new URL(me.body.data.user.avatarUrl);
    const file = await request(await getApp()).get(url.pathname + url.search);
    expect(file.status).toBe(200);
    expect((await sharp(file.body as Buffer).metadata()).exif).toBeUndefined();
    const key = (await prisma.user.findUniqueOrThrow({ where: { id: A.owner.userId } })).avatarKey!;
    expect(key.startsWith(`users/${A.owner.userId}/avatars/`)).toBe(true);
    expect((await api(A.owner, 'delete', '/auth/me/avatar')).body.data.avatarUrl).toBeNull();
  });

  it('rejects non-images', async () => {
    const res = await upload(A.owner, '/auth/me/avatar', 'x.jpg', Buffer.from('<svg onload=alert(1)>'));
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });
});

describe('email change with a code sent to the new address', () => {
  it('requires the password, emails both addresses and switches only after the code', async () => {
    const u = await registerUser();
    const newEmail = uniqueEmail('moved');
    const wrong = await api(u, 'post', '/auth/email-change', { newEmail, password: 'Wrong-passw0rd' });
    expect(wrong.body.code).toBe('INVALID_PASSWORD');
    const start = await api(u, 'post', '/auth/email-change', { newEmail, password: PASSWORD });
    expect(start.status).toBe(202);
    await drainInlineJobs();
    const toNew = testOutbox().filter((m) => m.to === newEmail).pop()!;
    expect(toNew.subject).toContain(start.body.data._testCode);
    expect(testOutbox().some((m) => m.to === u.email && /email change was requested/i.test(m.subject))).toBe(true);
    expect((await api(u, 'get', '/auth/me')).body.data).toMatchObject({ user: { email: u.email }, pendingEmailChange: { newEmail } });

    const bad = await api(u, 'post', '/auth/email-change/verify', { code: 'ZZZZZZ' });
    expect(bad.body.errors.attemptsLeft).toBe(4);
    const ok = await api(u, 'post', '/auth/email-change/verify', { code: start.body.data._testCode });
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe(newEmail);
    await drainInlineJobs();
    expect(testOutbox().some((m) => m.to === u.email && /was changed/i.test(m.subject))).toBe(true);
    // The new address now signs in
    expect((await request(await getApp()).post('/api/v1/auth/login').send({ email: newEmail, password: PASSWORD })).status).toBe(200);
  });

  it('refuses addresses used by another account', async () => {
    const u = await registerUser();
    const res = await api(u, 'post', '/auth/email-change', { newEmail: A.owner.email, password: PASSWORD });
    expect(res.status).toBe(409);
  });
});

describe('generic imports (lecturers, academics, events)', () => {
  const run = async (resource: string, csv: string, mode = 'create_only') => {
    const up = await upload(A.owner, `/imports/${resource}`, `${resource}.csv`, Buffer.from(csv));
    expect(up.status).toBe(201);
    const preview = await api(A.owner, 'post', `/imports/${resource}/${up.body.data.id}/preview`, { mapping: up.body.data.suggestedMapping });
    const commit = await api(A.owner, 'post', `/imports/${resource}/${up.body.data.id}/commit`, { mapping: up.body.data.suggestedMapping, mode });
    expect(commit.status).toBe(202);
    await drainInlineJobs();
    const status = await api(A.owner, 'get', `/imports/${resource}/${up.body.data.id}`);
    return { up: up.body.data, preview: preview.body.data, status: status.body.data };
  };

  it('imports lecturers with validation, duplicates and department references', async () => {
    const r = await run('lecturers', ['First Name,Surname,Email,Dept', 'Ada,Lovelace,ada@uni.test,CS', 'Alan,Turing,ALAN@uni.test,Computer Science', 'Dup,Row,ada@uni.test,CS', 'Bad,Email,nope,CS', 'No,Dept,nodept@uni.test,XYZ'].join('\n'));
    expect(r.up.suggestedMapping).toMatchObject({ firstName: 'First Name', lastName: 'Surname', email: 'Email', department: 'Dept' });
    const byLine = Object.fromEntries(r.preview.table.map((t: { line: number }) => [t.line, t]));
    expect(byLine[2].status).toBe('new');
    expect(byLine[4].errors.join()).toMatch(/Duplicate of line 2/);
    expect(byLine[5].errors.join()).toMatch(/not a valid email/);
    expect(byLine[6].errors.join()).toMatch(/Unknown department "XYZ"/);
    expect(r.status).toMatchObject({ status: 'COMPLETED', successCount: 2, failureCount: 3 });
    const alan = await prisma.lecturer.findFirstOrThrow({ where: { email: 'alan@uni.test' } });
    expect(alan).toMatchObject({ organizationId: A.org.id, departmentId: A.dept.id });
  });

  it('imports courses, semesters and events with typed columns', async () => {
    expect((await run('courses', 'Course Code,Course Title,Department,Level,Credits\ncs301,Algorithms,CS,Year 2,3\nCS302,Networks,CS,Year 9,x')).status.successCount).toBe(1);
    expect(await prisma.course.findFirst({ where: { organizationId: A.org.id, code: 'CS301', departmentId: A.dept.id, credits: 3 } })).not.toBeNull();
    await run('academic-years', 'Academic Year,Start Date,End Date\n2026/2027,01/09/2026,31/07/2027');
    const sem = await run('semesters', 'Academic Year,Semester,Start,End\n2026/2027,First,2026-09-01,2027-01-31\n2026/2027,Bad,2027-01-31,2026-09-01');
    expect(sem.status).toMatchObject({ successCount: 1, failureCount: 1 });
    const ev = await run('events', 'Event,Starts,Ends,Venue,Registration required\nOrientation,2026-09-01 09:00,2026-09-01 12:00,Main hall,no');
    expect(ev.status.successCount).toBe(1);
    expect(await prisma.event.findFirst({ where: { organizationId: A.org.id, name: 'Orientation', requireRegistration: false } })).not.toBeNull();
  });

  it('updates existing records only in upsert mode', async () => {
    await run('departments', 'Name,Code\nComputing,CS', 'create_only');
    expect((await prisma.department.findUniqueOrThrow({ where: { id: A.dept.id } })).name).toBe('Computer Science');
    await run('departments', 'Name,Code\nComputing,CS', 'upsert');
    expect((await prisma.department.findUniqueOrThrow({ where: { id: A.dept.id } })).name).toBe('Computing');
  });

  it('keeps imports isolated per tenant and per resource', async () => {
    const up = await upload(A.owner, '/imports/faculties', 'f.csv', Buffer.from('Name,Code\nScience,SCI'));
    expect((await api(B.owner, 'post', `/imports/faculties/${up.body.data.id}/preview`, { mapping: up.body.data.suggestedMapping })).status).toBe(404);
    expect((await api(A.owner, 'post', `/imports/classes/${up.body.data.id}/preview`, { mapping: {} })).status).toBe(404);
    expect((await api(A.owner, 'post', `/students/import/${up.body.data.id}/preview`, { mapping: { studentNumber: 'Code', fullName: 'Name' } })).status).toBe(404);
    expect((await upload(A.owner, '/imports/unknown', 'x.csv', Buffer.from('a\n1'))).status).toBe(422);
  });
});

describe('support conversations and feedback', () => {
  it('lets an owner contact the platform, notifies both sides and isolates tenants', async () => {
    const t = await api(A.owner, 'post', '/support/tickets', { subject: 'QR codes expire too early', category: 'TECHNICAL', priority: 'HIGH', message: 'Our 9am class reported it.' });
    expect(t.status).toBe(201);
    const id = t.body.data.id;
    expect(await prisma.notification.count({ where: { userId: admin.userId, type: 'support.message' } })).toBe(1);

    // Platform inbox sees it (unread), other organizations do not
    const inbox = await api(admin, 'get', '/platform/support/tickets');
    expect(inbox.body.meta.unread).toBe(1);
    expect(inbox.body.data[0]).toMatchObject({ id, organization: { name: 'Alpha University' } });
    expect((await api(B.owner, 'get', `/support/tickets/${id}`)).status).toBe(404);
    expect((await api(B.owner, 'get', '/support/tickets')).body.data).toHaveLength(0);

    // Super Admin replies → organization notified in-app and by email
    const reply = await api(admin, 'post', `/platform/support/tickets/${id}/messages`, { body: 'Fixed — please try again.' });
    expect(reply.body.data.status).toBe('AWAITING_ORGANIZATION');
    await drainInlineJobs();
    expect((await api(A.owner, 'get', '/support/unread')).body.data.unread).toBe(1);
    expect(testOutbox().some((m) => m.to === A.owner.email && /Re: QR codes expire too early/.test(m.subject))).toBe(true);
    const thread = await api(A.owner, 'get', `/support/tickets/${id}`);
    expect(thread.body.data.messages.map((m: { fromPlatform: boolean }) => m.fromPlatform)).toEqual([false, true]);
    expect((await api(A.owner, 'get', '/support/unread')).body.data.unread).toBe(0);
  });

  it('restricts support to owners/administrators and platform APIs to platform admins', async () => {
    const roles = (await api(A.owner, 'get', '/roles')).body.data as { id: string; key: string }[];
    const lect = await registerUser();
    const inv = await api(A.owner, 'post', '/organizations/invitations', { email: lect.email, roleId: roles.find((r) => r.key === 'lecturer')!.id });
    const acc = await request(await getApp()).post('/api/v1/invitations/accept').set(auth(lect)).send({ token: inv.body.data._testToken });
    lect.token = acc.body.data.accessToken;
    expect((await api(lect, 'post', '/support/tickets', { subject: 'Hello there', message: 'Hi' })).status).toBe(403);
    expect((await api(A.owner, 'get', '/platform/support/tickets')).status).toBe(403);
    expect((await api(A.owner, 'get', '/platform/feedback')).status).toBe(403);
  });

  it('collects feedback with ratings and lets the platform triage it', async () => {
    const fb = await api(A.owner, 'post', '/feedback', { category: 'FEATURE', rating: 5, message: 'Please add a dark mode for projectors.' });
    expect(fb.status).toBe(201);
    expect((await api(A.owner, 'post', '/feedback', { category: 'FEATURE', rating: 9, message: 'Out of range rating' })).status).toBe(422);
    const list = await api(admin, 'get', '/platform/feedback');
    expect(list.body.meta.summary).toMatchObject({ averageRating: 5, new: 1 });
    await api(admin, 'patch', `/platform/feedback/${fb.body.data.id}`, { status: 'PLANNED', adminNote: 'Coming next release' });
    expect(await prisma.notification.count({ where: { userId: A.owner.userId, type: 'feedback.status' } })).toBe(1);
    expect((await api(B.owner, 'get', '/feedback')).body.data).toHaveLength(0);
  });
});

describe('backups to R2 (in-memory store in tests)', () => {
  it('backs up, restores everything after changes, and keeps a safety backup', async () => {
    const res = await api(admin, 'post', '/platform/backups');
    expect(res.status).toBe(201);
    await drainInlineJobs();
    const list = await api(admin, 'get', '/platform/backups');
    const backup = list.body.data[0];
    expect(backup).toMatchObject({ status: 'COMPLETED', kind: 'MANUAL' });
    expect(backup.rowCounts.students).toBeGreaterThan(0);
    expect(list.body.meta.config.enabled).toBe(true);

    // Change data after the backup
    const before = await prisma.student.count();
    await prisma.student.deleteMany({ where: { organizationId: B.org.id, enrollments: { none: {} }, attendance: { none: {} } } });
    await api(A.owner, 'patch', '/organizations/current', { name: 'Renamed After Backup' });
    expect(await prisma.student.count()).toBeLessThan(before);

    // Only Super Admins, and only with the confirmation word
    expect((await api(admin, 'post', `/platform/backups/${backup.id}/restore`, { confirm: 'yes' })).status).toBe(422);
    expect((await api(admin, 'post', `/platform/backups/${backup.id}/restore`, { confirm: 'RESTORE' })).status).toBe(202);
    await drainInlineJobs();

    expect(await prisma.student.count()).toBe(before);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: A.org.id } })).name).toBe('Alpha University');
    const after = await prisma.backup.findMany({ orderBy: { createdAt: 'asc' } });
    expect(after.find((b) => b.id === backup.id)?.restoreStatus).toBe('COMPLETED');
    expect(after.some((b) => b.kind === 'PRE_RESTORE' && b.status === 'COMPLETED')).toBe(true);
    // Database protections still hold after a restore
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/NTS_AUDIT_IMMUTABLE/);
  });
});
