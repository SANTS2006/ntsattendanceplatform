import { useCallback, useState } from 'react';
import { bestPosition, GeoError } from '@/lib/geo';

export type GeoFix = { latitude: number; longitude: number; accuracy: number; at: number };
export type GeoState = { status: 'idle' | 'locating' | 'ok' | 'error'; fix: GeoFix | null; error: string | null; progress: number | null };

/** Browser geolocation that waits for a precise fix (keeps the best reading for up to 20 s). */
export function useCurrentLocation(initial?: { latitude: number; longitude: number } | null) {
  const [state, setState] = useState<GeoState>(
    initial ? { status: 'ok', fix: { ...initial, accuracy: 0, at: 0 }, error: null, progress: null } : { status: 'idle', fix: null, error: null, progress: null },
  );

  const locate = useCallback(async (): Promise<GeoFix | null> => {
    setState((s) => ({ ...s, status: 'locating', error: null, progress: null }));
    try {
      const f = await bestPosition({ targetAccuracy: 15, maxWaitMs: 20_000, onProgress: (p) => setState((s) => ({ ...s, progress: p.accuracy })) });
      const fix = { ...f, at: Date.now() };
      setState({ status: 'ok', fix, error: null, progress: null });
      return fix;
    } catch (e) {
      setState((s) => ({ status: 'error', fix: s.fix, error: e instanceof GeoError ? e.message : 'Could not get your location.', progress: null }));
      return null;
    }
  }, []);

  const clear = useCallback(() => setState({ status: 'idle', fix: null, error: null, progress: null }), []);
  return { ...state, locate, clear };
}
