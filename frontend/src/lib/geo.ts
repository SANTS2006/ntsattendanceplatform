/**
 * Precise location capture. A single getCurrentPosition() often returns the first, coarse fix
 * (Wi-Fi / cell tower, hundreds of metres). Watching for a few seconds lets GPS settle; we keep the
 * most accurate reading and stop early once it is good enough.
 */
export type Fix = { latitude: number; longitude: number; accuracy: number };
export type GeoErrorCode = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'INSECURE';

export class GeoError extends Error {
  constructor(readonly code: GeoErrorCode, message: string) {
    super(message);
  }
}

export const GEO_MESSAGES: Record<GeoErrorCode, string> = {
  DENIED: 'Location permission was denied. Allow location for this site in your browser or phone settings, then try again.',
  UNAVAILABLE: 'Your location is unavailable. Turn on location services (GPS) and try again.',
  TIMEOUT: 'Getting your location took too long. Move near a window or outdoors and try again.',
  UNSUPPORTED: 'This browser cannot share its location.',
  INSECURE: 'Location only works over a secure (https) connection.',
};

/** "granted" | "prompt" | "denied" | "unknown" — lets the UI explain before asking. */
export async function locationPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return (p?.state as 'granted' | 'prompt' | 'denied') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function bestPosition(opts: { targetAccuracy?: number; maxWaitMs?: number; onProgress?: (fix: Fix) => void } = {}): Promise<Fix> {
  const target = opts.targetAccuracy ?? 15;
  const maxWait = opts.maxWaitMs ?? 20_000;
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new GeoError('UNSUPPORTED', GEO_MESSAGES.UNSUPPORTED));
    if (!window.isSecureContext) return reject(new GeoError('INSECURE', GEO_MESSAGES.INSECURE));
    let best: Fix | null = null;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      fn();
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const fix = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
          opts.onProgress?.(fix);
        }
        if (fix.accuracy <= target) finish(() => resolve(fix));
      },
      (e) => {
        if (best) return finish(() => resolve(best!)); // keep what we have
        const code: GeoErrorCode = e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
        finish(() => reject(new GeoError(code, GEO_MESSAGES[code])));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWait },
    );
    const timer = setTimeout(() => finish(() => (best ? resolve(best) : reject(new GeoError('TIMEOUT', GEO_MESSAGES.TIMEOUT)))), maxWait);
  });
}
