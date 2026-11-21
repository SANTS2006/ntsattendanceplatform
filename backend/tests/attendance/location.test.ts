import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { CLASS_LOCATION, api, getApp, north, publicFlow, reading, refreshTokens, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

/**
 * The lecturer's device shares its location after the session and QR code are created. A student
 * within 20 m of it continues; anyone further away is told they are not in class.
 */
let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
const base = '/api/v1/public/attendance';
const app = async () => request(await getApp());
const attemptFor = async (qr: string) => (await (await app()).post(`${base}/${qr}/validate`)).body.data.attemptToken as string;
const verifyLoc = async (qr: string, attempt: string, body: Record<string, unknown>) =>
  (await app()).post(`${base}/${qr}/verify-location`).set('X-Attempt-Token', attempt).send(body);

beforeAll(async () => {
  await resetDb();
  A = await seedTenant('Location University');
  B = await seedTenant('Other College');
});
beforeEach(() => refreshTokens(A.owner, B.owner));

describe('lecturer location', () => {
  it('the session and QR code are created first; the location is saved afterwards and audited', async () => {
    const s = await startSession(A.owner, A.cls.id, { shareLocation: false });
    expect(s.qr.token).toBeTruthy();
    expect(await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } })).toMatchObject({ referenceLatitude: null, referenceLongitude: null });

    const saved = await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/location`, { ...CLASS_LOCATION, accuracy: 1_500 });
    expect(saved.status).toBe(200);
    const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({ ...{ referenceLatitude: CLASS_LOCATION.latitude, referenceLongitude: CLASS_LOCATION.longitude }, referenceAccuracyMeters: 1_500, locationSource: 'LECTURER_DEVICE' });
    expect(await prisma.auditLog.count({ where: { action: 'attendance_session.location_saved', targetId: s.session.id } })).toBe(1);
  });

  it('refuses invalid coordinates', async () => {
    const s = await startSession(A.owner, A.cls.id, { shareLocation: false });
    for (const body of [{ latitude: 120, longitude: 0 }, { latitude: 0, longitude: 0 }]) {
      const res = await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/location`, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_INVALID');
    }
  });

  it('students are told to wait until the lecturer location is saved', async () => {
    const s = await startSession(A.owner, A.cls.id, { shareLocation: false });
    const res = await verifyLoc(s.qr.token, await attemptFor(s.qr.token), reading(1, 5));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LECTURER_LOCATION_MISSING');
  });

  it('is limited to staff of the same organization', async () => {
    const s = await startSession(A.owner, A.cls.id);
    expect((await api(B.owner, 'post', `/attendance/sessions/${s.session.id}/location`, CLASS_LOCATION)).status).toBe(404);
    expect((await (await app()).post(`/api/v1/attendance/sessions/${s.session.id}/location`).send(CLASS_LOCATION)).status).toBe(401);
  });

  it('never sends the lecturer coordinates to students', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await (await app()).post(`${base}/${s.qr.token}/validate`);
    const ok = await verifyLoc(s.qr.token, v.body.data.attemptToken, reading(3, 5));
    for (const body of [v.body, ok.body]) expect(JSON.stringify(body)).not.toContain(String(CLASS_LOCATION.latitude));
  });
});

describe('student comparison', () => {
  let qr: string;
  let attempt: string;
  beforeAll(async () => {
    qr = (await startSession(A.owner, A.cls.id, { durationMinutes: 60 })).qr.token;
    attempt = await attemptFor(qr);
  });

  it.each([0, 5, 10, 15, 19, 20])('%i m away: in class', async (m) => {
    const res = await verifyLoc(qr, attempt, reading(m, 8));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ accepted: true, distanceM: m, maximumDistanceMeters: 20 });
  });

  it.each([21, 50, 5_000])('%i m away: not in class', async (m) => {
    const res = await verifyLoc(qr, attempt, reading(m, 8));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'NOT_IN_CLASS', errors: { distanceM: m, maximumDistanceMeters: 20 } });
    expect(res.body.message).toMatch(/not in class/i);
  });

  it('the reported accuracy does not change the decision', async () => {
    expect((await verifyLoc(qr, attempt, reading(10, 5_000))).status).toBe(200);
    expect((await verifyLoc(qr, attempt, { ...north(10) })).status).toBe(200);
    expect((await verifyLoc(qr, attempt, reading(25, 5_000))).status).toBe(403);
  });

  it('refuses a missing or invalid student location', async () => {
    for (const body of [{}, { latitude: 123, longitude: 0 }, { latitude: 0, longitude: 0 }]) {
      const res = await verifyLoc(qr, attempt, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_INVALID');
    }
  });

  it('a student who is not in class cannot continue to the student ID step', async () => {
    const res = await (await app()).post(`${base}/${qr}/verify-student`).set('X-Attempt-Token', attempt).send({ studentId: '20240001' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCATION_NOT_VERIFIED');
  });
});

describe('recording attendance', () => {
  it('stores the server-computed distance and ignores client-supplied values', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001', { ...reading(7, 4), distanceM: 0 });
    if (flow.stage !== 'ready') throw new Error(`flow stopped at ${flow.stage}`);
    const res = await submitAttendance(s.qr.token, flow.attemptToken, { latitude: 0, longitude: 0, distanceM: 0 });
    expect(res.status).toBe(201);
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { sessionId: s.session.id } });
    expect(rec.locationVerified).toBe(true);
    expect(rec.distanceM).toBeCloseTo(7, 0);
    expect(rec.latitude).toBeCloseTo(north(7).latitude, 6);
  });

  it('if the lecturer moves, accepted students are compared with the new location at submit', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const flow = await publicFlow(s.qr.token, '20240002', reading(10, 3));
    if (flow.stage !== 'ready') throw new Error('flow');
    expect((await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/location`, north(40))).status).toBe(200);
    const res = await submitAttendance(s.qr.token, flow.attemptToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_IN_CLASS');
    expect(await prisma.attendanceRecord.count({ where: { sessionId: s.session.id } })).toBe(0);
  });

  it('a session without location verification needs no location', async () => {
    const s = await startSession(A.owner, A.cls.id, { locationVerificationEnabled: false });
    expect((await publicFlow(s.qr.token, '20240001')).stage).toBe('ready');
  });
});
