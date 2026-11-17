import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { CLASS_LOCATION, api, getApp, lecturerReading, north, publicFlow, reading, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

/**
 * Lecturer-generated QR proximity verification: the lecturer's GPS position when the QR code is
 * generated is the session's fixed reference point; students must be within 20 m of it, decided on
 * the server with the device's reported uncertainty (accept / outside / uncertain).
 * Geometry: CLASS_LOCATION is the lecturer; `north(m)` is m metres away.
 */
let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
const base = '/api/v1/public/attendance';

beforeAll(async () => {
  await resetDb();
  A = await seedTenant('Proximity University');
  B = await seedTenant('Other College');
  await api(A.owner, 'patch', '/organizations/settings', { studentMaxAccuracyM: 20, lecturerMaxAccuracyM: 20, maxLocationAgeSeconds: 30, maxFailedLocationAttempts: 100 });
  await api(B.owner, 'patch', '/organizations/settings', { maxFailedLocationAttempts: 3 });
});

// Over a slow database link this file can outlive the 15-minute access token.
beforeEach(() => {
  for (const t of [A, B]) {
    const c = jwt.decode(t.owner.token) as { sub: string; org: string | null; sid: string };
    t.owner.token = signAccessToken({ sub: c.sub, org: c.org, sid: c.sid });
  }
});

const app = async () => request(await getApp());
async function attemptFor(qr: string) {
  return (await (await app()).post(`${base}/${qr}/validate`)).body.data.attemptToken as string;
}
async function verifyLoc(qr: string, attempt: string, body: Record<string, unknown>) {
  return (await app()).post(`${base}/${qr}/verify-location`).set('X-Attempt-Token', attempt).send(body);
}

describe('lecturer reference point', () => {
  it('saves the lecturer reading as the fixed reference point of the session', async () => {
    const s = await startSession(A.owner, A.cls.id, { reference: lecturerReading(6) });
    const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({
      referenceLatitude: CLASS_LOCATION.latitude, referenceLongitude: CLASS_LOCATION.longitude, referenceAccuracyMeters: 6,
      locationSource: 'LECTURER_GPS', locationVerificationEnabled: true, maximumDistanceMeters: 20, studentMaxAccuracyM: 20,
    });
    expect(row.referenceCapturedAt).toBeInstanceOf(Date);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'attendance_session.created', targetId: s.session.id } });
    expect(audit?.metadata).toMatchObject({ locationVerificationEnabled: true, maximumDistanceMeters: 20, reference: { accuracyMeters: 6, source: 'LECTURER_GPS' } });
  });

  it.each([25, 1_000, 20_000])('refuses a lecturer reading of ±%i m: no session, no QR code', async (acc) => {
    const before = await prisma.attendanceSession.count();
    const res = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, reference: lecturerReading(acc) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LECTURER_REFERENCE_LOCATION_INVALID');
    expect(res.body.errors).toMatchObject({ reason: 'POOR_ACCURACY', accuracyM: acc, maxAccuracyM: 20 });
    expect(res.body.message).toContain(`approximately ${acc.toLocaleString('en')} m`);
    expect(await prisma.attendanceSession.count()).toBe(before);
  });

  it('refuses stale, missing and invalid lecturer readings', async () => {
    const stale = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, reference: lecturerReading(5, 60_000) });
    expect(stale.body).toMatchObject({ code: 'LECTURER_REFERENCE_LOCATION_INVALID', errors: { reason: 'READING_TOO_OLD' } });
    const missing = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, reference: null });
    expect(missing.body).toMatchObject({ code: 'LECTURER_REFERENCE_LOCATION_INVALID', errors: { reason: 'MISSING_READING' } });
    const invalid = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, reference: { ...lecturerReading(), latitude: 120 } });
    expect(invalid.body).toMatchObject({ code: 'LECTURER_REFERENCE_LOCATION_INVALID', errors: { reason: 'INVALID_COORDINATES' } });
  });

  it('needs no reference when location verification is off', async () => {
    const s = await startSession(A.owner, A.cls.id, { reference: undefined, locationVerificationEnabled: false });
    const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({ locationVerificationEnabled: false, referenceLatitude: null });
    const flow = await publicFlow(s.qr.token, '20240001');
    expect(flow.stage).toBe('ready');
  });

  it('never sends the reference coordinates to students', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await (await app()).post(`${base}/${s.qr.token}/validate`);
    expect(v.body.data.session.locationPolicy).toMatchObject({ maximumDistanceMeters: 20, maxAccuracyM: 20, maxLocationAgeSeconds: 30 });
    const text = JSON.stringify(v.body);
    expect(text).not.toContain(String(CLASS_LOCATION.latitude));
    expect(text).not.toContain(String(CLASS_LOCATION.longitude));
    const ok = await verifyLoc(s.qr.token, v.body.data.attemptToken, reading(3, 5));
    expect(JSON.stringify(ok.body)).not.toContain(String(CLASS_LOCATION.latitude));
  });

  it('QR rotation and repeated scans never move the reference point', async () => {
    const s = await startSession(A.owner, A.cls.id, { qrRotationSeconds: 30 });
    const before = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/qr`);
    const attempt = await attemptFor(s.qr.token);
    await verifyLoc(s.qr.token, attempt, reading(5, 5));
    await verifyLoc(s.qr.token, attempt, reading(60, 5));
    const after = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(after).toMatchObject({ referenceLatitude: before.referenceLatitude, referenceLongitude: before.referenceLongitude, referenceCapturedAt: before.referenceCapturedAt });
  });
});

describe('student distance check (server-side)', () => {
  let qr: string;
  let attempt: string;
  beforeAll(async () => {
    qr = (await startSession(A.owner, A.cls.id, { durationMinutes: 60 })).qr.token;
    attempt = await attemptFor(qr);
  });

  // Exact readings (±0 m) isolate the distance rule; realistic readings follow.
  it.each([
    [0, 200, 'LOCATION_ACCEPTED'], [5, 200, 'LOCATION_ACCEPTED'], [10, 200, 'LOCATION_ACCEPTED'], [15, 200, 'LOCATION_ACCEPTED'],
    [19, 200, 'LOCATION_ACCEPTED'], [20, 200, 'LOCATION_ACCEPTED'], [21, 403, 'LOCATION_OUTSIDE_RADIUS'], [50, 403, 'LOCATION_OUTSIDE_RADIUS'],
  ])('student at %i m → %i %s', async (m, status, outcome) => {
    const res = await verifyLoc(qr, attempt, reading(m, 0));
    expect(res.status).toBe(status);
    if (status === 200) expect(res.body.data).toMatchObject({ outcome, accepted: true, distanceM: m, maximumDistanceMeters: 20 });
    else expect(res.body).toMatchObject({ code: outcome, errors: { outcome, distanceM: m, maximumDistanceMeters: 20, retryable: false } });
  });

  it('uncertain readings straddling 20 m ask for a retry (never "outside")', async () => {
    const res = await verifyLoc(qr, attempt, reading(18, 8));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'LOCATION_UNCERTAIN', errors: { reason: 'BOUNDARY', retryable: true, distanceM: 18, accuracyM: 8 } });
    expect(res.body.message).not.toMatch(/outside/i);
  });

  it('poor student accuracy is uncertain with retry guidance, not a rejection', async () => {
    const res = await verifyLoc(qr, attempt, reading(2, 60));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'LOCATION_UNCERTAIN', errors: { reason: 'POOR_ACCURACY', accuracyM: 60, retryable: true } });
    expect(res.body.message).toContain('±60 m');
    expect(res.body.message).not.toMatch(/outside/i);
  });

  it('stale readings are LOCATION_STALE', async () => {
    const res = await verifyLoc(qr, attempt, reading(0, 5, 45_000));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'LOCATION_STALE', errors: { reason: 'READING_TOO_OLD', ageSeconds: 45 } });
    const noTs = await verifyLoc(qr, attempt, { ...north(0), accuracy: 5 });
    expect(noTs.body).toMatchObject({ code: 'LOCATION_STALE', errors: { reason: 'NO_READING_TIMESTAMP' } });
  });

  it('invalid and missing coordinates are LOCATION_ACQUISITION_FAILED', async () => {
    for (const body of [{ ...reading(0, 5), latitude: 123 }, { ...reading(0, 5), longitude: -200 }, { ...reading(0, 5), accuracy: -3 }, {}]) {
      const res = await verifyLoc(qr, attempt, body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('LOCATION_ACQUISITION_FAILED');
    }
  });

  it('every decision is logged with distance and accuracy', async () => {
    const rows = await prisma.attendanceVerification.findMany({ where: { step: 'LOCATION', success: false, reasonCode: 'LOCATION_OUTSIDE_RADIUS' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].distanceM).toBeGreaterThan(20);
  });

  it('an expired session answers ATTENDANCE_SESSION_EXPIRED', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const att = await attemptFor(s.qr.token);
    await prisma.attendanceSession.update({ where: { id: s.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verifyLoc(s.qr.token, att, reading(0, 5));
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('ATTENDANCE_SESSION_EXPIRED');
  });
});

describe('end to end: accepted location → student ID → submit', () => {
  it('records attendance with the server-computed distance, never the client values', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001', reading(7, 4));
    if (flow.stage !== 'ready') throw new Error(`flow stopped at ${flow.stage}: ${JSON.stringify(flow.res.body)}`);
    const res = await submitAttendance(s.qr.token, flow.attemptToken, { latitude: 0, longitude: 0, distanceM: 0 });
    expect(res.status).toBe(201);
    expect(res.body.data.locationVerified).toBe(true);
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { sessionId: s.session.id } });
    expect(rec.locationVerified).toBe(true);
    expect(rec.distanceM).toBeCloseTo(7, 0);
    expect(rec.gpsAccuracyM).toBe(4);
    expect(rec.latitude).toBeCloseTo(north(7).latitude, 6);
    expect(rec.verificationMeta).toMatchObject({ proximity: { outcome: 'LOCATION_ACCEPTED', maximumDistanceMeters: 20, referenceAccuracyMeters: 5 } });
  });

  it('duplicate attendance is refused (same student, second scan)', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const first = await publicFlow(s.qr.token, '20240002');
    if (first.stage !== 'ready') throw new Error('flow');
    expect((await submitAttendance(s.qr.token, first.attemptToken)).status).toBe(201);
    const again = await publicFlow(s.qr.token, '20240002');
    expect(again.stage).toBe('student');
    if (again.stage === 'student') expect(again.res.body.code).toBe('ALREADY_RECORDED');
  });

  it('concurrent submissions create exactly one record', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const flow = await publicFlow(s.qr.token, '20240001');
    if (flow.stage !== 'ready') throw new Error('flow');
    const results = await Promise.all(Array.from({ length: 8 }, () => submitAttendance(s.qr.token, flow.attemptToken)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(await prisma.attendanceRecord.count({ where: { sessionId: s.session.id } })).toBe(1);
  });
});

describe('reference location changes', () => {
  it('requires an explicit, audited action with a reason, and re-checks accepted students at submit', async () => {
    const s = await startSession(A.owner, A.cls.id);
    // Student accepted 10 m from the original reference point.
    const flow = await publicFlow(s.qr.token, '20240001', reading(10, 3));
    if (flow.stage !== 'ready') throw new Error('flow');

    const noReason = await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/reference-location`, { reference: { ...lecturerReading(), ...north(40) } });
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('VALIDATION_ERROR');
    const poor = await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/reference-location`, { reference: { ...lecturerReading(300), ...north(40) }, reason: 'Moved to Lab 3' });
    expect(poor.body.code).toBe('LECTURER_REFERENCE_LOCATION_INVALID');

    const moved = await api(A.owner, 'post', `/attendance/sessions/${s.session.id}/reference-location`, { reference: { ...lecturerReading(4), ...north(40) }, reason: 'Moved to Lab 3' });
    expect(moved.status).toBe(200);
    const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row.referenceLatitude).toBeCloseTo(north(40).latitude, 7);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'attendance_session.reference_location_changed', targetId: s.session.id } });
    expect(audit.metadata).toMatchObject({ reason: 'Moved to Lab 3', current: { accuracyMeters: 4 }, previous: { latitude: CLASS_LOCATION.latitude } });
    expect((audit.metadata as { movedMeters: number }).movedMeters).toBeCloseTo(40, 0);

    // The earlier acceptance was 30 m from the new reference point: refused at submit.
    const res = await submitAttendance(s.qr.token, flow.attemptToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('LOCATION_OUTSIDE_RADIUS');
    expect(await prisma.attendanceRecord.count({ where: { sessionId: s.session.id } })).toBe(0);
  });

  it('only staff who can manage the session may change it, and never across tenants', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const other = await api(B.owner, 'post', `/attendance/sessions/${s.session.id}/reference-location`, { reference: lecturerReading(), reason: 'Not my session' });
    expect(other.status).toBe(404);
    const anon = await (await app()).post(`/api/v1/attendance/sessions/${s.session.id}/reference-location`).send({ reference: lecturerReading(), reason: 'Anonymous' });
    expect(anon.status).toBe(401);
  });
});

describe('isolation and abuse limits', () => {
  it('attempt tokens and sessions never cross tenants', async () => {
    const a = await startSession(A.owner, A.cls.id);
    const b = await startSession(B.owner, B.cls.id);
    const attemptA = await attemptFor(a.qr.token);
    const res = await verifyLoc(b.qr.token, attemptA, reading(0, 5));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_MISMATCH');
    expect((await api(B.owner, 'get', `/attendance/sessions/${a.session.id}`)).status).toBe(404);
  });

  it('repeated failed location checks from one client are rate limited', async () => {
    const s = await startSession(B.owner, B.cls.id);
    const att = await attemptFor(s.qr.token);
    for (let i = 0; i < 3; i++) expect((await verifyLoc(s.qr.token, att, reading(80, 5))).status).toBe(403);
    const blocked = await verifyLoc(s.qr.token, att, reading(0, 5));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('LOCATION_ATTEMPTS_EXCEEDED');
  });
});
