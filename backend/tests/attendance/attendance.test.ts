import crypto from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { sha256 } from '../../src/lib/crypto.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { CLASS_LOCATION, api, getApp, publicFlow, reading, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

let T: Awaited<ReturnType<typeof seedTenant>>;
const base = '/api/v1/public/attendance';

async function jpeg(w = 320, h = 320, withExif = false) {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: 200 } } }).jpeg();
  if (withExif) img = img.withMetadata({ exif: { IFD0: { Make: 'SecretPhoneCo', Model: 'X1' } } });
  return img.toBuffer();
}

beforeAll(async () => {
  await resetDb();
  T = await seedTenant('Delta University');
});
// Over a slow database link this file can outlive the 15-minute access token.
beforeEach(() => {
  const c = jwt.decode(T.owner.token) as { sub: string; org: string | null; sid: string };
  T.owner.token = signAccessToken({ sub: c.sub, org: c.org, sid: c.sid });
});

describe('QR tokens', () => {
  it('stores only a hash of the token and accepts a valid token', async () => {
    const s = await startSession(T.owner, T.cls.id);
    expect(s.qr.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.qr.url).toContain(s.qr.token);
    const rows = await prisma.qRToken.findMany({ where: { sessionId: s.session.id } });
    expect(rows[0].tokenHash).toBe(sha256(s.qr.token));
    expect(JSON.stringify(rows)).not.toContain(s.qr.token);
    const v = await request(await getApp()).post(`${base}/${s.qr.token}/validate`);
    expect(v.status).toBe(200);
    expect(v.body.data.session.context).toContain('CS201');
    expect(v.body.data.studentIdFormat).toMatchObject({ exactLength: 8, maxLength: 8 });
  });

  it('rejects invalid, tampered, expired, revoked and closed tokens', async () => {
    const a = await getApp();
    expect((await request(a).post(`${base}/${'x'.repeat(43)}/validate`)).body.code).toBe('QR_INVALID');
    const s = await startSession(T.owner, T.cls.id);
    const tampered = s.qr.token.slice(0, -1) + (s.qr.token.endsWith('A') ? 'B' : 'A');
    expect((await request(a).post(`${base}/${tampered}/validate`)).status).toBe(404);

    await prisma.attendanceSession.update({ where: { id: s.session.id }, data: { startsAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1000) } });
    const exp = await request(a).post(`${base}/${s.qr.token}/validate`);
    expect(exp.status).toBe(410);
    expect(exp.body.code).toBe('ATTENDANCE_SESSION_EXPIRED');

    // A rotated QR token past its own expiry (and grace period) is QR_EXPIRED while the session runs on.
    const rot = await startSession(T.owner, T.cls.id);
    await prisma.qRToken.updateMany({ where: { sessionId: rot.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(a).post(`${base}/${rot.qr.token}/validate`)).body.code).toBe('QR_EXPIRED');

    const r = await startSession(T.owner, T.cls.id);
    await api(T.owner, 'post', `/attendance/sessions/${r.session.id}/revoke`);
    expect((await request(a).post(`${base}/${r.qr.token}/validate`)).body.code).toBe('SESSION_REVOKED');

    const c = await startSession(T.owner, T.cls.id);
    await api(T.owner, 'post', `/attendance/sessions/${c.session.id}/close`);
    expect((await request(a).post(`${base}/${c.qr.token}/validate`)).body.code).toBe('SESSION_CLOSED');
  });

  it('reports expired sessions as EXPIRED to the lecturer', async () => {
    const s = await startSession(T.owner, T.cls.id);
    await prisma.attendanceSession.update({ where: { id: s.session.id }, data: { startsAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1000) } });
    expect((await api(T.owner, 'get', `/attendance/sessions/${s.session.id}`)).body.data.effectiveStatus).toBe('EXPIRED');
    expect((await api(T.owner, 'post', `/attendance/sessions/${s.session.id}/qr`)).status).toBe(409);
  });

  it('attempt tokens are bound to the QR token they came from', async () => {
    const s1 = await startSession(T.owner, T.cls.id);
    const s2 = await startSession(T.owner, T.cls.id);
    const a = await getApp();
    const v1 = await request(a).post(`${base}/${s1.qr.token}/validate`);
    const res = await request(a).post(`${base}/${s2.qr.token}/verify-student`).set('X-Attempt-Token', v1.body.data.attemptToken).send({ studentId: '20240001' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_MISMATCH');
  });
});

describe('student verification', () => {
  it('verifies an enrolled student and returns minimal details', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    expect(flow.stage).toBe('ready');
    if (flow.stage !== 'ready') return;
    expect(flow.student).toMatchObject({ fullName: 'Student1 Delta', studentId: '20240001', program: 'BSc Computer Science', level: 'Year 2' });
    expect(flow.student.email).toBe('s1@delta.test'); // shown in full so the student can confirm the record
    expect(Object.keys(flow.student).sort()).toEqual(['email', 'fullName', 'level', 'program', 'studentId']);
  });

  it('rejects unknown IDs, wrong-length IDs, and non-enrolled students', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const notFound = await publicFlow(s.qr.token, '20249999');
    expect(notFound.stage).toBe('student');
    if (notFound.stage === 'student') {
      expect(notFound.res.status).toBe(404);
      expect(notFound.res.body.message).toBe('Student ID not found. Please check your ID and try again.');
    }
    const short = await publicFlow(s.qr.token, '2024');
    if (short.stage === 'student') expect(short.res.body.code).toBe('INVALID_STUDENT_ID_FORMAT');
    const notEnrolled = await publicFlow(s.qr.token, '20240003'); // exists but not enrolled
    if (notEnrolled.stage === 'student') expect(notEnrolled.res.body.code).toBe('STUDENT_NOT_ENROLLED');
    expect(notEnrolled.stage).toBe('student');
  });

  it('caps repeated failed lookups per client (enumeration protection)', async () => {
    const s = await startSession(T.owner, T.cls.id, { locationVerificationEnabled: false });
    const a = await getApp();
    const v = await request(a).post(`${base}/${s.qr.token}/validate`);
    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(a).post(`${base}/${s.qr.token}/verify-student`).set('X-Attempt-Token', v.body.data.attemptToken).send({ studentId: `3000000${i % 10}` });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(await prisma.securityEvent.count({ where: { type: 'attendance.student_id_enumeration' } })).toBeGreaterThan(0);
  });
});

