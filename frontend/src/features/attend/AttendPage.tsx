import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertCircle, CameraOff, CheckCircle2, Clock, Loader2, MapPin, MapPinOff, QrCode, RefreshCw, ShieldCheck, UserCheck, UserX, WifiOff, XCircle,
} from 'lucide-react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/theme/ThemeProvider';
import { SelfieCapture } from './SelfieCapture';
import { acquireLocation, GEO_MESSAGES, GeoError, locationPermission } from '@/lib/geo';
import { attendApi, formatSatisfied, type ProximityDetails, type SuccessResult, type ValidateResult, type VerifiedStudent } from './api';

type Fatal = { code: string; title: string; message: string; icon: ReactNode; retry?: boolean };

const FATAL: Record<string, Omit<Fatal, 'code' | 'message'> & { message?: string }> = {
  QR_INVALID: { title: 'Invalid QR code', icon: <QrCode className="h-8 w-8" /> },
  QR_EXPIRED: { title: 'QR code expired', icon: <Clock className="h-8 w-8" /> },
  ATTENDANCE_SESSION_EXPIRED: { title: 'Attendance session ended', icon: <Clock className="h-8 w-8" /> },
  LECTURER_REFERENCE_LOCATION_INVALID: { title: 'Session location not set', icon: <MapPinOff className="h-8 w-8" /> },
  SESSION_CLOSED: { title: 'Attendance closed', icon: <XCircle className="h-8 w-8" /> },
  SESSION_REVOKED: { title: 'QR code revoked', icon: <XCircle className="h-8 w-8" /> },
  ATTEMPT_INVALID: { title: 'Please scan again', icon: <RefreshCw className="h-8 w-8" />, retry: true },
  ATTEMPT_REQUIRED: { title: 'Please scan again', icon: <RefreshCw className="h-8 w-8" />, retry: true },
  ATTEMPT_MISMATCH: { title: 'Please scan again', icon: <RefreshCw className="h-8 w-8" />, retry: true },
  NETWORK_ERROR: { title: 'No connection', icon: <WifiOff className="h-8 w-8" />, retry: true },
  ALREADY_RECORDED: { title: 'Already recorded', icon: <CheckCircle2 className="h-8 w-8" /> },
  TOO_MANY_ATTEMPTS: { title: 'Too many attempts', icon: <AlertCircle className="h-8 w-8" /> },
  LOCATION_ATTEMPTS_EXCEEDED: { title: 'Too many location checks', icon: <MapPinOff className="h-8 w-8" /> },
  LATE_NOT_ALLOWED: { title: 'Attendance window passed', icon: <Clock className="h-8 w-8" /> },
};

function Shell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-slate-50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <Logo />
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Secure attendance
            <ThemeToggle className="ml-1 !p-2" />
          </span>
        </div>
        {header}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

function StepCard({ title, step, total, children, done }: { title: string; step: number; total: number; children: ReactNode; done?: boolean }) {
  return (
    <section className={clsx('card mb-4 p-5', done && 'border-emerald-200 bg-emerald-50/40')} aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="text-xs font-medium text-slate-400">
          Step {step} of {total}
        </span>
      </div>
      {children}
    </section>
  );
}

