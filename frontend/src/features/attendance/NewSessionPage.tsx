import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Crosshair, LocateFixed, MapPin, QrCode } from 'lucide-react';
import { errorMessage, get, post } from '@/api/client';
import { Button, Card, Input, PageHeader, Select, Tabs, Toggle, BackButton } from '@/components/ui';
import { useOptions } from '@/hooks/useOptions';
import { useCurrentLocation } from '@/hooks/useCurrentLocation';
import type { ClassItem, EventItem, OrgSettings } from '@/types';

const DURATIONS = [5, 10, 15, 30, 60];

type Errors = Partial<Record<'target' | 'title' | 'duration' | 'lateAfter' | 'radius' | 'minAccuracy' | 'location', string>>;

const intIn = (v: string | number, min: number, max: number) => {
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n >= min && n <= max;
};

export function NewSessionPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings') });
  const classes = useOptions<ClassItem>('/classes', (c) => `${c.course?.code ?? c.code} · ${c.name}`, { status: 'ACTIVE' });
  const events = useOptions<EventItem>('/events', (e) => e.name, { status: 'ACTIVE' });
  const [target, setTarget] = useState<'class' | 'event'>(sp.get('eventId') ? 'event' : 'class');
  const [classId, setClassId] = useState(sp.get('classId') ?? '');
  const [eventId, setEventId] = useState(sp.get('eventId') ?? '');
  const [duration, setDuration] = useState(15);
  const [customDuration, setCustomDuration] = useState('');
  const [title, setTitle] = useState('');
  const [radius, setRadius] = useState('20');
  const [minAccuracy, setMinAccuracy] = useState('100');
  const [locationRequired, setLocationRequired] = useState(true);
  const [selfieRequired, setSelfieRequired] = useState(true);
  const [requireEnrollment, setRequireEnrollment] = useState(true);
  const [lateAfter, setLateAfter] = useState('');
  const [rotation, setRotation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  /** Location used for the geofence: the device fix (preferred) or the venue saved on the class/event. */
  const geo = useCurrentLocation();
  const [venue, setVenue] = useState<{ latitude: number; longitude: number } | null>(null);
  const [source, setSource] = useState<'device' | 'venue' | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setDuration(DURATIONS.includes(s.defaultQrExpiryMin) ? s.defaultQrExpiryMin : 15);
    if (!DURATIONS.includes(s.defaultQrExpiryMin)) setCustomDuration(String(s.defaultQrExpiryMin));
    setRadius(String(Math.min(20, Math.max(14, s.defaultGeofenceRadiusM))));
    setMinAccuracy(String(s.minGpsAccuracyM));
    setLocationRequired(s.locationRequired);
    setSelfieRequired(s.selfieRequired);
    setRequireEnrollment(s.requireEnrollment);
    setLateAfter(s.lateAfterMin ? String(s.lateAfterMin) : '');
  }, [settings.data]);

  // Venue location saved on the selected class/event.
  useEffect(() => {
    const row = target === 'class' ? classes.rows.find((c) => c.id === classId) : events.rows.find((e) => e.id === eventId);
    const v = row?.defaultLatitude != null && row.defaultLongitude != null ? { latitude: Number(row.defaultLatitude), longitude: Number(row.defaultLongitude) } : null;
    setVenue(v);
    if (v && source !== 'device') setSource('venue');
    if (!v && source === 'venue') setSource(null);
  }, [classId, eventId, target, classes.rows, events.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const capture = async () => {
    const fix = await geo.locate();
    if (fix) {
      setSource('device');
      setErrors((e) => ({ ...e, location: undefined }));
    }
  };

  // Capture automatically once, as soon as we know location checks are on.
  useEffect(() => {
    if (!settings.data || autoTried.current || !locationRequired) return;
    autoTried.current = true;
    void capture();
  }, [settings.data, locationRequired]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = source === 'device' && geo.fix ? { latitude: geo.fix.latitude, longitude: geo.fix.longitude } : source === 'venue' ? venue : null;

  const validate = (): Errors => {
    const e: Errors = {};
    if (target === 'class' ? !classId : !eventId) e.target = `Select your ${target}`;
    if (title.length > 150) e.title = 'Title must be at most 150 characters';
    if (customDuration && !intIn(customDuration, 1, 1440)) e.duration = 'Enter a duration between 1 and 1440 minutes';
    if (lateAfter && !intIn(lateAfter, 1, 1440)) e.lateAfter = 'Enter a whole number of minutes between 1 and 1440';
    if (!intIn(radius, 14, 20)) e.radius = 'Enter a radius between 14 and 20 metres';
    if (!intIn(minAccuracy, 1, 10000)) e.minAccuracy = 'Enter an accuracy between 1 and 10,000 metres';
    if (locationRequired && !point) e.location = 'Capture your current location (or save a venue location on the class/event) before generating the QR code.';
    return e;
  };
  useEffect(() => {
    if (submitted) setErrors(validate());
  }, [submitted, target, classId, eventId, title, customDuration, lateAfter, radius, minAccuracy, locationRequired, source, geo.fix]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setSubmitted(true);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return toast.error(Object.values(e)[0]!);
    const minutes = customDuration ? Number(customDuration) : duration;
    setBusy(true);
    try {
      const r = await post<{ session: { id: string }; qr: unknown }>('/attendance/sessions', {
        classId: target === 'class' ? classId : null,
        eventId: target === 'event' ? eventId : null,
        title: title.trim() || undefined,
        durationMinutes: minutes,
        latitude: point ? Number(point.latitude.toFixed(6)) : null,
        longitude: point ? Number(point.longitude.toFixed(6)) : null,
        radiusM: Number(radius),
        minAccuracyM: Number(minAccuracy),
        locationRequired,
        selfieRequired,
        requireEnrollment,
        lateAfterMinutes: lateAfter ? Number(lateAfter) : null,
        qrRotationSeconds: rotation ? 30 : null,
      });
      sessionStorage.setItem(`nts-qr-${r.session.id}`, JSON.stringify(r.qr));
      toast.success('Session started');
      nav(`/app/attendance/${r.session.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tone = point ? 'ok' : geo.status === 'locating' ? 'busy' : geo.error || errors.location ? 'error' : 'idle';

  return (
    <div className="w-full">
      <PageHeader
        title="New attendance session"
        description="Configure the session, then display the QR code to your students."
        back={<BackButton to="/app/attendance" label="Back to sessions" />}
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
        <Card title="What is this attendance for?">
          <Tabs tabs={[{ key: 'class', label: 'Class' }, { key: 'event', label: 'Event' }]} active={target} onChange={(k) => setTarget(k as 'class' | 'event')} />
          {target === 'class' ? (
            <Select label="Class *" options={classes.options} placeholder={classes.loading ? 'Loading…' : 'Select your class'} value={classId} error={errors.target} onChange={(e) => setClassId(e.target.value)} hint="Only classes you are assigned to (or manage) are listed." />
          ) : (
            <Select label="Event *" options={events.options} placeholder={events.loading ? 'Loading…' : 'Select your event'} value={eventId} error={errors.target} onChange={(e) => setEventId(e.target.value)} />
          )}
          <div className="mt-4">
            <Input label="Session title (optional)" value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
          </div>
        </Card>

        <Card title="QR code expiry">
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { setDuration(d); setCustomDuration(''); }}
                className={clsx('rounded-xl border px-4 py-2 text-sm font-semibold transition', !customDuration && duration === d ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}
                aria-pressed={!customDuration && duration === d}
              >
                {d} min
              </button>
            ))}
            <div className="w-full sm:w-44">
              <Input aria-label="Custom duration in minutes" placeholder="Enter custom minutes" type="number" min={1} max={1440} value={customDuration} error={errors.duration} onChange={(e) => setCustomDuration(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Mark as late after (minutes)" type="number" min={1} max={1440} value={lateAfter} error={errors.lateAfter} onChange={(e) => setLateAfter(e.target.value)} hint="Leave empty to never mark as late." />
            <div className="sm:pt-6">
              <Toggle label="Rotating QR code" description="A new code every 30 seconds — stops students sharing photos of the QR." checked={rotation} onChange={setRotation} />
            </div>
          </div>
        </Card>

        </div>
        <div className="min-w-0 space-y-6">
        <Card title="Location verification">
          <Toggle label="Require students to be at the venue" description="Students’ phones must report a location within the radius below." checked={locationRequired} onChange={setLocationRequired} />

          <div
            className={clsx(
              'mt-3 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
              tone === 'ok' && 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
              tone === 'error' && 'border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10',
              (tone === 'idle' || tone === 'busy') && 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5',
            )}
            aria-live="polite"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone === 'ok' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : tone === 'error' ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300' : 'bg-brand-50 text-brand-600')}>
                {tone === 'ok' ? <CheckCircle2 className="h-5 w-5" /> : tone === 'error' ? <AlertTriangle className="h-5 w-5" /> : <MapPin className={clsx('h-5 w-5', tone === 'busy' && 'animate-bounce')} />}
              </span>
              <div className="min-w-0 text-sm">
                {tone === 'busy' ? (
                  <>
                    <p className="font-semibold text-slate-900 dark:text-white">Getting a precise location…</p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{geo.progress == null ? 'Waiting for GPS…' : `Improving accuracy… ±${geo.progress} m`} Stand still at the venue.</p>
                  </>
                ) : point ? (
                  <>
                    <p className="font-semibold text-slate-900 dark:text-white">{source === 'device' ? 'Your current location will be the venue' : 'Using the venue location saved on this ' + target}</p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      {source === 'device' && geo.fix ? `Accuracy ±${geo.fix.accuracy} m · ` : ''}
                      <a className="font-medium text-brand-700" href={`https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=18/${point.latitude}/${point.longitude}`} target="_blank" rel="noreferrer">
                        View on map
                      </a>
                    </p>
                    {source === 'device' && geo.fix && geo.fix.accuracy > Number(minAccuracy) && (
                      <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">This reading (±{geo.fix.accuracy} m) is less precise than the minimum below. Recapture from a phone at the venue, outdoors or near a window — laptops usually can’t get a precise fix.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-800">{locationRequired ? 'Location not captured yet' : 'No location (students’ positions won’t be checked)'}</p>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{geo.error ?? errors.location ?? 'Stand at the venue and use your current location.'}</p>
                  </>
                )}
              </div>
            </div>
            <Button variant="secondary" className="shrink-0" loading={geo.status === 'locating'} onClick={capture} icon={point && source === 'device' ? <Crosshair className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />}>
              {point && source === 'device' ? 'Recapture' : 'Use my current location'}
            </Button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Allowed radius (metres)" type="number" min={14} max={20} value={radius} error={errors.radius} hint="Students must be within 14–20 m of this location." onChange={(e) => setRadius(e.target.value)} />
            <Input label="Minimum GPS accuracy (metres)" type="number" min={1} max={10000} value={minAccuracy} error={errors.minAccuracy} onChange={(e) => setMinAccuracy(e.target.value)} hint="Readings less accurate than this are rejected." />
          </div>
        </Card>

        <Card title="Verification rules">
          <Toggle label="Require a selfie" description="Students take a photo with their front camera. Photos are private and deleted after the retention period." checked={selfieRequired} onChange={setSelfieRequired} />
          <Toggle label="Only enrolled students" description="Reject students who are not enrolled in the class / registered for the event." checked={requireEnrollment} onChange={setRequireEnrollment} />
        </Card>

        </div>
        <div className="flex justify-end xl:col-span-2">
          <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={geo.status === 'locating'} onClick={submit} icon={<QrCode className="h-5 w-5" />}>
            Generate QR code
          </Button>
        </div>
      </div>
    </div>
  );
}
