import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../src/lib/geo.js';
import { compareLocations, isValidPoint, LOCATION_MESSAGES, MAX_DISTANCE_METERS, reportedAccuracy } from '../../src/modules/attendance/location.service.js';
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

describe('location comparison (20 m)', () => {
  const lecturer = { latitude: 8.4844, longitude: -13.2344 };
  const away = (m: number) => ({ latitude: lecturer.latitude + m / 111_195, longitude: lecturer.longitude });

  it('the limit is 20 m', () => expect(MAX_DISTANCE_METERS).toBe(20));
  it.each([0, 5, 10, 15, 19, 20])('%i m is in class', (m) => expect(compareLocations(lecturer, away(m)).inClass).toBe(true));
  it.each([20.02, 21, 50, 1000])('%f m is not in class', (m) => expect(compareLocations(lecturer, away(m)).inClass).toBe(false));
  it('computes the distance', () => expect(compareLocations(lecturer, away(15)).distanceMeters).toBeCloseTo(15, 1));

  it('rejects unusable coordinates', () => {
    for (const p of [null, {}, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0 }, { latitude: Number.NaN, longitude: 1 }]) {
      expect(isValidPoint(p)).toBe(false);
    }
    expect(isValidPoint(lecturer)).toBe(true);
  });

  it('keeps only a sensible reported accuracy', () => {
    expect(reportedAccuracy({ accuracy: 12 })).toBe(12);
    expect(reportedAccuracy({ accuracy: -1 })).toBeNull();
    expect(reportedAccuracy({})).toBeNull();
  });

  it('tells the student they are not in class', () => {
    expect(LOCATION_MESSAGES.notInClass(64.2)).toBe('You are not in class. You are about 64 m from your lecturer and must be within 20 m to record attendance.');
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
