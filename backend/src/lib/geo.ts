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
export type LocationFailureCode = 'LOCATION_REQUIRED' | 'INVALID_COORDINATES' | 'GPS_ACCURACY_INSUFFICIENT' | 'OUTSIDE_GEOFENCE';
export type LocationResult =
  | { ok: true; verified: boolean; distanceM: number | null; accuracyM: number | null; flags: string[] }
  | { ok: false; code: LocationFailureCode; distanceM?: number; accuracyM?: number; flags: string[] };

/**
 * Server-authoritative geofence decision. The client only supplies raw coordinates and the
 * device-reported accuracy; distance and pass/fail are always computed here.
 * Browser geolocation is NOT proof of presence — `flags` record heuristics for review.
 */
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
  if (distance > policy.radiusM) {
    if (policy.required) return { ok: false, code: 'OUTSIDE_GEOFENCE', distanceM: distance, accuracyM: accuracy, flags };
    return { ok: true, verified: false, distanceM: distance, accuracyM: accuracy, flags };
  }
  return { ok: true, verified: true, distanceM: distance, accuracyM: accuracy, flags };
}