describe('location verification (details in proximity.test.ts)', () => {
  const verify = async (token: string, attempt: string, body: object) =>
    request(await getApp()).post(`${base}/${token}/verify-location`).set('X-Attempt-Token', attempt).send(body);

  it('student ID verification is only possible after the location is accepted', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const v = await request(await getApp()).post(`${base}/${s.qr.token}/validate`);
    const res = await request(await getApp()).post(`${base}/${s.qr.token}/verify-student`).set('X-Attempt-Token', v.body.data.attemptToken).send({ studentId: '20240002' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCATION_NOT_VERIFIED');
  });

  it('never trusts client-calculated distances or verdicts', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const v = await request(await getApp()).post(`${base}/${s.qr.token}/validate`);
    const res = await verify(s.qr.token, v.body.data.attemptToken, { ...reading(50, 5), distanceM: 0, withinGeofence: true, accepted: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCATION_OUTSIDE_RADIUS');
    expect(res.body.errors.distanceM).toBe(50);
  });
});

describe('selfie upload', () => {
  const upload = async (token: string, attempt: string, buf: Buffer, name = 'selfie.jpg') =>
    request(await getApp()).post(`${base}/${token}/upload-selfie`).set('X-Attempt-Token', attempt).attach('file', buf, name);

  it('accepts a valid image, strips metadata and stores it under a tenant path', async () => {
    const s = await startSession(T.owner, T.cls.id, { selfieRequired: true });
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const res = await upload(s.qr.token, flow.attemptToken, await jpeg(400, 400, true));
    expect(res.status).toBe(201);
    const row = await prisma.attendanceSelfie.findUniqueOrThrow({ where: { id: res.body.data.selfieId } });
    expect(row.storageKey.startsWith(`tenants/${T.org.id}/selfies/`)).toBe(true);
    const file = await request(await getApp()).get(new URL(res.body.data.previewUrl).pathname + new URL(res.body.data.previewUrl).search);
    expect(file.status).toBe(200);
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('rejects disguised, oversized, tiny and corrupt files', async () => {
    const s = await startSession(T.owner, T.cls.id, { selfieRequired: true });
    const flow = await publicFlow(s.qr.token, '20240002');
    if (flow.stage !== 'ready') throw new Error('flow');
    const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(2000)]);
    expect((await upload(s.qr.token, flow.attemptToken, exe, 'photo.jpg')).body.code).toBe('UNSUPPORTED_FILE_TYPE');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await upload(s.qr.token, flow.attemptToken, html, 'photo.png')).body.code).toBe('UNSUPPORTED_FILE_TYPE');
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(500)]);
    expect((await upload(s.qr.token, flow.attemptToken, corrupt)).body.code).toBe('INVALID_IMAGE');
    expect((await upload(s.qr.token, flow.attemptToken, await jpeg(40, 40))).body.code).toBe('IMAGE_TOO_SMALL');
    const big = Buffer.concat([await jpeg(), crypto.randomBytes(6 * 1024 * 1024)]);
    expect((await upload(s.qr.token, flow.attemptToken, big)).status).toBe(413);
  });

  it('requires a verified student and a selfie when the session demands one', async () => {
    const s = await startSession(T.owner, T.cls.id, { selfieRequired: true });
    const a = await getApp();
    const v = await request(a).post(`${base}/${s.qr.token}/validate`);
    expect((await upload(s.qr.token, v.body.data.attemptToken, await jpeg())).body.code).toBe('STUDENT_NOT_VERIFIED');
    const flow = await publicFlow(s.qr.token, '20240002');
    if (flow.stage !== 'ready') throw new Error('flow');
    expect((await submitAttendance(s.qr.token, flow.attemptToken)).body.code).toBe('SELFIE_REQUIRED');
  });
});

