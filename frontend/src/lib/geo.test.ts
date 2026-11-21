import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeoError, getCurrentLocation } from './geo';

const position = { coords: { latitude: 8.48, longitude: -13.23, accuracy: 12 } };
type Options = { enableHighAccuracy: boolean };

function fakeGeolocation(impl: (ok: (p: unknown) => void, fail: (e: { code: number }) => void, o: Options) => void) {
  const getCurrentPosition = vi.fn(impl);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  return getCurrentPosition;
}

afterEach(() => vi.unstubAllGlobals());

describe('getCurrentLocation', () => {
  it('returns the device location', async () => {
    fakeGeolocation((ok) => ok(position));
    await expect(getCurrentLocation()).resolves.toEqual({ latitude: 8.48, longitude: -13.23, accuracy: 12 });
  });

  it('falls back to a normal reading when high accuracy times out (computers without GPS)', async () => {
    const get = fakeGeolocation((ok, fail, o) => (o.enableHighAccuracy ? fail({ code: 3 }) : ok(position)));
    await expect(getCurrentLocation()).resolves.toMatchObject({ latitude: 8.48 });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when permission is denied', async () => {
    const get = fakeGeolocation((_ok, fail) => fail({ code: 1 }));
    await expect(getCurrentLocation()).rejects.toMatchObject({ code: 'DENIED' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reports a browser without location support', async () => {
    vi.stubGlobal('navigator', {});
    await expect(getCurrentLocation()).rejects.toBeInstanceOf(GeoError);
  });
});
