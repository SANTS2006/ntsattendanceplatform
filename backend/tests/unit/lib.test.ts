import { describe, expect, it } from 'vitest';
import { checkFreshness, haversineMeters } from '../../src/lib/geo.js';
import { evaluateProximity, MAXIMUM_DISTANCE_METERS, proximityMessage, referenceMessage, validateReferenceReading } from '../../src/modules/attendance/proximity.service.js';
import { normalizeStudentId, publicStudentIdFormat, validateStudentId, type StudentIdConfig } from '../../src/lib/studentId.js';
import { generateTotpSecret, totp, verifyTotp } from '../../src/lib/totp.js';
import { decrypt, encrypt, referenceNumber } from '../../src/lib/crypto.js';
import { scopeArgs } from '../../src/db/tenant.js';
import { dateInZone } from '../../src/lib/time.js';

const base: StudentIdConfig = {
  studentIdExactLength: 8, studentIdMinLength: 1, studentIdMaxLength: 32, studentIdCharset: 'NUMERIC', studentIdCustomPattern: null,
  studentIdPrefix: null, studentIdSuffix: null, studentIdCaseSensitive: false, studentIdAllowSpaces: false,
};

const ref = { latitude: 8.4844, longitude: -13.2344 };
/** `m` metres due north of the reference point. */
const north = (m: number) => ({ latitude: ref.latitude + m / 111_195, longitude: ref.longitude });

