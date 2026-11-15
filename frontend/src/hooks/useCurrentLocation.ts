import { useCallback, useState } from 'react';

export type GeoFix = { latitude: number; longitude: number; accuracy: number; at: number };
export type GeoState = { status: 'idle' | 'locating' | 'ok' | 'error'; fix: GeoFix | null; error: string | null };

const MESSAGES: Record<number, string> = {
  1: 'Location permission was denied. Allow location access for this site in your browser settings, then try again.',
  2: 'Your location is unavailable. Turn on location services (GPS / Wi-Fi) and try again.',
  3: 'Getting your location took too long. Move closer to a window or turn on Wi-Fi, then try again.',
};

/** Browser geolocation with friendly errors. Requires HTTPS (or localhost). */
export function useCurrentLocation(initial?: { latitude: number; longitude: number } | null) {
  const [state, setState] = useState<GeoState>(
    initial ? { status: 'ok', fix: { ...initial, accuracy: 0, at: 0 }, error: null } : { status: 'idle', fix: null, error: null },
  );

  const locate = useCallback(
    () =>
      new Promise<GeoFix | null>((resolve) => {
        if (!('geolocation' in navigator)) {
          setState({ status: 'error', fix: null, error: 'This browser cannot share its location.' });
          return resolve(null);
        }
        if (!window.isSecureContext) {
          setState({ status: 'error', fix: null, error: 'Location only works over a secure (https) connection.' });
          return resolve(null);
        }
        setState((s) => ({ ...s, status: 'locating', error: null }));
        navigator.geolocation.getCurrentPosition(
          (p) => {
            const fix = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: Date.now() };
            setState({ status: 'ok', fix, error: null });
            resolve(fix);
          },
          (e) => {
            setState((s) => ({ status: 'error', fix: s.fix, error: MESSAGES[e.code] ?? 'Could not get your location.' }));
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
        );
      }),
    [],
  );

  const clear = useCallback(() => setState({ status: 'idle', fix: null, error: null }), []);
  return { ...state, locate, clear };
}
