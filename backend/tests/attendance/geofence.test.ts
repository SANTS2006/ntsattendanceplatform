import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { CLASS_LOCATION, api, getApp, publicFlow, resetDb, seedTenant, startSession, submitAttendance } from '../helpers.js';

/**
 * GPS geofencing: lecturer venue capture policy, manual map configuration, server-side student
 * verification (freshness → accuracy → distance), single-reading submit and tenant isolation.
 * Geometry: 0.0001° latitude ≈ 11.1 m. Venue = CLASS_LOCATION; radius 20 m; student max ±50 m.
 */
let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;
const base = '/api/v1/public/attendance';
const north = (m: number) => ({ latitude: CLASS_LOCATION.latitude + m / 111_195, longitude: CLASS_LOCATION.longitude });
const reading = (m: number, accuracy: number, ageMs = 1_000) => ({ ...north(m), accuracy, timestamp: Date.now() - ageMs, clientTime: Date.now() });

beforeAll(async () => {
  await resetDb();
  A = await seedTenant('Geo University');
  B = await seedTenant('Other College');
  for (const t of [A, B]) {
    await api(t.owner, 'patch', '/organizations/settings', { defaultGeofenceRadiusM: 20, minGpsAccuracyM: 50, venueCaptureMaxAccuracyM: 30, maxLocationAgeSeconds: 30, maxFailedLocationAttempts: 50 });
  }
});

// Over a slow link this file can outlive the 15-minute access token; re-sign it (same claims,
// same server session) before each test so expiry never masks a real result.
beforeEach(() => {
  for (const t of [A, B]) {
    const c = jwt.decode(t.owner.token) as { sub: string; org: string | null; sid: string };
    t.owner.token = signAccessToken({ sub: c.sub, org: c.org, sid: c.sid });
  }
});

async function verifyLoc(qr: string, attempt: string, body: Record<string, unknown>) {
  return request(await getApp()).post(`${base}/${qr}/verify-location`).set('X-Attempt-Token', attempt).send(body);
}
async function validated(qr: string) {
  return (await request(await getApp()).post(`${base}/${qr}/validate`)).body.data;
}

describe('lecturer venue capture', () => {
  it.each([20_000, 1_000])('refuses a GPS anchor with ±%i m uncertainty (never saved silently)', async (acc) => {
    const res = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, ...north(0), locationSource: 'GPS', locationAccuracyM: acc });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VENUE_ACCURACY_INSUFFICIENT');
    expect(res.body.message).toContain(`approximately ${acc.toLocaleString('en')} metres`);
    expect(res.body.errors).toMatchObject({ accuracyM: acc, maxAccuracyM: 30 });
  });

  it('accepts a precise GPS anchor and snapshots its provenance on the session', async () => {
    const s = await startSession(A.owner, A.cls.id, { ...north(0), locationSource: 'GPS', locationAccuracyM: 12 });
    const row = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(row).toMatchObject({ locationSource: 'GPS', locationAccuracyM: 12, maxLocationAgeSeconds: 30, radiusM: 20 });
  });

  it('requires provenance for coordinates', async () => {
    const res = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id, ...north(0) });
    expect(res.body.code).toBe('VENUE_SOURCE_REQUIRED');
  });

  it('class venues: GPS readings are gated, map placements are recorded as manual and audited', async () => {
    const bad = await api(A.owner, 'patch', `/classes/${A.cls.id}`, { ...{ defaultLatitude: 8.5, defaultLongitude: -13.2 }, venueLocationSource: 'GPS', venueAccuracyM: 20_000 });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VENUE_ACCURACY_INSUFFICIENT');
    const unchanged = await prisma.class.findUniqueOrThrow({ where: { id: A.cls.id } });
    expect(unchanged.defaultLatitude).toBe(CLASS_LOCATION.latitude);

    const map = await api(A.owner, 'patch', `/classes/${A.cls.id}`, { defaultLatitude: CLASS_LOCATION.latitude, defaultLongitude: CLASS_LOCATION.longitude, venueLocationSource: 'MAP', venueAccuracyM: 5 });
    expect(map.status).toBe(200);
    expect(map.body.data).toMatchObject({ venueLocationSource: 'MAP', venueAccuracyM: null });
    expect(map.body.data.venueCapturedAt).toBeTruthy();
    const audit = await prisma.auditLog.findFirst({ where: { targetId: A.cls.id, action: 'class.venue_location_set' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ source: 'MAP', latitude: CLASS_LOCATION.latitude });
  });

  it('refuses to anchor a session on a venue saved before verification existed', async () => {
    await prisma.class.update({ where: { id: A.cls.id }, data: { venueLocationSource: null } });
    const res = await api(A.owner, 'post', '/attendance/sessions', { classId: A.cls.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VENUE_NOT_VERIFIED');
    await prisma.class.update({ where: { id: A.cls.id }, data: { venueLocationSource: 'MAP' } });
  });

  it('exposes the location policy to the student client', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    expect(v.session.locationPolicy).toEqual({ radiusM: 20, maxAccuracyM: 50, maxLocationAgeSeconds: 30, timeoutSeconds: 60, sampleCount: 5, maxAttempts: 50, venueSource: 'MAP' });
  });
});

