import { describe, expect, it } from 'vitest';
import { checkLocation, haversineMeters, clampRadius } from '../../src/lib/geo.js';
import { normalizeStudentId, publicStudentIdFormat, validateStudentId, type StudentIdConfig } from '../../src/lib/studentId.js';
import { generateTotpSecret, totp, verifyTotp } from '../../src/lib/totp.js';
import { decrypt, encrypt, referenceNumber } from '../../src/lib/crypto.js';
import { scopeArgs } from '../../src/db/tenant.js';
import { dateInZone } from '../../src/lib/time.js';

const base: StudentIdConfig = {
  studentIdExactLength: 8, studentIdMinLength: 1, studentIdMaxLength: 32, studentIdCharset: 'NUMERIC', studentIdCustomPattern: null,
  studentIdPrefix: null, studentIdSuffix: null, studentIdCaseSensitive: false, studentIdAllowSpaces: false,
};

describe('haversine / geofence', () => {
  it('computes known distances', () => {
    // ~111.2 km per degree of latitude
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(111_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(111_400);
    expect(haversineMeters(8.4844, -13.2344, 8.4844, -13.2344)).toBe(0);
  });
  const policy = { required: true, latitude: 8.4844, longitude: -13.2344, radiusM: 20, minAccuracyM: 50 };
  it('accepts a location inside the radius (~11 m)', () => {
    const r = checkLocation(policy, { latitude: 8.4845, longitude: -13.2344, accuracy: 10 });
    expect(r.ok && r.verified).toBe(true);
  });
  it('limits the geofence to 14-20 m even when a session was configured larger', () => {
    // ~44 m away: rejected although the (legacy) session radius says 100 m.
    const r = checkLocation({ ...policy, radiusM: 100 }, { latitude: 8.4848, longitude: -13.2344, accuracy: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('OUTSIDE_GEOFENCE');
    // ~13 m away: accepted with a (legacy) 5 m radius because the minimum is 14 m.
    const near = checkLocation({ ...policy, radiusM: 5 }, { latitude: 8.48452, longitude: -13.2344, accuracy: 10 });
    expect(near.ok && near.verified).toBe(true);
    expect([clampRadius(5), clampRadius(17), clampRadius(100)]).toEqual([14, 17, 20]);
  });
  it('rejects outside radius', () => {
    const r = checkLocation(policy, { latitude: 8.49, longitude: -13.2344, accuracy: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('OUTSIDE_GEOFENCE');
  });
  it('rejects poor accuracy, invalid and missing coordinates', () => {
    expect(checkLocation(policy, { latitude: 8.4844, longitude: -13.2344, accuracy: 500 })).toMatchObject({ ok: false, code: 'GPS_ACCURACY_INSUFFICIENT' });
    expect(checkLocation(policy, { latitude: 91, longitude: 0, accuracy: 5 })).toMatchObject({ ok: false, code: 'INVALID_COORDINATES' });
    expect(checkLocation(policy, { latitude: 8.4, longitude: -13.2, accuracy: null })).toMatchObject({ ok: false, code: 'INVALID_COORDINATES' });
    expect(checkLocation(policy, {})).toMatchObject({ ok: false, code: 'LOCATION_REQUIRED' });
  });
  it('allows missing location when not required', () => {
    expect(checkLocation({ ...policy, required: false }, {})).toMatchObject({ ok: true, verified: false });
  });
  it('flags implausible precision', () => {
    const r = checkLocation(policy, { latitude: 8.4844, longitude: -13.2344, accuracy: 0 });
    expect(r.flags).toContain('ACCURACY_IMPLAUSIBLY_PRECISE');
    expect(r.flags).toContain('COORDINATES_IDENTICAL_TO_ANCHOR');
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