describe('haversine', () => {
  it('computes known distances', () => {
    // ~111.2 km per degree of latitude
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(111_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(111_400);
    expect(haversineMeters(8.4844, -13.2344, 8.4844, -13.2344)).toBe(0);
  });

  it('uses degrees and metres with latitude/longitude in the right order', () => {
    expect(haversineMeters(ref.latitude, ref.longitude, north(15).latitude, north(15).longitude)).toBeCloseTo(15, 0);
    // East-west distance shrinks with cos(latitude): 1e-4° of longitude at 8.48° N ≈ 11.0 m.
    expect(haversineMeters(ref.latitude, ref.longitude, ref.latitude, ref.longitude + 0.0001)).toBeCloseTo(11.0, 0);
  });
});

describe('proximity verification (lecturer reference point, 20 m)', () => {
  const active = { status: 'ACTIVE', expiresAt: new Date(Date.now() + 600_000) };
  const policy = { maximumDistanceMeters: MAXIMUM_DISTANCE_METERS, studentMaxAccuracyM: 20, maxLocationAgeSeconds: 30, requireTimestamp: true };
  const at = (m: number, accuracy: number, ageMs = 1_000) => ({ ...north(m), accuracy, timestamp: Date.now() - ageMs, clientTime: Date.now() });
  const check = (reading: Parameters<typeof evaluateProximity>[0]['reading'], over: Partial<Parameters<typeof evaluateProximity>[0]> = {}) =>
    evaluateProximity({ session: active, reference: ref, reading, policy, ...over });

  it('the limit is fixed at 20 metres', () => {
    expect(MAXIMUM_DISTANCE_METERS).toBe(20);
  });

  // Exact device readings (accuracy 0) isolate the distance rule.
  it.each([
    [0, 'LOCATION_ACCEPTED'], [5, 'LOCATION_ACCEPTED'], [10, 'LOCATION_ACCEPTED'], [15, 'LOCATION_ACCEPTED'],
    [19, 'LOCATION_ACCEPTED'], [20, 'LOCATION_ACCEPTED'], [21, 'LOCATION_OUTSIDE_RADIUS'], [50, 'LOCATION_OUTSIDE_RADIUS'],
  ])('student at %i m (exact reading) → %s', (m, outcome) => {
    const r = check(at(m, 0));
    expect(r.outcome).toBe(outcome);
    expect(r.distanceMeters).toBeCloseTo(m, 1);
    expect(r.maximumDistanceMeters).toBe(20);
  });

  // Realistic readings: accept only when distance + accuracy ≤ 20.
  it.each([
    [0, 5, 'LOCATION_ACCEPTED'], [5, 5, 'LOCATION_ACCEPTED'], [10, 10, 'LOCATION_ACCEPTED'], [15, 5, 'LOCATION_ACCEPTED'],
    [15, 6, 'LOCATION_UNCERTAIN'], [19, 1, 'LOCATION_ACCEPTED'], [19, 5, 'LOCATION_UNCERTAIN'], [20, 3, 'LOCATION_UNCERTAIN'],
    [21, 3, 'LOCATION_UNCERTAIN'], [24, 3, 'LOCATION_OUTSIDE_RADIUS'], [50, 10, 'LOCATION_OUTSIDE_RADIUS'],
  ])('student at %i m with ±%i m → %s', (m, acc, outcome) => {
    expect(check(at(m, acc)).outcome).toBe(outcome);
  });

  it('boundary straddling is uncertain (retry), never a rejection', () => {
    const r = check(at(18, 8));
    expect(r).toMatchObject({ outcome: 'LOCATION_UNCERTAIN', reason: 'BOUNDARY', retryable: true, accepted: false });
    expect(proximityMessage(r)).not.toMatch(/outside/i);
  });

  it('poor student accuracy is uncertain with retry guidance, even when the student is at the lecturer', () => {
    const r = check(at(0, 45));
    expect(r).toMatchObject({ outcome: 'LOCATION_UNCERTAIN', reason: 'POOR_ACCURACY', retryable: true });
    expect(proximityMessage(r)).toContain('±45 m');
    expect(proximityMessage(r)).not.toMatch(/outside/i);
    // The 20 m limit is never widened to compensate for poor accuracy.
    expect(check(at(25, 25)).outcome).toBe('LOCATION_UNCERTAIN');
  });

  it('a very imprecise reading that is still confidently far away is outside', () => {
    expect(check(at(5_000, 500)).outcome).toBe('LOCATION_OUTSIDE_RADIUS');
  });

  it('stale or timestamp-less readings are LOCATION_STALE', () => {
    expect(check(at(0, 5, 31_000))).toMatchObject({ outcome: 'LOCATION_STALE', reason: 'READING_TOO_OLD', ageSeconds: 31, retryable: true });
    expect(check({ ...north(0), accuracy: 5 })).toMatchObject({ outcome: 'LOCATION_STALE', reason: 'NO_READING_TIMESTAMP' });
    // Without the requirement (server-signed claims) a missing timestamp is only flagged.
    expect(check({ ...north(0), accuracy: 5 }, { policy: { ...policy, requireTimestamp: false } }).outcome).toBe('LOCATION_ACCEPTED');
  });

  it('invalid or missing readings are LOCATION_ACQUISITION_FAILED', () => {
    expect(check(null)).toMatchObject({ outcome: 'LOCATION_ACQUISITION_FAILED', reason: 'MISSING_READING' });
    expect(check({ latitude: 91, longitude: 0, accuracy: 5, timestamp: Date.now(), clientTime: Date.now() })).toMatchObject({ reason: 'INVALID_COORDINATES' });
    expect(check({ latitude: 8, longitude: 181, accuracy: 5, timestamp: Date.now(), clientTime: Date.now() })).toMatchObject({ reason: 'INVALID_COORDINATES' });
    expect(check({ ...north(0), accuracy: -1, timestamp: Date.now(), clientTime: Date.now() })).toMatchObject({ reason: 'MISSING_ACCURACY' });
    expect(check({ ...north(0), accuracy: null, timestamp: Date.now(), clientTime: Date.now() })).toMatchObject({ reason: 'MISSING_ACCURACY' });
  });

  it('a session without a valid reference point cannot accept anyone', () => {
    expect(check(at(0, 5), { reference: { latitude: null, longitude: null } }).outcome).toBe('LECTURER_REFERENCE_LOCATION_INVALID');
    expect(check(at(0, 5), { reference: { latitude: 95, longitude: 0 } }).outcome).toBe('LECTURER_REFERENCE_LOCATION_INVALID');
  });

  it('expired or closed sessions are ATTENDANCE_SESSION_EXPIRED', () => {
    expect(check(at(0, 5), { session: { status: 'ACTIVE', expiresAt: new Date(Date.now() - 1) } }).outcome).toBe('ATTENDANCE_SESSION_EXPIRED');
    expect(check(at(0, 5), { session: { status: 'CLOSED', expiresAt: active.expiresAt } }).outcome).toBe('ATTENDANCE_SESSION_EXPIRED');
  });

  it('flags implausible readings for staff review without changing the decision', () => {
    const r = check({ ...ref, accuracy: 0, timestamp: Date.now(), clientTime: Date.now() });
    expect(r.outcome).toBe('LOCATION_ACCEPTED');
    expect(r.flags).toEqual(expect.arrayContaining(['ACCURACY_IMPLAUSIBLY_PRECISE', 'COORDINATES_IDENTICAL_TO_REFERENCE']));
  });
});

describe('lecturer reference reading', () => {
  const policy = { lecturerMaxAccuracyM: 20, maxLocationAgeSeconds: 30 };
  const lect = (accuracy: number, ageMs = 1_000) => ({ ...ref, accuracy, timestamp: Date.now() - ageMs, clientTime: Date.now() });

  it('accepts a fresh, precise reading', () => {
    expect(validateReferenceReading(lect(8), policy)).toMatchObject({ ok: true, ...ref, accuracyMeters: 8 });
    expect(validateReferenceReading(lect(20), policy).ok).toBe(true);
  });

  it.each([21, 1_000, 20_000])('refuses ±%i m (never saved)', (acc) => {
    const r = validateReferenceReading(lect(acc), policy);
    expect(r).toMatchObject({ ok: false, outcome: 'LECTURER_REFERENCE_LOCATION_INVALID', reason: 'POOR_ACCURACY', accuracyMeters: acc });
    if (!r.ok) expect(referenceMessage(r, 20)).toContain(`approximately ${acc.toLocaleString('en')} m`);
  });

  it('refuses stale, timestamp-less, invalid and (0,0) readings', () => {
    expect(validateReferenceReading(lect(5, 31_000), policy)).toMatchObject({ ok: false, reason: 'READING_TOO_OLD' });
    expect(validateReferenceReading({ ...ref, accuracy: 5 }, policy)).toMatchObject({ ok: false, reason: 'NO_READING_TIMESTAMP' });
    expect(validateReferenceReading({ latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now(), clientTime: Date.now() }, policy)).toMatchObject({ ok: false, reason: 'INVALID_COORDINATES' });
    expect(validateReferenceReading({ latitude: -91, longitude: 0, accuracy: 5, timestamp: Date.now(), clientTime: Date.now() }, policy)).toMatchObject({ ok: false, reason: 'INVALID_COORDINATES' });
    expect(validateReferenceReading(null, policy)).toMatchObject({ ok: false, reason: 'MISSING_READING' });
  });

  it('freshness: rejects stale readings and tolerates skewed clocks with a flag', () => {
    const now = Date.now();
    expect(checkFreshness({ timestamp: now - 2_000, clientTime: now }, 30)).toMatchObject({ ok: true, ageMs: 2_000 });
    expect(checkFreshness({ timestamp: now - 31_000, clientTime: now }, 30)).toMatchObject({ ok: false, code: 'STALE', ageMs: 31_000 });
    expect(checkFreshness({}, 30)).toMatchObject({ ok: true, flags: ['NO_READING_TIMESTAMP'] });
    expect(checkFreshness({}, 30, { requireTimestamp: true }).ok).toBe(false);
    expect(checkFreshness({ timestamp: now + 60_000, clientTime: now }, 30)).toMatchObject({ ok: true, flags: ['READING_TIMESTAMP_IN_FUTURE'] });
  });
});

describe('student ID rules', () => {
  it('enforces exact length and charset', () => {
    expect(validateStudentId('20240001', base)).toEqual({ valid: true, normalized: '20240001' });
    expect(validateStudentId('2024001', base).valid).toBe(false);
    expect(validateStudentId('2024000A', base).valid).toBe(false);
  });
  it('normalizes spaces and case', () => {
    expect(normalizeStudentId(' ab 12 ', { studentIdCaseSensitive: false, studentIdAllowSpaces: false })).toBe('AB12');
    expect(normalizeStudentId('ab  12', { studentIdCaseSensitive: true, studentIdAllowSpaces: true })).toBe('ab 12');
  });
  it('enforces prefix/suffix and custom patterns safely', () => {
    const cfg: StudentIdConfig = { ...base, studentIdExactLength: null, studentIdMinLength: 5, studentIdMaxLength: 12, studentIdCharset: 'CUSTOM', studentIdCustomPattern: '0-9/', studentIdPrefix: 'UNI', studentIdSuffix: null };
    expect(validateStudentId('uni2024/01', cfg).valid).toBe(true);
    expect(validateStudentId('XYZ2024/01', cfg).valid).toBe(false);
    // Regex metacharacters in a custom pattern are refused (fallback to alphanumeric)
    const evil: StudentIdConfig = { ...cfg, studentIdCustomPattern: '.*]|(' };
    expect(validateStudentId('UNI<script>', evil).valid).toBe(false);
  });
  it('exposes a public format for the counter UI', () => {
    expect(publicStudentIdFormat(base)).toMatchObject({ exactLength: 8, maxLength: 8, minLength: 8 });
  });
});

describe('crypto helpers', () => {
  it('round-trips AES-GCM and detects tampering', () => {
    const c = encrypt('secret');
    expect(decrypt(c)).toBe('secret');
    const parts = c.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('generates non-sequential reference numbers', () => {
    const set = new Set(Array.from({ length: 2000 }, referenceNumber));
    expect(set.size).toBe(2000);
    expect([...set][0]).toMatch(/^NTS-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });
  it('verifies TOTP within drift window only', () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totp(s, now), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 120_000), now)).toBe(false);
  });
});

