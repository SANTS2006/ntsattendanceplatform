const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (Haversine). Arguments are degrees, latitude before longitude. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const isValidLatitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const isValidLongitude = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
/** Device-reported uncertainty (68 % radius, metres). */
export const isValidAccuracy = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/* ── Reading freshness ─────────────────────────────────────────────────────────
 * Browsers can return cached positions. The client sends the reading's own timestamp
 * (Position.timestamp) and its clock at send time; both come from the same (untrusted) clock,
 * so their difference is the reading's age independent of client/server clock offset.
 * This catches cached/stale readings from honest clients; it cannot stop spoofing. */
export type FreshnessInput = { timestamp?: number | null; clientTime?: number | null };
export type FreshnessResult =
  | { ok: true; ageMs: number | null; flags: string[] }
  | { ok: false; code: 'STALE'; ageMs: number; flags: string[] };

export function checkFreshness(input: FreshnessInput, maxAgeSeconds: number, opts: { requireTimestamp?: boolean } = {}): FreshnessResult {
  const { timestamp, clientTime } = input;
  if (timestamp == null || clientTime == null || !Number.isFinite(timestamp) || !Number.isFinite(clientTime)) {
    // Older clients sent no timestamp; new flows require one (treated as stale: retry with a fresh reading).
    if (opts.requireTimestamp) return { ok: false, code: 'STALE', ageMs: Number.NaN, flags: ['NO_READING_TIMESTAMP'] };
    return { ok: true, ageMs: null, flags: ['NO_READING_TIMESTAMP'] };
  }
  const ageMs = clientTime - timestamp;
  if (ageMs < -5_000) return { ok: true, ageMs, flags: ['READING_TIMESTAMP_IN_FUTURE'] };
  if (ageMs > maxAgeSeconds * 1000) return { ok: false, code: 'STALE', ageMs, flags: [] };
  return { ok: true, ageMs: Math.max(0, ageMs), flags: [] };
}
