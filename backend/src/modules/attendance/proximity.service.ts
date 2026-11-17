import { checkFreshness, haversineMeters, isValidAccuracy, isValidLatitude, isValidLongitude } from '../../lib/geo.js';

/**
 * Lecturer-generated QR proximity verification.
 *
 * The reference point of an attendance session is the lecturer's own GPS position, captured when
 * the QR code is generated and fixed for the whole session. A student is accepted only when the
 * server — never the browser — can say with the device's own reported uncertainty that they are
 * within MAXIMUM_DISTANCE_METERS of that point:
 *
 *   distance + accuracy <= 20  → LOCATION_ACCEPTED
 *   distance − accuracy  > 20  → LOCATION_OUTSIDE_RADIUS
 *   otherwise                  → LOCATION_UNCERTAIN (retry; never shown as "outside")
 *
 * The 20 m limit is never widened to compensate for poor accuracy. Browser coordinates are
 * untrusted input and can be spoofed: this improves proximity checking, it does not prove presence.
 */

export const MAXIMUM_DISTANCE_METERS = 20;
/** Distances are compared at 1 cm resolution so floating-point noise cannot decide a boundary case. */
const cm = (m: number) => Math.round(m * 100) / 100;

export type ProximityOutcome =
  | 'LOCATION_ACCEPTED'
  | 'LOCATION_OUTSIDE_RADIUS'
  | 'LOCATION_UNCERTAIN'
  | 'LOCATION_ACQUISITION_FAILED'
  | 'LOCATION_STALE'
  | 'LECTURER_REFERENCE_LOCATION_INVALID'
  | 'ATTENDANCE_SESSION_EXPIRED';

/** Why a result is uncertain or failed (shown to staff in verification logs). */
export type ProximityReason =
  | 'POOR_ACCURACY' // the device's uncertainty is above the student threshold
  | 'BOUNDARY' // the uncertainty circle straddles the 20 m limit
  | 'MISSING_READING'
  | 'INVALID_COORDINATES'
  | 'MISSING_ACCURACY'
  | 'NO_READING_TIMESTAMP'
  | 'READING_TOO_OLD'
  | 'NO_REFERENCE'
  | 'SESSION_NOT_ACTIVE';

export type GpsReading = {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  /** Position.timestamp (client clock). */
  timestamp?: number | null;
  /** Client clock when the reading was sent (same clock as `timestamp`). */
  clientTime?: number | null;
};

export type ProximityResult = {
  outcome: ProximityOutcome;
  accepted: boolean;
  /** The student may try again with a new reading. */
  retryable: boolean;
  reason?: ProximityReason;
  distanceMeters?: number;
  accuracyMeters?: number;
  ageSeconds?: number;
  maximumDistanceMeters: number;
  flags: string[];
};

export type ReferencePoint = { latitude: number | null; longitude: number | null };
export type ProximityPolicy = {
  maximumDistanceMeters: number;
  /** Student readings less precise than this are uncertain (retry), not rejected. */
  studentMaxAccuracyM: number;
  maxLocationAgeSeconds: number;
  /** New clients always send the reading timestamp; a reading without one is treated as stale. */
  requireTimestamp?: boolean;
};

const result = (r: Omit<ProximityResult, 'accepted'>): ProximityResult => ({ ...r, accepted: r.outcome === 'LOCATION_ACCEPTED' });

export function hasValidReference(ref: ReferencePoint): ref is { latitude: number; longitude: number } {
  return isValidLatitude(ref.latitude) && isValidLongitude(ref.longitude);
}

