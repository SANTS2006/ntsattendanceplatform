import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Crosshair, Info, LocateFixed, Map as MapIcon, MapPin, RotateCw, XCircle } from 'lucide-react';
import { get } from '@/api/client';
import { Button, Modal } from '@/components/ui';
import { acquireLocation, GeoError, type Reading } from '@/lib/geo';
import type { OrgSettings } from '@/types';
import { VenueMap, type LatLng } from './VenueMap';

export type VenueValue = {
  latitude: number;
  longitude: number;
  /** GPS = captured within the capture policy; MAP = manually placed; null = saved before verification existed. */
  source: 'GPS' | 'MAP' | null;
  accuracyM: number | null;
  capturedAt: string | null;
};

type Phase =
  | { kind: 'IDLE' }
  | { kind: 'ACQUIRING'; samples: number; best: number | null }
  | { kind: 'SUCCESS'; reading: Reading }
  | { kind: 'INSUFFICIENT_ACCURACY'; reading: Reading }
  | { kind: 'ERROR'; message: string };

const fmt = (n: number) => n.toFixed(6);
const metres = (n: number) => `${Math.round(n).toLocaleString('en')} m`;

export function useLocationPolicy() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings'), staleTime: 60_000 });
  const s = q.data;
  return {
    captureMaxAccuracyM: s?.venueCaptureMaxAccuracyM ?? 30,
    studentMaxAccuracyM: s?.minGpsAccuracyM ?? 50,
    maxAgeMs: (s?.maxLocationAgeSeconds ?? 30) * 1000,
    timeoutMs: (s?.locationTimeoutSeconds ?? 60) * 1000,
    sampleCount: s?.locationSampleCount ?? 5,
    radiusM: Math.min(20, Math.max(14, s?.defaultGeofenceRadiusM ?? 20)),
  };
}

/**
 * Venue (geofence anchor) capture: GPS with an accuracy gate, or manual placement on a map.
 * A GPS reading is only handed to `onChange` when it meets the capture policy — an inaccurate
 * reading is shown with an explanation and never saved.
 */
