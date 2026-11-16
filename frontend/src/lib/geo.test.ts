import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLocation, distanceM, evaluateSamples, GeoError, isFresh, isValidReading, selectBest, type Reading } from './geo';

const NOW = 1_800_000_000_000;
const at = (latitude: number, longitude: number, accuracy: number, ageMs = 1_000): Reading => ({ latitude, longitude, accuracy, timestamp: NOW - ageMs });
const VENUE = { latitude: 8.4844, longitude: -13.2344 };

describe('distance', () => {
  it('returns metres with latitude/longitude in the right order', () => {
    // 0.001° of latitude ≈ 111 m everywhere; 0.001° of longitude at 8.48° N ≈ 110 m.
    expect(distanceM(VENUE, { latitude: 8.4854, longitude: -13.2344 })).toBeCloseTo(111.2, 0);
    expect(distanceM(VENUE, { latitude: 8.4844, longitude: -13.2334 })).toBeCloseTo(110.0, 0);
    expect(distanceM(VENUE, VENUE)).toBe(0);
  });
});

describe('reading validity and freshness', () => {
  it('rejects invalid coordinates and the (0,0) "no fix" placeholder', () => {
    expect(isValidReading(at(8.4844, -13.2344, 10))).toBe(true);
    expect(isValidReading(at(91, 0, 10))).toBe(false);
    expect(isValidReading(at(0, 181, 10))).toBe(false);
    expect(isValidReading(at(0, 0, 10))).toBe(false);
    expect(isValidReading(at(8.48, -13.23, Number.NaN))).toBe(false);
  });
  it('treats readings older than the limit as stale', () => {
    expect(isFresh(at(8.48, -13.23, 10, 5_000), NOW, 30_000)).toBe(true);
    expect(isFresh(at(8.48, -13.23, 10, 45_000), NOW, 30_000)).toBe(false);
    expect(isFresh(at(8.48, -13.23, 10, -60_000), NOW, 30_000)).toBe(false); // from the future
  });
});

describe('best reading selection (no averaging)', () => {
  it('picks the most precise fresh reading and ignores stale ones', () => {
    const samples = [at(8.49, -13.23, 1_000), at(8.4844, -13.2344, 20), at(8.4845, -13.2344, 5, 60_000), at(8.48441, -13.23441, 12)];
    const best = selectBest(samples, NOW, 30_000)!;
    expect(best.accuracy).toBe(12); // the 5 m reading is stale
  });
  it.each([
    [5, 'ACCEPTABLE'],
    [20, 'ACCEPTABLE'],
    [50, 'INSUFFICIENT_ACCURACY'],
    [100, 'INSUFFICIENT_ACCURACY'],
    [1_000, 'INSUFFICIENT_ACCURACY'],
    [20_000, 'INSUFFICIENT_ACCURACY'],
  ])('a single %i m reading against a 30 m policy is %s', (acc, expected) => {
    const ev = evaluateSamples([at(8.4844, -13.2344, acc)], { targetAccuracyM: 30, now: NOW, maxAgeMs: 30_000 });
    expect(ev.status).toBe(expected);
  });
  it('requires agreeing readings for stability; scattered "precise" readings are not stable', () => {
    const agree = [at(8.4844, -13.2344, 10), at(8.48441, -13.23441, 12)];
    expect(evaluateSamples(agree, { targetAccuracyM: 30, now: NOW, maxAgeMs: 30_000 }).stable).toBe(true);
    const scattered = [at(8.4844, -13.2344, 10), at(8.4864, -13.2344, 10)]; // ~220 m apart
    const ev = evaluateSamples(scattered, { targetAccuracyM: 30, now: NOW, maxAgeMs: 30_000 });
    expect(ev.stable).toBe(false);
    expect(ev.spreadM).toBeGreaterThan(200);
  });
  it('poor indoor readings never become acceptable', () => {
    const indoor = [at(8.4844, -13.2344, 65), at(8.4846, -13.2341, 48), at(8.4843, -13.2347, 80)];
    const ev = evaluateSamples(indoor, { targetAccuracyM: 30, now: NOW, maxAgeMs: 30_000 });
    expect(ev.status).toBe('INSUFFICIENT_ACCURACY');
    expect(ev.best!.accuracy).toBe(48);
  });
});

/* ── acquireLocation with a fake navigator.geolocation ── */

type Cb = (p: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }) => void;
type ErrCb = (e: { code: number; message: string }) => void;
function fakeGeolocation() {
  let success: Cb = () => undefined;
  let failure: ErrCb = () => undefined;
  const clearWatch = vi.fn();
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: (s: Cb, f: ErrCb) => { success = s; failure = f; return 7; }, clearWatch },
  });
  return {
    clearWatch,
    emit: (latitude: number, longitude: number, accuracy: number, ageMs = 0) => success({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() - ageMs }),
    fail: (code: number) => failure({ code, message: 'x' }),
  };
}

afterEach(() => vi.useRealTimers());

describe('acquireLocation', () => {
  it('stops early once two acceptable readings agree, and clears the watch', async () => {
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 30, timeoutMs: 60_000 });
    g.emit(8.49, -13.2, 18_000); // coarse Wi-Fi/IP fix first
    g.emit(8.4844, -13.2344, 14);
    g.emit(8.48441, -13.23441, 9);
    const r = await p;
    expect(r.status).toBe('ACCEPTABLE');
    expect(r.best.accuracy).toBe(9);
    expect(r.stable).toBe(true);
    expect(g.clearWatch).toHaveBeenCalledWith(7);
  });

  it('reports INSUFFICIENT_ACCURACY (never success) when only a ±20,000 m reading arrives', async () => {
    vi.useFakeTimers();
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 30, timeoutMs: 10_000 });
    g.emit(8.4, -13.1, 20_000);
    vi.advanceTimersByTime(10_000);
    const r = await p;
    expect(r.status).toBe('INSUFFICIENT_ACCURACY');
    expect(r.best.accuracy).toBe(20_000);
  });

  it('ignores stale cached readings', async () => {
    vi.useFakeTimers();
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 30, timeoutMs: 5_000, maxAgeMs: 30_000 });
    g.emit(8.4844, -13.2344, 5, 120_000); // cached two minutes ago
    vi.advanceTimersByTime(5_000);
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails immediately when permission is denied', async () => {
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 30 });
    g.fail(1);
    await expect(p).rejects.toBeInstanceOf(GeoError);
    await expect(p).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('keeps waiting after a transient "position unavailable" and reports it if nothing arrives', async () => {
    vi.useFakeTimers();
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 30, timeoutMs: 8_000 });
    g.fail(2);
    vi.advanceTimersByTime(8_000);
    await expect(p).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('settles for the best reading when the sample budget is used up', async () => {
    const g = fakeGeolocation();
    const p = acquireLocation({ targetAccuracyM: 10, maxSamples: 3 });
    g.emit(8.4844, -13.2344, 40);
    g.emit(8.4844, -13.2344, 25);
    g.emit(8.4844, -13.2344, 32);
    const r = await p;
    expect(r.status).toBe('INSUFFICIENT_ACCURACY');
    expect(r.best.accuracy).toBe(25);
  });
});
