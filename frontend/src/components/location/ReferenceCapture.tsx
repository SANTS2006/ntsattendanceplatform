import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, MapPin, XCircle } from 'lucide-react';
import { get } from '@/api/client';
import { acquireLocation, GeoError, type Reading } from '@/lib/geo';
import type { OrgSettings } from '@/types';
import { VenueMap } from '@/components/venue/VenueMap';

/** Students must be within this distance of the lecturer's reference point (fixed by the server). */
export const MAXIMUM_DISTANCE_METERS = 20;

export type CapturePhase =
  | { kind: 'IDLE' }
  | { kind: 'ACQUIRING'; samples: number; best: number | null }
  | { kind: 'ACCEPTED'; reading: Reading }
  | { kind: 'POOR_ACCURACY'; reading: Reading }
  | { kind: 'ERROR'; message: string };

export function useLocationPolicy() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings'), staleTime: 60_000 });
  const s = q.data;
  return {
    lecturerMaxAccuracyM: s?.lecturerMaxAccuracyM ?? 20,
    studentMaxAccuracyM: s?.studentMaxAccuracyM ?? 20,
    maxAgeMs: (s?.maxLocationAgeSeconds ?? 30) * 1000,
    timeoutMs: (s?.locationTimeoutSeconds ?? 60) * 1000,
    sampleCount: s?.locationSampleCount ?? 5,
  };
}

/**
 * Captures the lecturer's current position as a session reference point. Collects fresh,
 * high-accuracy readings and keeps the most precise one. A reading that does not meet the
 * lecturer accuracy threshold is shown with an explanation and never returned (so never saved);
 * the server re-validates accuracy and freshness anyway.
 */
export function useReferenceCapture() {
  const policy = useLocationPolicy();
  const [phase, setPhase] = useState<CapturePhase>({ kind: 'IDLE' });

  const capture = useCallback(async (): Promise<Reading | null> => {
    setPhase({ kind: 'ACQUIRING', samples: 0, best: null });
    try {
      const r = await acquireLocation({
        targetAccuracyM: policy.lecturerMaxAccuracyM, timeoutMs: policy.timeoutMs, maxAgeMs: policy.maxAgeMs, maxSamples: policy.sampleCount,
        onSample: (s) => setPhase({ kind: 'ACQUIRING', samples: s.samples, best: s.best ? Math.round(s.best.accuracy) : null }),
      });
      if (r.status === 'ACCEPTABLE') {
        setPhase({ kind: 'ACCEPTED', reading: r.best });
        return r.best;
      }
      setPhase({ kind: 'POOR_ACCURACY', reading: r.best });
      return null;
    } catch (e) {
      setPhase({
        kind: 'ERROR',
        message: e instanceof GeoError && e.code !== 'UNAVAILABLE' && e.code !== 'TIMEOUT'
          ? e.message
          : 'Unable to obtain your location. Turn on location services (GPS) and allow this site to use your location, then try again.',
      });
      return null;
    }
  }, [policy.lecturerMaxAccuracyM, policy.timeoutMs, policy.maxAgeMs, policy.sampleCount]);

  /** Server refused the reading (e.g. stale by the time it arrived): show why, keep nothing. */
  const fail = useCallback((message: string) => setPhase({ kind: 'ERROR', message }), []);
  const reset = useCallback(() => setPhase({ kind: 'IDLE' }), []);
  return { phase, capture, fail, reset, policy };
}

const fmt = (n: number) => n.toFixed(6);
const metres = (n: number) => `${Math.round(n).toLocaleString('en')} m`;

/** Status of the reference capture: progress, the reading, its accuracy and the 20 m rule. */
export function ReferenceStatus({ phase, maxAccuracyM, savedLabel, showMap = true }: { phase: CapturePhase; maxAccuracyM: number; savedLabel?: string; showMap?: boolean }) {
  const reading = phase.kind === 'ACCEPTED' || phase.kind === 'POOR_ACCURACY' ? phase.reading : null;
  const view = (() => {
    switch (phase.kind) {
      case 'ACQUIRING':
        return {
          tone: 'info', icon: <MapPin className="h-5 w-5 animate-bounce" />, title: 'Getting your current GPS location…',
          body: phase.samples
            ? `${phase.samples} reading${phase.samples === 1 ? '' : 's'} so far · best accuracy ±${phase.best} m (needs ±${maxAccuracyM} m or better). Hold the phone still.`
            : 'Waiting for the first reading. Allow location access if your browser asks.',
        };
      case 'ACCEPTED':
        return { tone: 'ok', icon: <CheckCircle2 className="h-5 w-5" />, title: savedLabel ?? 'Location registered — accuracy is acceptable.', body: null };
      case 'POOR_ACCURACY':
        return {
          tone: 'bad', icon: <XCircle className="h-5 w-5" />,
          title: `Your device reported location uncertainty of approximately ${metres(phase.reading.accuracy)}. This reading was not saved.`,
          body: `The reference point must be accurate to ±${maxAccuracyM} m. Use a phone with GPS turned on, move near a window or outdoors, wait a few seconds and try again.`,
        };
      case 'ERROR':
        return { tone: 'bad', icon: <AlertTriangle className="h-5 w-5" />, title: phase.message, body: null };
      default:
        return {
          tone: 'idle', icon: <MapPin className="h-5 w-5" />, title: 'Your location is captured when you generate the QR code.',
          body: 'Generate it on a phone with GPS, standing where students will be. A laptop usually cannot provide a precise location.',
        };
    }
  })();

  const tones: Record<string, string> = {
    ok: 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
    bad: 'border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10',
    info: 'border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10',
    idle: 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5',
  };
  const iconTones: Record<string, string> = {
    ok: 'text-emerald-700 dark:text-emerald-300', bad: 'text-rose-600 dark:text-rose-300', info: 'text-brand-700 dark:text-brand-300', idle: 'text-slate-600',
  };

  return (
    <div className="space-y-3" data-testid="reference-status">
      <div className={clsx('rounded-2xl border p-4', tones[view.tone])} aria-live="polite">
        <div className="flex items-start gap-3">
          <span className={clsx('mt-0.5 shrink-0', iconTones[view.tone])}>{view.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-wider text-slate-600 uppercase dark:text-slate-300">Your location (reference point)</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{view.title}</p>
            {view.body && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{view.body}</p>}
            {reading && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-4 dark:text-slate-300">
                <div><dt className="font-semibold">Latitude</dt><dd className="font-mono">{fmt(reading.latitude)}</dd></div>
                <div><dt className="font-semibold">Longitude</dt><dd className="font-mono">{fmt(reading.longitude)}</dd></div>
                <div><dt className="font-semibold">GPS accuracy</dt><dd>±{metres(reading.accuracy)}</dd></div>
                <div><dt className="font-semibold">Captured</dt><dd>{new Date(reading.timestamp).toLocaleTimeString()}</dd></div>
              </dl>
            )}
          </div>
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          <strong>The {MAXIMUM_DISTANCE_METERS}-metre rule:</strong> students can only check in when their phone shows they are within {MAXIMUM_DISTANCE_METERS} m of where
          you generate the QR code. The point stays fixed for the whole session.
        </span>
      </p>
      {showMap && phase.kind === 'ACCEPTED' && (
        <VenueMap point={phase.reading} radiusM={MAXIMUM_DISTANCE_METERS} accuracyM={phase.reading.accuracy} height={220} />
      )}
    </div>
  );
}