function FatalScreen({ f, onRetry }: { f: Fatal; onRetry?: () => void }) {
  const tone = f.code === 'ALREADY_RECORDED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600';
  return (
    <div className="card mt-6 flex flex-col items-center p-8 text-center" role="alert">
      <div className={clsx('mb-4 flex h-16 w-16 items-center justify-center rounded-full', tone)}>{f.icon}</div>
      <h1 className="text-xl font-semibold text-slate-900">{f.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{f.message}</p>
      {f.retry && onRetry && (
        <Button className="mt-6" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

function Countdown({ expiresAt, offsetMs }: { expiresAt: string; offsetMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Display only — expiry is enforced by the server clock.
  const left = Math.max(0, new Date(expiresAt).getTime() - (now + offsetMs));
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className={clsx('inline-flex items-center gap-1 tabular-nums', left < 60000 ? 'text-rose-600' : 'text-slate-500')}>
      <Clock className="h-3.5 w-3.5" /> {left === 0 ? 'Expired' : `${m}:${String(s).padStart(2, '0')} left`}
    </span>
  );
}

export function SuccessView({ r }: { r: SuccessResult }) {
  return (
    <div className="space-y-4">
      <div className="card flex flex-col items-center p-6 text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">Attendance recorded</h1>
        <p className="mt-1 text-sm text-slate-600">{r.message}</p>
        <p className="mt-4 rounded-lg bg-slate-100 px-4 py-2 font-mono text-sm font-semibold tracking-wider text-slate-800">{r.referenceNumber}</p>
        <p className="mt-1 text-xs text-slate-400">Attendance reference number</p>
      </div>
      <div className="card p-5">
        <div className="flex items-center gap-4">
          {r.selfieUrl ? (
            <img src={r.selfieUrl} alt="Your attendance selfie" className="h-20 w-20 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
              <UserCheck className="h-8 w-8" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{r.student.fullName}</p>
            <p className="text-sm text-slate-500">{r.student.studentId}</p>
            {r.student.email && <p className="text-xs break-all text-slate-400">{r.student.email}</p>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
          {[
            ['Organization', r.organization],
            ['Course / class / event', r.context],
            ['Program', r.student.program ?? '—'],
            ['Level', r.student.level ?? '—'],
            ['Date', r.attendanceDate],
            ['Time', `${r.attendanceTime} (${r.timezone})`],
            ['Status', r.status],
            ['Location', r.locationVerified == null ? 'Not required' : r.locationVerified ? 'Verified' : 'Not verified'],
          ].map(([k, v]) => (
            <div key={k} className={k === 'Course / class / event' || k === 'Organization' ? 'col-span-2' : ''}>
              <dt className="text-xs text-slate-400">{k}</dt>
              <dd className="font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-center text-xs text-slate-400">Keep your reference number. You can close this page.</p>
    </div>
  );
}

export function AttendPage() {
  const { token = '' } = useParams();
  const [fatal, setFatal] = useState<Fatal | null>(null);
  const [info, setInfo] = useState<ValidateResult | null>(null);
  const [attempt, setAttempt] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  // Location (first step when required): readings are judged by the server, never here.
  const [locState, setLocState] = useState<'idle' | 'locating' | 'checking' | 'ok' | 'error'>('idle');
  /** `tone`: 'retry' for poor/uncertain/stale readings (not a rejection), 'outside' when confidently too far. */
  const [locError, setLocError] = useState<{ code: string; message: string; tone: 'retry' | 'outside' } | null>(null);
  const [accepted, setAccepted] = useState<{ distanceM: number; accuracyM: number } | null>(null);

  // Student ID
  const [studentInput, setStudentInput] = useState('');
  const [student, setStudent] = useState<VerifiedStudent | null>(null);
  const [idState, setIdState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [idError, setIdError] = useState<string | null>(null);
  const lastChecked = useRef('');

  // Selfie
  const [selfie, setSelfie] = useState<{ blob: Blob; preview: string } | null>(null);
  const [selfieId, setSelfieId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selfieError, setSelfieError] = useState<string | null>(null);

  // Submit
  const idemKey = useMemo(() => crypto.randomUUID(), []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SuccessResult | null>(null);

  const toFatal = (e: unknown): boolean => {
    const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK_ERROR', 'Network error. Check your connection and try again.');
    const def = FATAL[err.code];
    if (!def) return false;
    setFatal({ code: err.code, title: def.title, icon: def.icon, retry: def.retry, message: err.message });
    return true;
  };

  const start = () => {
    setFatal(null);
    attendApi
      .validate(token)
      .then((r) => {
        setInfo(r);
        setAttempt(r.attemptToken);
        setOffset(new Date(r.session.serverTime).getTime() - Date.now());
      })
      .catch((e) => {
        if (!toFatal(e)) setFatal({ code: 'QR_INVALID', title: 'Invalid QR code', icon: <QrCode className="h-8 w-8" />, message: (e as Error).message });
      });
  };
  useEffect(start, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const needLocation = !!info?.session.locationVerificationEnabled;
  const needSelfie = !!info?.session.selfieRequired;
  const totalSteps = 1 + (needLocation ? 1 : 0) + (needSelfie ? 1 : 0) + 1;
  const locationDone = !needLocation || locState === 'ok';

  const [locAccuracy, setLocAccuracy] = useState<number | null>(null);
  const [permission, setPermission] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown');
  useEffect(() => {
    void locationPermission().then(setPermission);
  }, []);

  const [locSamples, setLocSamples] = useState(0);
  const [locFailures, setLocFailures] = useState(0);

  /**
   * Location step: collect fresh high-accuracy readings, keep the most precise one, and send it to
   * the server, which computes the distance to the lecturer's reference point and decides:
   * accepted, outside (confidently more than 20 m away) or uncertain (retry — never shown as a rejection).
   */
  async function locate() {
    if (!attempt || !info) return;
    const policy = info.session.locationPolicy;
    setLocError(null);
    setAccepted(null);
    setLocAccuracy(null);
    setLocSamples(0);
    setLocState('locating');
    try {
      const r = await acquireLocation({
        targetAccuracyM: Math.min(policy?.maxAccuracyM ?? 20, 10),
        timeoutMs: (policy?.timeoutSeconds ?? 60) * 1000,
        maxAgeMs: (policy?.maxLocationAgeSeconds ?? 30) * 1000,
        maxSamples: policy?.sampleCount ?? 5,
        onSample: (p) => { setLocSamples(p.samples); if (p.best) setLocAccuracy(Math.round(p.best.accuracy)); },
      });
      setLocState('checking');
      const check = await attendApi.verifyLocation(token, attempt, r.best);
      setAttempt(check.attemptToken); // carries the server-accepted location to the next steps
      setAccepted({ distanceM: check.distanceM, accuracyM: check.accuracyM });
      setLocState('ok');
    } catch (e) {
      setLocState('error');
      if (e instanceof ApiError) {
        if (toFatal(e)) return;
        setLocFailures((n) => n + 1);
        const d = e.errors as ProximityDetails;
        setLocError({ code: e.code, message: e.message, tone: e.code === 'LOCATION_OUTSIDE_RADIUS' && d.retryable === false ? 'outside' : 'retry' });
      } else if (e instanceof GeoError) {
        setLocError({ code: e.code, message: e.message, tone: 'retry' });
      } else {
        setLocError({ code: 'UNAVAILABLE', message: GEO_MESSAGES.UNAVAILABLE, tone: 'retry' });
      }
    }
  }

  // Automatic student ID verification once the configured format is satisfied (debounced).
  useEffect(() => {
    if (!info || !attempt || student || !locationDone) return;
    const value = studentInput;
    if (!formatSatisfied(value, info.studentIdFormat) || value === lastChecked.current) return;
    const delay = info.studentIdFormat.exactLength != null ? 250 : 900;
    const t = setTimeout(async () => {
      lastChecked.current = value;
      setIdState('checking');
      setIdError(null);
      try {
        const r = await attendApi.verifyStudent(token, attempt, value);
        setAttempt(r.attemptToken);
        setStudent(r.student);
        setIdState('idle');
      } catch (e) {
        if (e instanceof ApiError && ['ALREADY_RECORDED', 'TOO_MANY_ATTEMPTS', 'QR_EXPIRED', 'ATTENDANCE_SESSION_EXPIRED', 'SESSION_CLOSED', 'SESSION_REVOKED', 'ATTEMPT_INVALID'].includes(e.code) && toFatal(e)) return;
        if (e instanceof ApiError && e.code === 'LOCATION_NOT_VERIFIED') {
          setLocState('error');
          setLocError({ code: e.code, message: e.message, tone: 'retry' });
        }
        setIdState('error');
        setIdError(e instanceof ApiError ? e.message : 'Network error. Check your connection and try again.');
      }
    }, delay);
    return () => clearTimeout(t);
  }, [studentInput, info, attempt, student, locationDone, token]);

  async function uploadSelfie(blob: Blob, preview: string) {
    if (!attempt) return;
    setSelfie({ blob, preview });
    setSelfieId(null);
    setSelfieError(null);
    setUploading(true);
    try {
      const r = await attendApi.uploadSelfie(token, attempt, blob);
      setSelfieId(r.selfieId);
    } catch (e) {
      if (toFatal(e)) return;
      setSelfieError(e instanceof ApiError ? e.message : 'The photo could not be uploaded. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!attempt) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // The location verified by the server earlier is carried in the attempt token — no second
      // reading here, so a later (different) reading cannot contradict the verified one.
      const r = await attendApi.submit(token, attempt, idemKey, { selfieId });
      setResult(r);
      if (r.confirmationToken) {
        try {
          sessionStorage.setItem(`nts-confirm-${r.referenceNumber}`, r.confirmationToken);
        } catch {
          /* storage unavailable — confirmation still shown */
        }
      }
    } catch (e) {
      if (toFatal(e)) return;
      // The session's reference point may have been corrected since your location was accepted:
      // confirm your location again (your student ID stays verified).
      if (e instanceof ApiError && ['LOCATION_OUTSIDE_RADIUS', 'LOCATION_UNCERTAIN', 'LOCATION_NOT_VERIFIED'].includes(e.code)) {
        setLocState('error');
        setAccepted(null);
        setLocError({ code: e.code, message: e.message, tone: e.code === 'LOCATION_OUTSIDE_RADIUS' ? 'outside' : 'retry' });
      }
      setSubmitError(e instanceof ApiError ? e.message : 'Network error. Your attendance was not recorded yet — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) return <Shell><SuccessView r={result} /></Shell>;
  if (fatal) return <Shell><FatalScreen f={fatal} onRetry={start} /></Shell>;
  if (!info) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 text-slate-500" role="status">
          <Loader2 className="mb-3 h-8 w-8 animate-spin" /> Checking QR code…
        </div>
      </Shell>
    );
  }

  const f = info.studentIdFormat;
  const max = f.exactLength ?? f.maxLength;
  const normalizedLen = (f.allowSpaces ? studentInput.trim() : studentInput.replace(/\s+/g, '')).length;
  let step = 0;
  const canSubmit = locationDone && !!student && (!needSelfie || !!selfieId) && !uploading;

  return (
    <Shell
      header={
        <div className="card mb-4 flex items-center gap-3 p-4">
          {info.organization.logoUrl ? (
            <img src={info.organization.logoUrl} alt="" className="h-12 w-12 rounded-lg object-contain" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-100 font-semibold text-brand-700">{info.organization.name[0]}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-500">{info.organization.name}</p>
            <p className="truncate font-semibold text-slate-900">{info.session.context}</p>
            <div className="flex flex-wrap items-center gap-x-3 text-xs">
              {info.session.lecturer && <span className="text-slate-500">{info.session.lecturer}</span>}
              <Countdown expiresAt={info.session.expiresAt} offsetMs={offset} />
            </div>
          </div>
        </div>
      }
    >
      {needLocation && (
        <StepCard title="Confirm your location" step={++step} total={totalSteps} done={locState === 'ok'}>
          {locState === 'ok' ? (
            <p className="flex items-start gap-2 text-sm text-emerald-700" data-testid="location-accepted">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Location accepted.</strong> You are within {info.session.locationPolicy?.maximumDistanceMeters ?? 20} m of your lecturer
                {accepted && <> (about {accepted.distanceM} m away, reading ±{accepted.accuracyM} m)</>}.
              </span>
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                You must be within <strong>{info.session.locationPolicy?.maximumDistanceMeters ?? 20} m</strong> of where your lecturer generated this QR code.
                Your location is only used for this check.
              </p>
              {permission === 'prompt' && !locError && (
                <p className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">Your browser will ask to use your location — tap <strong>Allow</strong>.</p>
              )}
              {permission === 'denied' && !locError && (
                <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Location is blocked for this site. Allow it in your browser’s site settings (the icon next to the address), then tap the button below.</p>
              )}
              {(locState === 'locating' || locState === 'checking') && (
                <ol className="mb-3 space-y-1 text-sm" aria-live="polite" data-testid="location-progress">
                  <li className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Location permission</li>
                  <li className={clsx('flex items-center gap-2', locState === 'locating' ? 'text-slate-700' : 'text-emerald-700')}>
                    {locState === 'locating' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {locAccuracy == null ? 'Getting a fresh GPS reading…' : `GPS reading ${locSamples}: best accuracy ±${locAccuracy} m`}
                  </li>
                  <li className={clsx('flex items-center gap-2', locState === 'checking' ? 'text-slate-700' : 'text-slate-400')}>
                    {locState === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Checking your distance from your lecturer
                  </li>
                  {locState === 'locating' && <li className="text-xs text-slate-500">Stand still — this can take up to {info.session.locationPolicy?.timeoutSeconds ?? 60} seconds.</li>}
                </ol>
              )}
              {locError && (
                <div
                  className={clsx('mb-3 flex gap-2 rounded-lg p-3 text-sm', locError.tone === 'outside' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-900')}
                  role="alert"
                  data-testid="location-error"
                  data-code={locError.code}
                >
                  {locError.tone === 'outside' ? <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" /> : <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {locError.message}
                    {info.session.locationPolicy && locFailures > 0 && locError.code !== 'DENIED' && (
                      <span className="mt-1 block text-xs font-semibold">Checks used: {locFailures}. Your lecturer can record your attendance manually if your phone cannot get a precise location.</span>
                    )}
                  </span>
                </div>
              )}
              <Button size="lg" className="w-full" onClick={locate} loading={locState === 'locating' || locState === 'checking'} icon={<MapPin className="h-5 w-5" />}>
                {locState === 'locating' ? 'Getting a precise location…' : locState === 'checking' ? 'Checking…' : locError ? 'Try again' : 'Share my location'}
              </Button>
            </>
          )}
        </StepCard>
      )}

      <StepCard title="Enter your student ID" step={++step} total={totalSteps} done={!!student}>
        {student ? (
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <UserCheck className="h-6 w-6" />
            </div>
            <dl className="min-w-0 text-sm">
              <dt className="sr-only">Name</dt>
              <dd className="font-semibold text-slate-900">{student.fullName}</dd>
              <dd className="text-slate-600">{student.studentId}</dd>
              {student.email && <dd className="break-all text-slate-500">{student.email}</dd>}
              <dd className="text-slate-500">{[student.program, student.level].filter(Boolean).join(' · ')}</dd>
            </dl>
          </div>
        ) : (
          <fieldset disabled={!locationDone} className="disabled:opacity-50">
            <label htmlFor="student-id" className="label">
              Student ID
            </label>
            <div className="relative">
              <input
                id="student-id"
                className={clsx('input pr-16 font-mono text-lg tracking-wider', idState === 'error' && 'border-rose-400')}
                inputMode={f.charset === 'NUMERIC' && !f.prefix && !f.suffix ? 'numeric' : 'text'}
                autoComplete="off"
                autoCapitalize={f.caseSensitive ? 'off' : 'characters'}
                spellCheck={false}
                maxLength={max + (f.allowSpaces ? 8 : 0)}
                placeholder={f.example ? `Enter your student ID (e.g. ${f.example})` : "Enter your student ID"}
                value={studentInput}
                onChange={(e) => {
                  setStudentInput(e.target.value);
                  if (idState === 'error') setIdState('idle');
                }}
                aria-describedby="student-id-counter"
                aria-invalid={idState === 'error'}
              />
              <span id="student-id-counter" className={clsx('absolute top-1/2 right-3 -translate-y-1/2 font-mono text-sm tabular-nums', normalizedLen === max ? 'text-emerald-600' : 'text-slate-400')} aria-live="polite">
                {normalizedLen}/{max}
              </span>
            </div>
            <div className="mt-2 min-h-5 text-sm" aria-live="polite">
              {idState === 'checking' && (
                <span className="inline-flex items-center gap-2 text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                </span>
              )}
              {idState === 'error' && idError && (
                <span className="inline-flex items-start gap-2 text-rose-600" role="alert">
                  <UserX className="mt-0.5 h-4 w-4 shrink-0" /> {idError}
                </span>
              )}
              {idState === 'idle' && !locationDone && <span className="text-slate-400">Confirm your location first.</span>}
              {idState === 'idle' && locationDone && <span className="text-slate-400">Verification starts automatically when your ID is complete.</span>}
            </div>
          </fieldset>
        )}
      </StepCard>

      {needSelfie && (
        <StepCard title="Take a selfie" step={++step} total={totalSteps} done={!!selfieId}>
          {!student ? (
            <p className="text-sm text-slate-400">Verify your student ID first.</p>
          ) : selfie ? (
            <div className="space-y-3">
              <img src={selfie.preview} alt="Selfie preview" className="mx-auto aspect-square w-full max-w-xs rounded-2xl object-cover" />
              {uploading && (
                <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Uploading photo…
                </p>
              )}
              {selfieId && <p className="text-center text-sm text-emerald-700">Photo ready.</p>}
              {selfieError && (
                <p className="flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                  <CameraOff className="h-4 w-4 shrink-0" /> {selfieError}
                </p>
              )}
              <Button variant="secondary" className="w-full" onClick={() => { setSelfie(null); setSelfieId(null); }} disabled={uploading} icon={<RefreshCw className="h-4 w-4" />}>
                Retake
              </Button>
            </div>
          ) : (
            <SelfieCapture onCaptured={uploadSelfie} busy={uploading} />
          )}
        </StepCard>
      )}

      <StepCard title="Submit attendance" step={++step} total={totalSteps}>
        {submitError && (
          <p className="mb-3 flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
          </p>
        )}
        <Button size="lg" className="w-full" disabled={!canSubmit} loading={submitting} onClick={submit} icon={<CheckCircle2 className="h-5 w-5" />}>
          {submitting ? 'Recording attendance…' : 'Record my attendance'}
        </Button>
        <p className="mt-3 text-center text-xs text-slate-400">The time recorded is set by the server, not your device.</p>
      </StepCard>
    </Shell>
  );
}

export function ConfirmationPage() {
  const { reference = '' } = useParams();
  const [sp] = useSearchParams();
  const [r, setR] = useState<SuccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let token = sp.get('token');
    try {
      token ??= sessionStorage.getItem(`nts-confirm-${reference}`);
    } catch {
      /* ignore */
    }
    if (!token) {
      setError('This confirmation link is incomplete.');
      return;
    }
    attendApi.confirmation(reference, token).then(setR, (e) => setError(e instanceof ApiError ? e.message : 'Unable to load confirmation'));
  }, [reference, sp]);
  return (
    <Shell>
      {r ? <SuccessView r={r} /> : error ? <FatalScreen f={{ code: 'X', title: 'Confirmation not found', message: error, icon: <AlertCircle className="h-8 w-8" /> }} /> : <Loader2 className="mx-auto mt-24 h-8 w-8 animate-spin text-slate-400" />}
      <p className="mt-6 text-center text-sm">
        <Link to="/" className="text-brand-700">
          About NTS
        </Link>
      </p>
    </Shell>
  );
}
