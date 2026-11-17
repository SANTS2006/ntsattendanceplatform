import crypto from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { registerJobs } from '../src/jobs/index.js';
import { ensurePermissionCatalogue } from '../src/modules/organizations/organizations.service.js';

let app: Express | null = null;

export async function getApp() {
  if (!app) {
    registerJobs();
    await ensurePermissionCatalogue();
    app = createApp();
  }
  return app;
}

/** Wipes all data between test files (the audit trigger does not fire on TRUNCATE). */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'permissions')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export const uniqueEmail = (p = 'user') => `${p}-${crypto.randomUUID().slice(0, 8)}@example.test`;
export const PASSWORD = 'Str0ng-Passw0rd!';

export type Session = { token: string; userId: string; cookie: string; email: string };

export async function registerUser(opts: { email?: string; verified?: boolean } = {}): Promise<Session> {
  const a = await getApp();
  const email = opts.email ?? uniqueEmail();
  const start = await request(a).post('/api/v1/auth/register').send({ email, password: PASSWORD, firstName: 'Test', lastName: 'User', acceptTerms: true });
  if (start.status !== 202) throw new Error(`register failed: ${start.status} ${JSON.stringify(start.body)}`);
  const res = await request(a).post('/api/v1/auth/register/verify').send({ email, code: start.body.data._testCode });
  if (res.status !== 201) throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  // Legacy accounts (created before code verification) may be unverified.
  if (opts.verified === false) await prisma.user.update({ where: { email }, data: { emailVerifiedAt: null } });
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('nts_rt='))!;
  return { token: res.body.data.accessToken, userId: res.body.data.user.id, cookie, email };
}

export async function createOrg(owner: Session, name = 'Test University', type = 'UNIVERSITY') {
  const a = await getApp();
  const res = await request(a)
    .post('/api/v1/organizations')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name, type, officialEmail: 'office@example.test', country: 'Sierra Leone', timezone: 'Africa/Freetown' });
  if (res.status !== 201) throw new Error(`org failed: ${res.status} ${JSON.stringify(res.body)}`);
  owner.token = res.body.data.accessToken;
  return res.body.data.organization as { id: string; name: string };
}

export const auth = (s: { token: string }) => ({ Authorization: `Bearer ${s.token}` });

export async function api(s: { token: string } | null, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown) {
  const a = await getApp();
  let r = request(a)[method](`/api/v1${url}`);
  if (s) r = r.set(auth(s));
  if (body !== undefined) r = r.send(body as object);
  return r;
}

/** Owner + org + 8-char numeric student-ID policy + department/program/level/course/class + enrolled students. */
export async function seedTenant(name = 'Alpha University') {
  const owner = await registerUser();
  const org = await createOrg(owner, name);
  await api(owner, 'patch', '/organizations/settings', {
    studentIdExactLength: 8, studentIdCharset: 'NUMERIC', locationRequired: true, selfieRequired: false, studentMaxAccuracyM: 20, lecturerMaxAccuracyM: 20,
  });
  const dept = (await api(owner, 'post', '/departments', { name: 'Computer Science', code: 'CS' })).body.data;
  const program = (await api(owner, 'post', '/programs', { name: 'BSc Computer Science', code: 'BSCCS', departmentId: dept.id })).body.data;
  const level = (await api(owner, 'post', '/levels', { name: 'Year 2', rank: 2 })).body.data;
  const course = (await api(owner, 'post', '/courses', { code: 'CS201', title: 'Data Structures', departmentId: dept.id, programId: program.id, levelId: level.id })).body.data;
  const cls = (await api(owner, 'post', '/classes', { name: 'Group A', code: 'CS201-A', courseId: course.id, room: 'Lecture Hall 2' })).body.data;
  const students = [];
  for (let i = 1; i <= 3; i++) {
    const s = (
      await api(owner, 'post', '/students', {
        studentNumber: `2024000${i}`, firstName: `Student${i}`, lastName: name.split(' ')[0], email: `s${i}@${name.split(' ')[0].toLowerCase()}.test`,
        programId: program.id, departmentId: dept.id, levelId: level.id,
      })
    ).body.data;
    students.push(s);
  }
  await api(owner, 'post', '/enrollments', { classId: cls.id, studentIds: students.slice(0, 2).map((s) => s.id) });
  return { owner, org, dept, program, level, course, cls, students };
}

/** Where the lecturer stands when generating the QR code (the session reference point). */
export const CLASS_LOCATION = { latitude: 8.4844, longitude: -13.2344 };
/** Point `m` metres due north of the reference (0.0001° latitude ≈ 11.1 m). */
export const north = (m: number) => ({ latitude: CLASS_LOCATION.latitude + m / 111_195, longitude: CLASS_LOCATION.longitude });
/** A fresh browser reading `m` metres from the lecturer with the given accuracy. */
export const reading = (m: number, accuracy: number, ageMs = 1_000) => ({ ...north(m), accuracy, timestamp: Date.now() - ageMs, clientTime: Date.now() });
export const lecturerReading = (accuracy = 5, ageMs = 1_000) => reading(0, accuracy, ageMs);

export async function startSession(owner: Session, classId: string, extra: Record<string, unknown> = {}) {
  const res = await api(owner, 'post', '/attendance/sessions', { classId, durationMinutes: 15, reference: lecturerReading(), ...extra });
  if (res.status !== 201) throw new Error(`session failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { session: { id: string }; qr: { token: string; url: string } };
}

/** validate → (location, when the session requires it) → student ID. */
export async function publicFlow(qrToken: string, studentId: string, location: Record<string, unknown> = reading(3, 5)) {
  const a = await getApp();
  const v = await request(a).post(`/api/v1/public/attendance/${qrToken}/validate`);
  if (v.status !== 200) return { stage: 'validate', res: v } as const;
  let attempt = v.body.data.attemptToken as string;
  if (v.body.data.session.locationVerificationEnabled) {
    const l = await request(a).post(`/api/v1/public/attendance/${qrToken}/verify-location`).set('X-Attempt-Token', attempt).send(location);
    if (l.status !== 200) return { stage: 'location', res: l } as const;
    attempt = l.body.data.attemptToken;
  }
  const s = await request(a).post(`/api/v1/public/attendance/${qrToken}/verify-student`).set('X-Attempt-Token', attempt).send({ studentId });
  if (s.status !== 200) return { stage: 'student', res: s } as const;
  return { stage: 'ready', attemptToken: s.body.data.attemptToken as string, student: s.body.data.student, validate: v.body.data } as const;
}

export async function submitAttendance(qrToken: string, attemptToken: string, body: Record<string, unknown> = {}, key = crypto.randomUUID()) {
  const a = await getApp();
  return request(a).post(`/api/v1/public/attendance/${qrToken}/submit`).set('X-Attempt-Token', attemptToken).set('Idempotency-Key', key).send(body);
}