/** Server-side decision for one student reading against the session's fixed reference point. */
export function evaluateProximity(input: {
  session: { status: string; expiresAt: Date };
  reference: ReferencePoint;
  reading: GpsReading | null | undefined;
  policy: ProximityPolicy;
  now?: Date;
}): ProximityResult {
  const { session, reference, reading, policy } = input;
  const max = policy.maximumDistanceMeters;
  const flags: string[] = [];
  const now = input.now ?? new Date();

  if (session.status !== 'ACTIVE' || session.expiresAt <= now) {
    return result({ outcome: 'ATTENDANCE_SESSION_EXPIRED', retryable: false, reason: 'SESSION_NOT_ACTIVE', maximumDistanceMeters: max, flags });
  }
  if (!hasValidReference(reference)) {
    return result({ outcome: 'LECTURER_REFERENCE_LOCATION_INVALID', retryable: false, reason: 'NO_REFERENCE', maximumDistanceMeters: max, flags });
  }
  if (!reading || reading.latitude == null || reading.longitude == null) {
    return result({ outcome: 'LOCATION_ACQUISITION_FAILED', retryable: true, reason: 'MISSING_READING', maximumDistanceMeters: max, flags });
  }
  if (!isValidLatitude(reading.latitude) || !isValidLongitude(reading.longitude)) {
    return result({ outcome: 'LOCATION_ACQUISITION_FAILED', retryable: true, reason: 'INVALID_COORDINATES', maximumDistanceMeters: max, flags });
  }
  if (!isValidAccuracy(reading.accuracy)) {
    return result({ outcome: 'LOCATION_ACQUISITION_FAILED', retryable: true, reason: 'MISSING_ACCURACY', maximumDistanceMeters: max, flags });
  }
  const fresh = checkFreshness(reading, policy.maxLocationAgeSeconds, { requireTimestamp: policy.requireTimestamp });
  flags.push(...fresh.flags);
  if (!fresh.ok) {
    return result({
      outcome: 'LOCATION_STALE', retryable: true, reason: Number.isNaN(fresh.ageMs) ? 'NO_READING_TIMESTAMP' : 'READING_TOO_OLD',
      ...(Number.isNaN(fresh.ageMs) ? {} : { ageSeconds: Math.round(fresh.ageMs / 1000) }), accuracyMeters: reading.accuracy, maximumDistanceMeters: max, flags,
    });
  }

  const accuracy = reading.accuracy;
  if (accuracy < 1) flags.push('ACCURACY_IMPLAUSIBLY_PRECISE');
  if (reading.latitude === reference.latitude && reading.longitude === reference.longitude) flags.push('COORDINATES_IDENTICAL_TO_REFERENCE');
  const distance = haversineMeters(reference.latitude, reference.longitude, reading.latitude, reading.longitude);
  const base = { distanceMeters: distance, accuracyMeters: accuracy, maximumDistanceMeters: max, flags };

  // Confidently outside even after allowing for the device's uncertainty.
  if (cm(distance - accuracy) > max) return result({ outcome: 'LOCATION_OUTSIDE_RADIUS', retryable: false, ...base });
  // Too imprecise to decide: ask for a better reading (never reported as "outside").
  if (accuracy > policy.studentMaxAccuracyM) return result({ outcome: 'LOCATION_UNCERTAIN', retryable: true, reason: 'POOR_ACCURACY', ...base });
  if (cm(distance + accuracy) <= max) return result({ outcome: 'LOCATION_ACCEPTED', retryable: false, ...base });
  return result({ outcome: 'LOCATION_UNCERTAIN', retryable: true, reason: 'BOUNDARY', ...base });
}

/* ── Lecturer reference point ──────────────────────────────────────────────── */

export type ReferenceCheck =
  | { ok: true; latitude: number; longitude: number; accuracyMeters: number; flags: string[] }
  | { ok: false; outcome: 'LECTURER_REFERENCE_LOCATION_INVALID'; reason: Exclude<ProximityReason, 'BOUNDARY' | 'NO_REFERENCE' | 'SESSION_NOT_ACTIVE'>; accuracyMeters?: number; ageSeconds?: number };

/**
 * A reference point is only saved from a fresh, valid reading whose uncertainty meets the
 * lecturer threshold. A poor reading is refused — it is never stored "for now".
 */