describe('student location verification (server-side)', () => {
  it.each([
    [5, 200, true],
    [20, 200, true],
    [50, 200, true],
    [100, 422, false],
    [1_000, 422, false],
    [20_000, 422, false],
  ])('a reading 5 m from the venue with ±%i m uncertainty → %i', async (acc, status, ok) => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    const res = await verifyLoc(s.qr.token, v.attemptToken, reading(5, acc));
    expect(res.status).toBe(status);
    if (ok) expect(res.body.data).toMatchObject({ withinGeofence: true, radiusM: 20 });
    else expect(res.body).toMatchObject({ code: 'GPS_ACCURACY_INSUFFICIENT', errors: { accuracyM: acc, maxAccuracyM: 50, radiusM: 20 } });
  });

  it('uses distance and uncertainty separately: the radius is never widened by accuracy', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    // 19 m away: inside. 21 m and 30 m away: outside even though ±40 m would "cover" the venue.
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(19, 8))).status).toBe(200);
    const out = await verifyLoc(s.qr.token, v.attemptToken, reading(21, 8));
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('OUTSIDE_GEOFENCE');
    expect(out.body.errors.distanceM).toBe(21);
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(30, 40))).body.code).toBe('OUTSIDE_GEOFENCE');
  });

  it('rejects stale (cached) readings and accepts fresh ones', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    const stale = await verifyLoc(s.qr.token, v.attemptToken, reading(3, 8, 120_000));
    expect(stale.status).toBe(422);
    expect(stale.body).toMatchObject({ code: 'STALE_LOCATION', errors: { ageSeconds: 120, maxLocationAgeSeconds: 30 } });
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(3, 8, 2_000))).status).toBe(200);
  });

  it('rejects invalid coordinates', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    for (const body of [{ latitude: 123, longitude: 0, accuracy: 5 }, { latitude: 8.48, longitude: -13.23, accuracy: -1 }, { latitude: 8.48, longitude: 'east', accuracy: 5 }]) {
      const res = await verifyLoc(s.qr.token, v.attemptToken, body);
      expect(res.status).toBe(422);
      expect(['VALIDATION_ERROR', 'INVALID_COORDINATES']).toContain(res.body.code);
    }
  });

  it('retry workflow: a poor reading does not end the attempt; a later good reading passes', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(4, 900))).status).toBe(422); // indoor, poor
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(4, 70))).status).toBe(422);
    expect((await verifyLoc(s.qr.token, v.attemptToken, reading(4, 15))).status).toBe(200);
  });

  it('submit reuses the server-verified location — no second reading can contradict it', async () => {
    const s = await startSession(A.owner, A.cls.id, { selfieRequired: false });
    const v = await validated(s.qr.token);
    const loc = await verifyLoc(s.qr.token, v.attemptToken, reading(6, 10));
    expect(loc.status).toBe(200);
    const stu = await request(await getApp()).post(`${base}/${s.qr.token}/verify-student`).set('X-Attempt-Token', loc.body.data.attemptToken).send({ studentId: A.students[0].studentNumber });
    expect(stu.status).toBe(200);
    // Body claims to be far away; the signed verified location is used instead.
    const res = await submitAttendance(s.qr.token, stu.body.data.attemptToken, { latitude: 9.9, longitude: -13.2, accuracy: 5, withinGeofence: true });
    expect(res.body.code).toBeUndefined();
    expect(res.status).toBe(201);
    expect(res.body.data.locationVerified).toBe(true);
    const rec = await prisma.attendanceRecord.findFirstOrThrow({ where: { sessionId: s.session.id } });
    expect(rec.distanceM).toBeLessThan(7);
    // Duplicate attendance is still prevented.
    const again = await submitAttendance(s.qr.token, stu.body.data.attemptToken, {});
    expect(again.status).toBe(409);
  });

  it('without a verified location, submit checks the submitted reading itself (never trusts client flags)', async () => {
    const s = await startSession(A.owner, A.cls.id);
    const flow = await publicFlow(s.qr.token, A.students[1].studentNumber);
    expect(flow.stage).toBe('ready');
    if (flow.stage !== 'ready') return;
    const far = await submitAttendance(s.qr.token, flow.attemptToken, { ...north(500), accuracy: 5, withinGeofence: true, distanceM: 0 });
    expect(far.status).toBe(403);
    expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
  });

  it('isolates tenants: an attempt token from one organization cannot be used on another', async () => {
    const sa = await startSession(A.owner, A.cls.id);
    const sb = await startSession(B.owner, B.cls.id);
    const va = await validated(sa.qr.token);
    const res = await verifyLoc(sb.qr.token, va.attemptToken, reading(2, 8));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ATTEMPT_MISMATCH');
  });

  it('enforces the retry limit per device', async () => {
    await api(A.owner, 'patch', '/organizations/settings', { maxFailedLocationAttempts: 2 });
    const s = await startSession(A.owner, A.cls.id);
    const v = await validated(s.qr.token);
    await verifyLoc(s.qr.token, v.attemptToken, reading(200, 8));
    await verifyLoc(s.qr.token, v.attemptToken, reading(200, 8));
    const third = await verifyLoc(s.qr.token, v.attemptToken, reading(2, 8));
    expect(third.status).toBe(429);
    expect(third.body.code).toBe('LOCATION_ATTEMPTS_EXCEEDED');
    await api(A.owner, 'patch', '/organizations/settings', { maxFailedLocationAttempts: 50 });
  });
});
