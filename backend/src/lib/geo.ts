const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const isValidLatitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const isValidLongitude = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

export type LocationCheckInput = { latitude?: number | null; longitude?: number | null; accuracy?: number | null };
export type LocationPolicy = {
  required: boolean;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  minAccuracyM: number;
};
export type LocationFailureCode = 'LOCATION_REQUIRED' | 'INVALID_COORDINATES' | 'GPS_ACCURACY_INSUFFICIENT' | 'OUTSIDE_GEOFENCE' | 'STALE_LOCATION';
export type LocationResult =
  | { ok: true; verified: boolean; distanceM: number | null; accuracyM: number | null; flags: string[] }
  | { ok: false; code: LocationFailureCode; distanceM?: number; accuracyM?: number; flags: string[] };

/**
 * Server-authoritative geofence decision. The client only supplies raw coordinates and the
 * device-reported accuracy; distance and pass/fail are always computed here.
 * Browser geolocation is NOT proof of presence — `flags` record heuristics for review.
 */
/** Attendance geofence radius limits (metres). Older sessions/settings outside the range are clamped. */
export const GEOFENCE_MIN_M = 14;
export const GEOFENCE_MAX_M = 20;
export const clampRadius = (m: number) => Math.min(GEOFENCE_MAX_M, Math.max(GEOFENCE_MIN_M, Math.round(m)));

export function checkLocation(policy: LocationPolicy, input: LocationCheckInput): LocationResult {
  const flags: string[] = [];
  const has = input.latitude != null && input.longitude != null;
  if (!has) {
    return policy.required
      ? { ok: false, code: 'LOCATION_REQUIRED', flags }
      : { ok: true, verified: false, distanceM: null, accuracyM: null, flags };
  }
  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) return { ok: false, code: 'INVALID_COORDINATES', flags };
  const accuracy = input.accuracy;
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return { ok: false, code: 'INVALID_COORDINATES', flags };
  if (accuracy < 1) flags.push('ACCURACY_IMPLAUSIBLY_PRECISE');
  if (policy.latitude == null || policy.longitude == null) {
    return { ok: true, verified: false, distanceM: null, accuracyM: accuracy, flags };
  }
  if (input.latitude === policy.latitude && input.longitude === policy.longitude) flags.push('COORDINATES_IDENTICAL_TO_ANCHOR');
  const distance = haversineMeters(policy.latitude, policy.longitude, input.latitude, input.longitude);
  if (policy.required && accuracy > policy.minAccuracyM) {
    return { ok: false, code: 'GPS_ACCURACY_INSUFFICIENT', distanceM: distance, accuracyM: accuracy, flags };
  }
  if (distance > clampRadius(policy.radiusM)) {
    if (policy.required) return { ok: false, code: 'OUTSIDE_GEOFENCE', distanceM: distance, accuracyM: accuracy, flags };
    return { ok: true, verified: false, distanceM: distance, accuracyM: accuracy, flags };
  }
  return { ok: true, verified: true, distanceM: distance, accuracyM: accuracy, flags };
}

/* ── Reading freshness ─────────────────────────────────────────────────────────
 * Browsers can return cached positions. The client sends the reading's own timestamp
 * (Position.timestamp) and its clock at send time; both come from the same (untrusted) clock,
 * so their difference is the reading's age independent of client/server clock offset.
 * This catches cached/stale readings from honest clients; it cannot stop spoofing. */
export type FreshnessInput = { timestamp?: number | null; clientTime?: number | null };
export type FreshnessResult = { ok: true; ageMs: number | null; flags: string[] } | { ok: false; code: 'STALE_LOCATION'; ageMs: number; flags: string[] };

export function checkFreshness(input: FreshnessInput, maxAgeSeconds: number): FreshnessResult {
  const { timestamp, clientTime } = input;
  if (timestamp == null || clientTime == null || !Number.isFinite(timestamp) || !Number.isFinite(clientTime)) {
    return { ok: true, ageMs: null, flags: ['NO_READING_TIMESTAMP'] };
  }
  const ageMs = clientTime - timestamp;
  if (ageMs < -5_000) return { ok: true, ageMs, flags: ['READING_TIMESTAMP_IN_FUTURE'] };
  if (ageMs > maxAgeSeconds * 1000) return { ok: false, code: 'STALE_LOCATION', ageMs, flags: [] };
  return { ok: true, ageMs: Math.max(0, ageMs), flags: [] };
}

/* ── Venue (classroom anchor) registration ─────────────────────────────────────
 * A venue may only be registered from a GPS reading whose reported uncertainty meets the
 * capture policy, or placed manually on a map (recorded as MAP, never as GPS-verified). */
export type VenueSource = 'GPS' | 'MAP';
export type VenueFailureCode = 'INVALID_COORDINATES' | 'VENUE_SOURCE_REQUIRED' | 'VENUE_ACCURACY_REQUIRED' | 'VENUE_ACCURACY_INSUFFICIENT';
export type VenueResult = { ok: true; source: VenueSource; accuracyM: number | null } | { ok: false; code: VenueFailureCode; accuracyM?: number };

export function checkVenueReading(
  policy: { maxCaptureAccuracyM: number },
  input: { latitude?: number | null; longitude?: number | null; source?: string | null; accuracy?: number | null },
): VenueResult {
  if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) return { ok: false, code: 'INVALID_COORDINATES' };
  if (input.source !== 'GPS' && input.source !== 'MAP') return { ok: false, code: 'VENUE_SOURCE_REQUIRED' };
  if (input.source === 'MAP') return { ok: true, source: 'MAP', accuracyM: null };
  const acc = input.accuracy;
  if (acc == null || !Number.isFinite(acc) || acc < 0) return { ok: false, code: 'VENUE_ACCURACY_REQUIRED' };
  if (acc > policy.maxCaptureAccuracyM) return { ok: false, code: 'VENUE_ACCURACY_INSUFFICIENT', accuracyM: acc };
  return { ok: true, source: 'GPS', accuracyM: acc };
}

export const VENUE_MESSAGES: Record<VenueFailureCode, (acc?: number, max?: number) => string> = {
  INVALID_COORDINATES: () => 'The venue coordinates are not valid.',
  VENUE_SOURCE_REQUIRED: () => 'Say whether the venue location was captured by GPS or selected on the map.',
  VENUE_ACCURACY_REQUIRED: () => 'A GPS-captured venue must include the reading accuracy.',
  VENUE_ACCURACY_INSUFFICIENT: (acc, max) =>
    `Your device reported location uncertainty of approximately ${Math.round(acc ?? 0).toLocaleString('en')} metres (the limit is ${max} m). ` +
    'This reading cannot be used to register a venue. Retry with a GPS-enabled device at the venue, or select the location on the map.',
};