export function validateReferenceReading(reading: GpsReading | null | undefined, policy: { lecturerMaxAccuracyM: number; maxLocationAgeSeconds: number }): ReferenceCheck {
  const fail = (reason: Extract<ReferenceCheck, { ok: false }>['reason'], extra: { accuracyMeters?: number; ageSeconds?: number } = {}): ReferenceCheck =>
    ({ ok: false, outcome: 'LECTURER_REFERENCE_LOCATION_INVALID', reason, ...extra });
  if (!reading || reading.latitude == null || reading.longitude == null) return fail('MISSING_READING');
  if (!isValidLatitude(reading.latitude) || !isValidLongitude(reading.longitude)) return fail('INVALID_COORDINATES');
  // (0, 0) is what some broken providers report when they have no fix.
  if (reading.latitude === 0 && reading.longitude === 0) return fail('INVALID_COORDINATES');
  if (!isValidAccuracy(reading.accuracy)) return fail('MISSING_ACCURACY');
  const fresh = checkFreshness(reading, policy.maxLocationAgeSeconds, { requireTimestamp: true });
  if (!fresh.ok) return fail(Number.isNaN(fresh.ageMs) ? 'NO_READING_TIMESTAMP' : 'READING_TOO_OLD', Number.isNaN(fresh.ageMs) ? {} : { ageSeconds: Math.round(fresh.ageMs / 1000) });
  if (reading.accuracy > policy.lecturerMaxAccuracyM) return fail('POOR_ACCURACY', { accuracyMeters: reading.accuracy });
  return { ok: true, latitude: reading.latitude, longitude: reading.longitude, accuracyMeters: reading.accuracy, flags: fresh.flags };
}

/* ── Messages ──────────────────────────────────────────────────────────────── */

const m = (n: number | undefined) => `${Math.round(n ?? 0).toLocaleString('en')} m`;

/** Student-facing explanations. Poor accuracy is never described as being outside. */
export function proximityMessage(r: Pick<ProximityResult, 'outcome' | 'reason' | 'distanceMeters' | 'accuracyMeters' | 'maximumDistanceMeters'>): string {
  const max = r.maximumDistanceMeters;
  switch (r.outcome) {
    case 'LOCATION_ACCEPTED':
      return `Location accepted — you are within ${max} m of your lecturer.`;
    case 'LOCATION_OUTSIDE_RADIUS':
      return `You are about ${m(r.distanceMeters)} from your lecturer, which is outside the ${max} m attendance distance (your reading was ±${m(r.accuracyMeters)}). Move closer to where your lecturer generated the QR code and try again.`;
    case 'LOCATION_UNCERTAIN':
      return r.reason === 'POOR_ACCURACY'
        ? `Your location is only accurate to about ±${m(r.accuracyMeters)}, which is too imprecise to check the ${max} m attendance distance. Turn on precise location (GPS), move near a window or step away from thick walls, stand still for a few seconds and try again.`
        : `We could not confirm that you are within ${max} m of your lecturer (your reading was ±${m(r.accuracyMeters)}). Stand still for a few seconds so your phone can get a more precise fix, then try again.`;
    case 'LOCATION_STALE':
      return 'Your device returned an old (cached) location. Please try again to get a fresh reading.';
    case 'LOCATION_ACQUISITION_FAILED':
      return 'Your device did not return a usable location. Check that location services (GPS) are on and that this browser may use your location, then try again.';
    case 'LECTURER_REFERENCE_LOCATION_INVALID':
      return 'This session does not have a valid lecturer location, so attendance cannot be checked by location. Ask your lecturer to update the session location.';
    case 'ATTENDANCE_SESSION_EXPIRED':
      return 'This attendance session has ended. Ask your lecturer for a new QR code.';
  }
}

/** Lecturer-facing explanations for a refused reference reading. */
export function referenceMessage(r: Extract<ReferenceCheck, { ok: false }>, maxAccuracyM: number): string {
  switch (r.reason) {
    case 'POOR_ACCURACY':
      return `Your device reported location uncertainty of approximately ${m(r.accuracyMeters)} (the limit is ${maxAccuracyM} m). This reading cannot be used as the attendance reference point. Use a phone with GPS turned on, move near a window or outdoors, and try again.`;
    case 'READING_TOO_OLD':
    case 'NO_READING_TIMESTAMP':
      return 'The location reading was old (cached). Try again to get a fresh GPS reading.';
    case 'MISSING_ACCURACY':
      return 'The location reading did not include its accuracy, so it cannot be used as the reference point.';
    default:
      return 'Your device did not return a valid location. Check that location services are on and try again.';
  }
}