export function VenuePicker({
  value, onChange, radiusM, onRadiusChange, label = 'Venue location', compact,
}: {
  value: VenueValue | null; onChange: (v: VenueValue | null) => void; radiusM: number; onRadiusChange?: (r: number) => void; label?: string; compact?: boolean;
}) {
  const policy = useLocationPolicy();
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [mapOpen, setMapOpen] = useState(false);
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [draftRadius, setDraftRadius] = useState(radiusM);
  const lastReading = phase.kind === 'SUCCESS' || phase.kind === 'INSUFFICIENT_ACCURACY' ? phase.reading : null;

  const capture = async () => {
    setPhase({ kind: 'ACQUIRING', samples: 0, best: null });
    try {
      const r = await acquireLocation({
        targetAccuracyM: policy.captureMaxAccuracyM, timeoutMs: policy.timeoutMs, maxAgeMs: policy.maxAgeMs, maxSamples: policy.sampleCount,
        onSample: (s) => setPhase({ kind: 'ACQUIRING', samples: s.samples, best: s.best ? Math.round(s.best.accuracy) : null }),
      });
      if (r.status === 'ACCEPTABLE') {
        setPhase({ kind: 'SUCCESS', reading: r.best });
        onChange({ latitude: r.best.latitude, longitude: r.best.longitude, source: 'GPS', accuracyM: Math.round(r.best.accuracy * 10) / 10, capturedAt: new Date(r.best.timestamp).toISOString() });
      } else {
        setPhase({ kind: 'INSUFFICIENT_ACCURACY', reading: r.best }); // shown, never saved
      }
    } catch (e) {
      setPhase({ kind: 'ERROR', message: e instanceof GeoError && e.code !== 'UNAVAILABLE' && e.code !== 'TIMEOUT' ? e.message : 'Unable to obtain your location. Check your device location settings and browser permissions.' });
    }
  };

  const openMap = () => {
    setDraft(value ? { latitude: value.latitude, longitude: value.longitude } : null);
    setDraftRadius(radiusM);
    setMapOpen(true);
  };
  const saveMap = () => {
    if (!draft) return;
    onChange({ latitude: draft.latitude, longitude: draft.longitude, source: 'MAP', accuracyM: null, capturedAt: new Date().toISOString() });
    if (onRadiusChange && draftRadius !== radiusM) onRadiusChange(draftRadius);
    setPhase({ kind: 'IDLE' });
    setMapOpen(false);
  };

  // What to show in the status panel.
  const status = (() => {
    switch (phase.kind) {
      case 'ACQUIRING':
        return { tone: 'info', icon: <MapPin className="h-5 w-5 animate-bounce" />, title: 'Obtaining your current location. Please wait.',
          body: phase.samples ? `${phase.samples} reading${phase.samples === 1 ? '' : 's'} so far · best accuracy ±${phase.best} m (needs ±${policy.captureMaxAccuracyM} m or better)` : 'Waiting for the first reading…' };
      case 'SUCCESS':
        return { tone: 'ok', icon: <CheckCircle2 className="h-5 w-5" />, title: 'Location accuracy is acceptable. You can save this classroom location.', body: null };
      case 'INSUFFICIENT_ACCURACY':
        return { tone: 'bad', icon: <XCircle className="h-5 w-5" />,
          title: `Your device reported location uncertainty of approximately ${Math.round(phase.reading.accuracy).toLocaleString('en')} metres. We cannot use this reading to register a classroom.`,
          body: `Please retry with a GPS-enabled device (a phone at the venue, outdoors or near a window) or select the location on the map. The limit is ±${policy.captureMaxAccuracyM} m.` };
      case 'ERROR':
        return { tone: 'bad', icon: <AlertTriangle className="h-5 w-5" />, title: phase.message, body: null };
      default:
        if (!value) return { tone: 'idle', icon: <MapPin className="h-5 w-5" />, title: 'No location set', body: 'Capture the location at the venue with a GPS-enabled device, or select it on the map.' };
        if (value.source === 'MAP') return { tone: 'warn', icon: <MapIcon className="h-5 w-5" />, title: 'Location selected on the map', body: 'Manually configured — not a GPS-verified reading. Check the marker is on the right building.' };
        if (value.source === 'GPS') return { tone: 'ok', icon: <CheckCircle2 className="h-5 w-5" />, title: 'GPS-captured location', body: `Captured with ±${value.accuracyM ?? '?'} m accuracy.` };
        return { tone: 'bad', icon: <AlertTriangle className="h-5 w-5" />, title: 'This saved location has not been verified', body: 'It was saved before accuracy checks existed and may be far from the venue. Capture it again by GPS or select it on the map.' };
    }
  })();

  const tones: Record<string, string> = {
    ok: 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
    bad: 'border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10',
    warn: 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
    info: 'border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10',
    idle: 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5',
  };
  const iconTones: Record<string, string> = {
    ok: 'text-emerald-700 dark:text-emerald-300', bad: 'text-rose-600 dark:text-rose-300', warn: 'text-amber-700 dark:text-amber-300', info: 'text-brand-700 dark:text-brand-300', idle: 'text-slate-600',
  };
  const shown = lastReading ?? (value ? { latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracyM ?? 0, timestamp: value.capturedAt ? Date.parse(value.capturedAt) : 0 } : null);
  const uncertaintyVsRadius = shown && shown.accuracy > radiusM;

  return (
    <div className="space-y-3">
      <div className={clsx('rounded-2xl border p-4', tones[status.tone])} aria-live="polite">
        <div className="flex items-start gap-3">
          <span className={clsx('mt-0.5 shrink-0', iconTones[status.tone])}>{status.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-wider text-slate-600 uppercase dark:text-slate-300">{label}</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{status.title}</p>
            {status.body && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{status.body}</p>}
            {shown && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-4 dark:text-slate-300">
                <div><dt className="font-semibold">Latitude</dt><dd className="font-mono">{fmt(shown.latitude)}</dd></div>
                <div><dt className="font-semibold">Longitude</dt><dd className="font-mono">{fmt(shown.longitude)}</dd></div>
                <div><dt className="font-semibold">Accuracy</dt><dd>{lastReading || value?.source === 'GPS' ? `±${metres(shown.accuracy)}` : value?.source === 'MAP' ? 'Manual (map)' : 'Unknown'}</dd></div>
                <div><dt className="font-semibold">Captured</dt><dd>{shown.timestamp ? new Date(shown.timestamp).toLocaleString() : '—'}</dd></div>
              </dl>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={phase.kind === 'ACQUIRING'} icon={phase.kind === 'INSUFFICIENT_ACCURACY' || phase.kind === 'ERROR' ? <RotateCw className="h-4 w-4" /> : value ? <Crosshair className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} onClick={capture}>
            {phase.kind === 'INSUFFICIENT_ACCURACY' || phase.kind === 'ERROR' ? 'Retry GPS capture' : value ? 'Capture again (GPS)' : 'Capture location (GPS)'}
          </Button>
          <Button size="sm" variant="secondary" icon={<MapIcon className="h-4 w-4" />} onClick={openMap}>Select on map</Button>
          {value && <Button size="sm" variant="ghost" onClick={() => { onChange(null); setPhase({ kind: 'IDLE' }); }}>Clear</Button>}
        </div>
      </div>

      {uncertaintyVsRadius && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> The reported uncertainty (±{metres(shown!.accuracy)}) is larger than the {radiusM} m attendance radius, so this reading cannot place the venue precisely.
        </p>
      )}

      {!compact && (value || lastReading) && (
        <VenueMap point={value ? { latitude: value.latitude, longitude: value.longitude } : lastReading} radiusM={radiusM} accuracyM={lastReading ? lastReading.accuracy : value?.source === 'GPS' ? value.accuracyM : null} />
      )}

      <Modal
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        title="Select the venue on the map"
        size="xl"
        footer={<><Button variant="secondary" onClick={() => setMapOpen(false)}>Cancel</Button><Button disabled={!draft} onClick={saveMap}>Use this location</Button></>}
      >
        <p className="mb-3 text-sm text-slate-700">Click the map to place the marker on the classroom, then drag it to adjust. The green circle shows the attendance boundary. This is recorded as a <strong>manually configured</strong> location, not a GPS-verified reading.</p>
        <VenueMap point={draft} radiusM={draftRadius} editable onPick={setDraft} height={420} fallbackCenter={lastReading ?? (value ? { latitude: value.latitude, longitude: value.longitude } : null)} />
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <p className="font-mono text-xs text-slate-700">{draft ? `${fmt(draft.latitude)}, ${fmt(draft.longitude)}` : 'No marker yet — click the map.'}</p>
          {onRadiusChange && (
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              Radius
              <input type="range" min={14} max={20} step={1} value={draftRadius} onChange={(e) => setDraftRadius(Number(e.target.value))} className="accent-brand-600" aria-label="Geofence radius in metres" />
              <span className="w-12 tabular-nums">{draftRadius} m</span>
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