describe('attendance submission', () => {
  it('records attendance with server timestamps and returns the success payload', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const before = Date.now();
    const res = await submitAttendance(s.qr.token, flow.attemptToken, { ...CLASS_LOCATION, accuracy: 10, submittedAt: '1999-01-01T00:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ success: true, message: 'Your attendance has been successfully recorded.', status: 'PRESENT', locationVerified: true });
    expect(res.body.data.referenceNumber).toMatch(/^NTS-/);
    expect(new Date(res.body.data.submittedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Confirmation needs reference + secret token
    const a = await getApp();
    const conf = await request(a).get(`${base}/confirmation/${res.body.data.referenceNumber}`).query({ token: res.body.data.confirmationToken });
    expect(conf.status).toBe(200);
    expect(conf.body.data.student.fullName).toBe('Student1 Delta');
    expect((await request(a).get(`${base}/confirmation/${res.body.data.referenceNumber}`)).status).toBe(404);
    expect((await request(a).get(`${base}/confirmation/${res.body.data.referenceNumber}`).query({ token: 'A'.repeat(32) })).status).toBe(404);
    // Lecturer sees it
    const recs = await api(T.owner, 'get', `/attendance/sessions/${s.session.id}/records`);
    expect(recs.body.data).toHaveLength(1);
    const stats = (await api(T.owner, 'get', `/attendance/sessions/${s.session.id}`)).body.data.stats;
    expect(stats).toMatchObject({ expected: 2, present: 1, absent: 1, attendanceRate: 50 });
  });

  it('rejects duplicates and replays idempotently with the same key', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240002');
    if (flow.stage !== 'ready') throw new Error('flow');
    const key = crypto.randomUUID();
    const first = await submitAttendance(s.qr.token, flow.attemptToken, undefined, key);
    expect(first.status).toBe(201);
    const replay = await submitAttendance(s.qr.token, flow.attemptToken, undefined, key);
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);
    expect(replay.body.data.referenceNumber).toBe(first.body.data.referenceNumber);
    const dup = await submitAttendance(s.qr.token, flow.attemptToken);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALREADY_RECORDED');
    // Re-verifying a recorded student is also refused
    const again = await publicFlow(s.qr.token, '20240002');
    if (again.stage === 'student') expect(again.res.body.code).toBe('ALREADY_RECORDED');
  });

  it('concurrent duplicate submissions create exactly one record', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const results = await Promise.all(Array.from({ length: 15 }, () => submitAttendance(s.qr.token, flow.attemptToken)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 201)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409)).toHaveLength(14);
    expect(await prisma.attendanceRecord.count({ where: { sessionId: s.session.id } })).toBe(1);
  });

  it('rejects submissions after expiry, close or revocation even with a valid attempt token', async () => {
    for (const action of ['expire', 'close', 'revoke'] as const) {
      const s = await startSession(T.owner, T.cls.id);
      const flow = await publicFlow(s.qr.token, '20240001');
      if (flow.stage !== 'ready') throw new Error('flow');
      if (action === 'expire') await prisma.attendanceSession.update({ where: { id: s.session.id }, data: { startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1) } });
      else await api(T.owner, 'post', `/attendance/sessions/${s.session.id}/${action}`);
      const res = await submitAttendance(s.qr.token, flow.attemptToken);
      expect(res.status).toBe(410);
      expect(await prisma.attendanceRecord.count({ where: { sessionId: s.session.id } })).toBe(0);
    }
  });

  it('requires an idempotency key', async () => {
    const s = await startSession(T.owner, T.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const res = await request(await getApp()).post(`${base}/${s.qr.token}/submit`).set('X-Attempt-Token', flow.attemptToken).send({ ...CLASS_LOCATION, accuracy: 5 });
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('full flow with selfie links the photo and lets authorized staff view it', async () => {
    const s = await startSession(T.owner, T.cls.id, { selfieRequired: true });
    const flow = await publicFlow(s.qr.token, '20240002');
    if (flow.stage !== 'ready') throw new Error('flow');
    const up = await request(await getApp()).post(`${base}/${s.qr.token}/upload-selfie`).set('X-Attempt-Token', flow.attemptToken).attach('file', await jpeg(), 'me.jpg');
    const res = await submitAttendance(s.qr.token, flow.attemptToken, { ...CLASS_LOCATION, accuracy: 8, selfieId: up.body.data.selfieId });
    expect(res.status).toBe(201);
    expect(res.body.data.selfieUrl).toBeTruthy();
    const recs = await api(T.owner, 'get', `/attendance/sessions/${s.session.id}/records`);
    expect(recs.body.data[0].selfieUrl).toBeTruthy();
    expect(recs.body.data[0].verificationMeta.selfie).toBe('CAPTURED_NOT_BIOMETRICALLY_VERIFIED');
  });

  it('marks late arrivals according to the session rule', async () => {
    const s = await startSession(T.owner, T.cls.id, { lateAfterMinutes: 1 });
    await prisma.attendanceSession.update({ where: { id: s.session.id }, data: { lateAfter: new Date(Date.now() - 1000) } });
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const res = await submitAttendance(s.qr.token, flow.attemptToken);
    expect(res.body.data.status).toBe('LATE');
  });
});

describe('students cannot browse data', () => {
  it('public endpoints expose no listing or record APIs', async () => {
    const a = await getApp();
    expect((await request(a).get(`${base}/sessions`)).status).toBe(404);
    expect((await request(a).get('/api/v1/attendance/records')).status).toBe(401);
    expect((await request(a).get('/api/v1/students')).status).toBe(401);
  });
});
