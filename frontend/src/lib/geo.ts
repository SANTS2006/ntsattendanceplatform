/**
 * NTS location acquisition service (lecturer reference point and student check-in).
 *
 * Why: a single getCurrentPosition() often returns the first, coarse fix — Wi-Fi/IP positioning
 * can be off by kilometres (laptops typically report ±1–20 km). We watch the position, keep only
 * fresh valid readings, pick the most precise one (never an average of scattered readings) and
 * stop once enough good readings agree, or when the time limit is reached.
 *
 * `enableHighAccuracy` is only a request: the device decides whether GPS is used. The returned
 * accuracy is the device's own estimate and must be judged by the caller's policy — and the
 * server re-validates everything.
 */
export type Reading = { latitude: number; longitude: number; accuracy: number; timestamp: number };
export type GeoErrorCode = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'INSECURE';

export class GeoError extends Error {
  constructor(readonly code: GeoErrorCode, message: string) {
    super(message);
  }
}

export const GEO_MESSAGES: Record<GeoErrorCode, string> = {
  DENIED: 'Location permission was denied. Allow location for this site in your browser or phone settings, then try again.',
  UNAVAILABLE: 'Unable to obtain your location. Check that location services (GPS) are on and that this browser may use your location.',
  TIMEOUT: 'Getting a location took too long. Check that location services are on, then try again.',
  UNSUPPORTED: 'This browser cannot share its location. Use a recent version of Chrome, Safari, Edge or Firefox.',
  INSECURE: 'Location only works over a secure (https) connection.',
};

export type AcquireOptions = {
  /** Readings at or below this uncertainty (m) are acceptable. */
  targetAccuracyM: number;
  /** Overall time limit (default 60 s). */
  timeoutMs?: number;
  /** Readings older than this are ignored as stale (default 30 s). */
  maxAgeMs?: number;
  /** Maximum readings to collect before settling for the best (default 5). */
  maxSamples?: number;
  /** Acceptable readings that must agree before stopping early (default 2). */
  stableCount?: number;
  onSample?: (state: AcquireProgress) => void;
  signal?: AbortSignal;
};
export type AcquireProgress = { samples: number; best: Reading | null; latest: Reading };
export type AcquireStatus = 'ACCEPTABLE' | 'INSUFFICIENT_ACCURACY';
export type AcquireResult = { status: AcquireStatus; best: Reading; samples: Reading[]; stable: boolean; spreadM: number | null };

/* ── Pure helpers (unit-tested) ────────────────────────────────────────────── */

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceM(a: Pick<Reading, 'latitude' | 'longitude'>, b: Pick<Reading, 'latitude' | 'longitude'>) {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isValidReading = (r: Reading) =>
  Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.accuracy) && r.accuracy >= 0 &&
  r.latitude >= -90 && r.latitude <= 90 && r.longitude >= -180 && r.longitude <= 180 &&
  // (0,0) is what some broken providers return when they have no fix.
  !(r.latitude === 0 && r.longitude === 0);

export const isFresh = (r: Reading, now: number, maxAgeMs: number) => now - r.timestamp <= maxAgeMs && r.timestamp - now <= 5_000;

/** The most precise fresh, valid reading (never an average). */
export function selectBest(samples: Reading[], now: number, maxAgeMs: number): Reading | null {
  let best: Reading | null = null;
  for (const r of samples) if (isValidReading(r) && isFresh(r, now, maxAgeMs) && (!best || r.accuracy < best.accuracy)) best = r;
  return best;
}

/**
 * Stability: the acceptable readings agree — every pair is closer than the larger of their
 * reported uncertainties. Widely scattered "precise" readings are a sign of a bad fix.
 */
export function evaluateSamples(samples: Reading[], opts: { targetAccuracyM: number; now: number; maxAgeMs: number; stableCount?: number }) {
  const best = selectBest(samples, opts.now, opts.maxAgeMs);
  const good = samples.filter((r) => isValidReading(r) && isFresh(r, opts.now, opts.maxAgeMs) && r.accuracy <= opts.targetAccuracyM);
  let spread: number | null = null;
  let consistent = good.length >= 2;
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      const d = distanceM(good[i], good[j]);
      spread = Math.max(spread ?? 0, d);
      if (d > Math.max(good[i].accuracy, good[j].accuracy)) consistent = false;
    }
  }
  const stable = good.length >= (opts.stableCount ?? 2) && consistent;
  const status: AcquireStatus | null = best ? (best.accuracy <= opts.targetAccuracyM ? 'ACCEPTABLE' : 'INSUFFICIENT_ACCURACY') : null;
  return { best, good: good.length, stable, spreadM: spread, status };
}

/* ── Permission ────────────────────────────────────────────────────────────── */

export async function locationPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return (p?.state as 'granted' | 'prompt' | 'denied') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/* ── Acquisition ───────────────────────────────────────────────────────────── */

export function acquireLocation(opts: AcquireOptions): Promise<AcquireResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxAgeMs = opts.maxAgeMs ?? 30_000;
  const maxSamples = opts.maxSamples ?? 5;
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return reject(new GeoError('UNSUPPORTED', GEO_MESSAGES.UNSUPPORTED));
    if (!window.isSecureContext) return reject(new GeoError('INSECURE', GEO_MESSAGES.INSECURE));
    const samples: Reading[] = [];
    let lastError: GeoErrorCode | null = null;
    let done = false;
    let watch = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (watch !== -1) navigator.geolocation.clearWatch(watch);
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const settle = () => {
      const ev = evaluateSamples(samples, { targetAccuracyM: opts.targetAccuracyM, now: Date.now(), maxAgeMs, stableCount: opts.stableCount });
      if (ev.best) return finish(() => resolve({ status: ev.status!, best: ev.best!, samples: [...samples], stable: ev.stable, spreadM: ev.spreadM }));
      const code = lastError ?? 'TIMEOUT';
      finish(() => reject(new GeoError(code, GEO_MESSAGES[code])));
    };
    const onAbort = () => finish(() => reject(new GeoError('TIMEOUT', 'Location request cancelled.')));
    opts.signal?.addEventListener('abort', onAbort);

    watch = navigator.geolocation.watchPosition(
      (p) => {
        const r: Reading = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp || Date.now() };
        if (!isValidReading(r) || !isFresh(r, Date.now(), maxAgeMs)) return; // ignore cached / broken readings
        samples.push(r);
        const ev = evaluateSamples(samples, { targetAccuracyM: opts.targetAccuracyM, now: Date.now(), maxAgeMs, stableCount: opts.stableCount });
        opts.onSample?.({ samples: samples.length, best: ev.best, latest: r });
        // Stop early: enough agreeing acceptable readings, or the sample budget is used up.
        if (ev.stable || samples.length >= maxSamples) settle();
      },
      (e) => {
        if (e.code === 1) return finish(() => reject(new GeoError('DENIED', GEO_MESSAGES.DENIED)));
        // POSITION_UNAVAILABLE / TIMEOUT for one attempt: keep watching until the overall limit.
        lastError = e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    timer = setTimeout(settle, timeoutMs);
  });
}

/** Payload sent to the server: raw coordinates, reported accuracy and freshness information. */
export const readingPayload = (r: Reading) => ({ latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy, timestamp: r.timestamp, clientTime: Date.now() });
