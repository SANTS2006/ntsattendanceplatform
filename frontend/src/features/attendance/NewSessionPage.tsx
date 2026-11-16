import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { QrCode } from 'lucide-react';
import { errorMessage, get, post } from '@/api/client';
import { Button, Card, Input, PageHeader, Select, Tabs, Toggle, BackButton } from '@/components/ui';
import { useOptions } from '@/hooks/useOptions';
import { VenuePicker, type VenueValue } from '@/components/venue/VenuePicker';
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

  /** Geofence anchor: a GPS reading that met the capture policy, a map placement, or the saved venue. */
  const [venue, setVenue] = useState<VenueValue | null>(null);
  const [venueTouched, setVenueTouched] = useState(false);

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

  // Start from the venue saved on the selected class/event (with its provenance).
  useEffect(() => {
    if (venueTouched) return;
    const row = target === 'class' ? classes.rows.find((c) => c.id === classId) : events.rows.find((e) => e.id === eventId);
    setVenue(
      row?.defaultLatitude != null && row.defaultLongitude != null
        ? { latitude: Number(row.defaultLatitude), longitude: Number(row.defaultLongitude), source: row.venueLocationSource ?? null, accuracyM: row.venueAccuracyM ?? null, capturedAt: row.venueCapturedAt ?? null }
        : null,
    );
  }, [classId, eventId, target, classes.rows, events.rows, venueTouched]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (target === 'class' ? !classId : !eventId) e.target = `Select your ${target}`;
    if (title.length > 150) e.title = 'Title must be at most 150 characters';
    if (customDuration && !intIn(customDuration, 1, 1440)) e.duration = 'Enter a duration between 1 and 1440 minutes';
    if (lateAfter && !intIn(lateAfter, 1, 1440)) e.lateAfter = 'Enter a whole number of minutes between 1 and 1440';
    if (!intIn(radius, 14, 20)) e.radius = 'Enter a radius between 14 and 20 metres';
    if (!intIn(minAccuracy, 5, 1000)) e.minAccuracy = 'Enter an accuracy between 5 and 1,000 metres';
    if (locationRequired && !venue) e.location = 'Capture the venue location by GPS or select it on the map before generating the QR code.';
    else if (locationRequired && venue && !venue.source) e.location = 'The saved venue location has not been verified. Capture it again by GPS or select it on the map.';
    return e;
  };
  useEffect(() => {
    if (submitted) setErrors(validate());
  }, [submitted, target, classId, eventId, title, customDuration, lateAfter, radius, minAccuracy, locationRequired, venue]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Raw coordinates (no rounding beyond ~1 cm) plus provenance; the server re-validates the accuracy.
        ...(locationRequired && venue?.source
          ? { latitude: Number(venue.latitude.toFixed(7)), longitude: Number(venue.longitude.toFixed(7)), locationSource: venue.source, locationAccuracyM: venue.accuracyM }
          : {}),
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

          {locationRequired && (
            <div className="mt-3">
              <VenuePicker
                value={venue}
                onChange={(v) => { setVenue(v); setVenueTouched(true); }}
                radiusM={Number(radius) || 20}
                onRadiusChange={(r) => setRadius(String(r))}
                label={`${target === 'class' ? 'Classroom' : 'Event venue'} location`}
              />
              {errors.location && <p className="mt-2 text-sm font-medium text-rose-600">{errors.location}</p>}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input label="Allowed radius (metres)" type="number" min={14} max={20} value={radius} error={errors.radius} hint="Students must be within 14–20 m of this location." onChange={(e) => setRadius(e.target.value)} />
            <Input label="Maximum student GPS uncertainty (metres)" type="number" min={5} max={1000} value={minAccuracy} error={errors.minAccuracy} onChange={(e) => setMinAccuracy(e.target.value)} hint="Student readings less precise than this are rejected (they can retry)." />
          </div>
          {Number(minAccuracy) > Number(radius) && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              The allowed student uncertainty (±{minAccuracy} m) is larger than the {radius} m radius. Readings that imprecise can place a student who is in the room outside the boundary (or the reverse). A lower value (for example 25–30 m) gives fairer results but more students may need to retry.
            </p>
          )}
        </Card>

        <Card title="Verification rules">
          <Toggle label="Require a selfie" description="Students take a photo with their front camera. Photos are private and deleted after the retention period." checked={selfieRequired} onChange={setSelfieRequired} />
          <Toggle label="Only enrolled students" description="Reject students who are not enrolled in the class / registered for the event." checked={requireEnrollment} onChange={setRequireEnrollment} />
        </Card>

        </div>
        <div className="flex justify-end xl:col-span-2">
          <Button size="lg" className="w-full sm:w-auto" loading={busy} onClick={submit} icon={<QrCode className="h-5 w-5" />}>
            Generate QR code
          </Button>
        </div>
      </div>
    </div>
  );
}
