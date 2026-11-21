/**
 * Reads the device's current location with the browser's permission prompt.
 * High accuracy is tried first; devices without GPS (most computers) can time out on it, so a
 * normal reading is the fallback. The server compares the locations and makes the decision.
 */
export type Point = { latitude: number; longitude: number; accuracy: number };
export type GeoErrorCode = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'INSECURE';

export class GeoError extends Error {
  constructor(readonly code: GeoErrorCode, message: string) {
    super(message);
  }
}

export const GEO_MESSAGES: Record<GeoErrorCode, string> = {
  DENIED: 'Location permission was denied. Allow location for this site in your browser or device settings, then try again.',
  UNAVAILABLE: 'Unable to get your location. Check that location services are on, then try again.',
  TIMEOUT: 'Getting your location took too long. Check that location services are on, then try again.',
  UNSUPPORTED: 'This browser cannot share its location. Use a recent version of Chrome, Safari, Edge or Firefox.',
  INSECURE: 'Location only works over a secure (https) connection.',
};

const read = (enableHighAccuracy: boolean) =>
  new Promise<Point>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        const code: GeoErrorCode = e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE';
        reject(new GeoError(code, GEO_MESSAGES[code]));
      },
      { enableHighAccuracy, maximumAge: 0, timeout: 15_000 },
    );
  });

export async function getCurrentLocation(): Promise<Point> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) throw new GeoError('UNSUPPORTED', GEO_MESSAGES.UNSUPPORTED);
  if (!window.isSecureContext) throw new GeoError('INSECURE', GEO_MESSAGES.INSECURE);
  try {
    return await read(true);
  } catch (e) {
    if (e instanceof GeoError && e.code === 'DENIED') throw e;
    return read(false);
  }
}