describe('tenant query scoping', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  it('injects organizationId into reads and overrides caller-supplied tenant ids', () => {
    expect(scopeArgs('Student', 'findMany', { where: { organizationId: 'evil' } }, org).where.organizationId).toBe(org);
    expect(scopeArgs('Student', 'findUnique', { where: { id: 'x' } }, org).where).toEqual({ id: 'x', organizationId: org });
  });
  it('forces organizationId on creates and strips it from updates', () => {
    expect(scopeArgs('Student', 'create', { data: { organizationId: 'evil', x: 1 } }, org).data.organizationId).toBe(org);
    expect(scopeArgs('Student', 'createMany', { data: [{ organizationId: 'evil' }] }, org).data[0].organizationId).toBe(org);
    expect(scopeArgs('Student', 'update', { where: { id: 'x' }, data: { organizationId: 'evil', a: 1 } }, org).data).toEqual({ a: 1 });
  });
  it('leaves non-tenant models untouched', () => {
    expect(scopeArgs('User', 'findMany', { where: { email: 'a' } }, org)).toEqual({ where: { email: 'a' } });
  });
});

describe('time zones', () => {
  it('computes the attendance date in the organization time zone', () => {
    const instant = new Date('2026-01-01T23:30:00Z');
    expect(dateInZone(instant, 'UTC')).toBe('2026-01-01');
    expect(dateInZone(instant, 'Asia/Tokyo')).toBe('2026-01-02');
  });
});
