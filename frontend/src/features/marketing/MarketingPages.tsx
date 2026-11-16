import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowRight, BarChart3, Bell, Building2, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, Clock, Database, Download, FileSpreadsheet, Fingerprint,
  GraduationCap, Headset, History, KeyRound, Layers, LayoutDashboard, Lock, Mail, MapPin, MapPinned, Phone as PhoneIcon, QrCode, Radio, RefreshCw, ScanLine, School,
  Server, Shield, ShieldCheck, Smartphone, Sparkles, Timer, Upload, UserCog, Users, Zap,
} from 'lucide-react';
import { CountUp, Parallax, Reveal, TiltCard, usePrefersReducedMotion, useSectionProgress } from './motion';
import { SITE } from './site';

const HeroScene = lazy(() => import('./HeroScene'));

/* ── Shared building blocks ──────────────────────────────────────────────── */

function PrimaryCta({ to = '/register', children = 'Get started free' }: { to?: string; children?: ReactNode }) {
  return (
    <Link to={to} className="group inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-600 via-brand-500 to-cyan-brand px-6 py-3.5 text-sm font-bold text-white shadow-[0_18px_40px_-14px_rgb(37_99_235/0.8)] transition hover:brightness-110 active:scale-[0.98]">
      {children} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
    </Link>
  );
}
function GhostCta({ to, children, dark = true }: { to: string; children: ReactNode; dark?: boolean }) {
  return (
    <Link
      to={to}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold transition active:scale-[0.98]',
        dark ? 'bg-white/10 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/15' : 'bg-white text-navy-800 ring-1 ring-slate-200 hover:bg-slate-50',
      )}
    >
      {children}
    </Link>
  );
}

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <p className={clsx('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold tracking-[0.12em] uppercase', dark ? 'bg-white/10 text-cyan-100 ring-1 ring-white/15' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100')}>
      {children}
    </p>
  );
}

function SectionHeading({ eyebrow, title, intro, center = true }: { eyebrow: string; title: ReactNode; intro?: ReactNode; center?: boolean }) {
  return (
    <div className={clsx('max-w-3xl', center && 'mx-auto text-center')}>
      <Reveal><Eyebrow>{eyebrow}</Eyebrow></Reveal>
      <Reveal delay={80}><h2 className="mt-4 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl lg:text-5xl">{title}</h2></Reveal>
      {intro && <Reveal delay={160}><p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">{intro}</p></Reveal>}
    </div>
  );
}

/** Dark hero used at the top of every marketing page (the fixed header sits on top of it). */
function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="bg-site-hero relative overflow-hidden text-white">
      <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
      <span className="orb top-10 right-[8%] h-72 w-72 bg-cyan-400/40" aria-hidden="true" />
      <span className="orb bottom-0 left-[5%] h-80 w-80 bg-brand-600/50" style={{ animationDelay: '-6s' }} aria-hidden="true" />
      <div className="relative w-full px-4 pt-36 pb-20 sm:px-6 lg:px-10 lg:pt-44 lg:pb-28">
        <Reveal><Eyebrow dark>{eyebrow}</Eyebrow></Reveal>
        <Reveal delay={90}><h1 className="mt-5 max-w-4xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{title}</h1></Reveal>
        <Reveal delay={180}><p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/75">{intro}</p></Reveal>
        {children && <Reveal delay={260}><div className="mt-8">{children}</div></Reveal>}
      </div>
    </section>
  );
}

const Section = ({ children, className, id }: { children: ReactNode; className?: string; id?: string }) => (
  <section id={id} className={clsx('relative w-full scroll-mt-24 px-4 py-20 sm:px-6 lg:px-10 lg:py-28', className)}>{children}</section>
);

/* ── 3D hero visual (three.js, with a CSS-3D fallback) ───────────────────── */

function qrPattern(n = 21, seedStart = 7) {
  let seed = seedStart;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cells: boolean[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v: boolean | null = null;
      for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        if (x >= ox && x < ox + 7 && y >= oy && y < oy + 7) {
          const dx = x - ox, dy = y - oy;
          v = dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
        }
      }
      const sep = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
      cells.push(v ?? (sep ? false : rand() > 0.52));
    }
  }
  return cells;
}

function QrGlyph({ className }: { className?: string }) {
  const cells = useMemo(() => qrPattern(), []);
  return (
    <svg viewBox="0 0 21 21" className={className} shapeRendering="crispEdges" aria-hidden="true">
      {cells.map((on, i) => on && <rect key={i} x={i % 21} y={Math.floor(i / 21)} width="1" height="1" rx="0.18" className={(i % 21 < 7 && i < 147) || (i % 21 >= 14 && i < 147) || (i % 21 < 7 && i >= 294) ? 'fill-brand-600' : 'fill-navy-800'} />)}
    </svg>
  );
}

function StaticHeroModel() {
  return (
    <div className="relative mx-auto flex h-full max-w-md items-center justify-center [perspective:1200px]">
      <div className="animate-float relative [transform:rotateX(14deg)_rotateY(-22deg)] [transform-style:preserve-3d]">
        <div className="absolute -inset-10 rounded-full border-2 border-cyan-300/40 [transform:rotateX(70deg)_translateZ(-40px)]" />
        <div className="rounded-[2rem] bg-white p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.6)]">
          <QrGlyph className="h-56 w-56" />
        </div>
        <span className="absolute -top-6 -right-6 flex h-14 w-14 items-center justify-center rounded-full bg-check text-white shadow-xl [transform:translateZ(60px)]">
          <MapPin className="h-7 w-7" />
        </span>
      </div>
    </div>
  );
}

function HeroModel() {
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);
  if (failed) return <StaticHeroModel />;
  return (
    <Suspense fallback={<StaticHeroModel />}>
      <HeroScene reducedMotion={reduced} onFail={onFail} />
    </Suspense>
  );
}

/* ── Phone screens (How a check-in works) ────────────────────────────────── */

const STEPS = [
  { icon: QrCode, title: 'The lecturer projects a QR code', body: 'One click starts a session. The code expires in minutes and can rotate every 30 seconds, so a photo sent to the hostel group chat is useless.' },
  { icon: MapPinned, title: 'The phone proves where it is', body: 'The phone collects fresh GPS readings and keeps the most precise one. The server — never the phone — measures the distance to the classroom.' },
  { icon: Fingerprint, title: 'The student ID checks itself', body: 'Students type their ID; a live counter shows progress and verification starts automatically when the format is complete. No accounts, no app.' },
  { icon: Camera, title: 'A quick selfie', body: 'Optional front-camera photo, stripped of metadata and stored privately for your organization — a strong deterrent against proxy sign-ins.' },
  { icon: CheckCircle2, title: 'Recorded once, seen live', body: 'One record per student per session — duplicates are impossible. The lecturer watches check-ins arrive on the live dashboard.' },
];

function PhoneScreen({ step }: { step: number }) {
  return (
    <div key={step} className="screen-swap flex h-full flex-col">
      <div className="bg-hero rounded-2xl p-3 text-white">
        <p className="text-[10px] font-semibold text-white/70">Demo University</p>
        <p className="text-sm font-bold">CS201 · Data Structures</p>
      </div>
      <div className="mt-3 flex-1">
        {step === 0 && (
          <div className="relative mx-auto mt-2 aspect-square w-[85%] rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            <QrGlyph className="h-full w-full" />
            {['top-1 left-1 border-t-4 border-l-4', 'top-1 right-1 border-t-4 border-r-4', 'bottom-1 left-1 border-b-4 border-l-4', 'right-1 bottom-1 border-r-4 border-b-4'].map((c) => (
              <span key={c} className={clsx('absolute h-7 w-7 rounded-md border-cyan-brand', c)} />
            ))}
            <span className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-cyan-brand shadow-[0_0_14px_3px_rgb(14_165_233/0.7)]" />
            <p className="mt-3 text-center text-[11px] font-semibold text-slate-500">Scanning…</p>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-2.5">
            <div className="relative h-36 overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_50%_55%,#dbeafe,#eff6ff_60%)] ring-1 ring-slate-200">
              <span className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-brand-400 bg-brand-500/10" />
              <span className="animate-pulse-glow absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-check/30" />
              <MapPin className="absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-[85%] text-check" />
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Within the attendance area</div>
            <p className="text-center text-[11px] text-slate-500">6 m from the venue · reading ±8 m</p>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-2.5">
            <div className="rounded-xl border-2 border-brand-500 bg-white p-3">
              <p className="text-[10px] font-semibold text-slate-500">Student ID</p>
              <p className="flex justify-between font-mono text-base font-bold text-navy-900">20240017 <span className="text-emerald-600">8/8</span></p>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-brand text-sm font-bold text-white">AS</span>
              <div><p className="text-sm font-bold text-navy-900">Aminata Sesay</p><p className="text-[11px] text-slate-500">BSc Computer Science · Year 2</p></div>
            </div>
            <p className="text-center text-[11px] font-semibold text-emerald-700">Verified automatically</p>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col items-center">
            <div className="relative mt-2 h-40 w-40 overflow-hidden rounded-full bg-gradient-to-b from-slate-200 to-slate-300 ring-4 ring-brand-500/40">
              <span className="absolute top-8 left-1/2 h-14 w-14 -translate-x-1/2 rounded-full bg-slate-400" />
              <span className="absolute -bottom-6 left-1/2 h-24 w-32 -translate-x-1/2 rounded-full bg-slate-400" />
            </div>
            <span className="mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-brand-100"><Camera className="h-5 w-5" /></span>
          </div>
        )}
        {step === 4 && (
          <div className="flex flex-col items-center pt-4 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-11 w-11 text-emerald-600" /></span>
            <p className="mt-3 text-base font-extrabold text-navy-900">Attendance recorded</p>
            <p className="mt-1 font-mono text-xs font-semibold text-slate-600">NTS-7F3K-29QD</p>
            <p className="text-[11px] text-slate-500">09:02 · On time</p>
          </div>
        )}
      </div>
      <div className={clsx('mt-3 rounded-xl py-2.5 text-center text-xs font-bold text-white', step === 4 ? 'bg-emerald-600' : 'bg-gradient-to-r from-brand-600 to-cyan-brand')}>
        {['Open with camera', 'Share my location', 'Continue', 'Take selfie', 'Done'][step]}
      </div>
    </div>
  );
}

function Phone({ step, tilt }: { step: number; tilt?: { rx: number; ry: number } }) {
  return (
    <div className="phone-3d relative mx-auto w-[260px] sm:w-[280px]" style={tilt ? ({ '--phone-ry': `${tilt.ry}deg`, '--phone-rx': `${tilt.rx}deg` } as React.CSSProperties) : undefined}>
      <div className="rounded-[2.6rem] bg-navy-950 p-2.5 shadow-[0_50px_100px_-40px_rgb(11_31_77/0.8)] ring-1 ring-white/10">
        <div className="relative h-[540px] overflow-hidden rounded-[2.1rem] bg-slate-50 p-3.5 pt-8">
          <span className="absolute top-2.5 left-1/2 h-5 w-24 -translate-x-1/2 rounded-full bg-navy-950" />
          <PhoneScreen step={step} />
        </div>
      </div>
    </div>
  );
}

function useMinWidth(px: number) {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setOk(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return ok;
}

/** Scroll-driven story: the section pins while the phone steps through a check-in. */
function ScrollStory() {
  const ref = useRef<HTMLDivElement>(null);
  const p = useSectionProgress(ref);
  const desktop = useMinWidth(1024);
  const reduced = usePrefersReducedMotion();
  const [auto, setAuto] = useState(0);
  useEffect(() => {
    if (desktop) return;
    const t = setInterval(() => setAuto((s) => (s + 1) % STEPS.length), 2800);
    return () => clearInterval(t);
  }, [desktop]);
  const active = desktop ? Math.min(STEPS.length - 1, Math.floor(p * STEPS.length * 0.999)) : auto;

  if (!desktop) {
    return (
      <Section className="bg-white">
        <SectionHeading eyebrow="How a check-in works" title={<>Five steps. <span className="text-gradient">About ten seconds.</span></>} intro="Students need nothing but their phone's camera and browser." />
        <div className="mt-12"><Phone step={active} /></div>
        <ol className="mt-12 space-y-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} as="li" delay={i * 60} className={clsx('card flex gap-4 p-5 transition', active === i && 'ring-2 ring-brand-400')}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white"><s.icon className="h-5 w-5" /></span>
              <div><h3 className="font-bold text-navy-900">{i + 1}. {s.title}</h3><p className="mt-1 text-sm text-slate-600">{s.body}</p></div>
            </Reveal>
          ))}
        </ol>
      </Section>
    );
  }

  return (
    <section ref={ref} className="relative bg-white" style={{ height: `${STEPS.length * 85 + 40}vh` }} aria-label="How a check-in works">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="bg-grid absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative grid w-full items-center gap-16 px-10 lg:grid-cols-[1.1fr_1fr] xl:px-16">
          <div>
            <Eyebrow>How a check-in works</Eyebrow>
            <h2 className="mt-4 text-4xl font-extrabold tracking-tight text-navy-900 xl:text-5xl">Five steps. <span className="text-gradient">About ten seconds.</span></h2>
            <ol className="relative mt-10 space-y-2">
              <span className="absolute top-3 bottom-3 left-[1.35rem] w-0.5 bg-slate-200" aria-hidden="true" />
              <span className="absolute top-3 left-[1.35rem] w-0.5 origin-top bg-gradient-to-b from-brand-500 to-cyan-brand transition-[height] duration-300" style={{ height: `calc(${(active / (STEPS.length - 1)) * 100}% - 1.5rem)` }} aria-hidden="true" />
              {STEPS.map((s, i) => (
                <li key={s.title} className={clsx('relative flex gap-5 rounded-2xl p-3 transition-all duration-500', i === active ? 'bg-brand-50/70 ring-1 ring-brand-100' : 'opacity-55')}>
                  <span className={clsx('relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all duration-500', i <= active ? 'bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]' : 'bg-white text-slate-400 ring-1 ring-slate-200')}>
                    <s.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-navy-900">{s.title}</h3>
                    <div className={clsx('grid transition-all duration-500', i === active ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
                      <p className="min-h-0 overflow-hidden pt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="relative">
            <span className="orb top-10 left-1/4 h-64 w-64 bg-cyan-300/50" aria-hidden="true" />
            <Phone step={active} tilt={reduced ? undefined : { ry: -22 + p * 40, rx: 8 - p * 6 }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Content data ─────────────────────────────────────────────────────────── */

const FEATURES = [
  { icon: QrCode, title: 'Dynamic, expiring QR codes', body: 'Unpredictable 256-bit tokens, expiry from 5 minutes, instant revocation and optional 30-second rotation.' },
  { icon: MapPin, title: 'Server-verified geofencing', body: 'Fresh, precise readings only. The server measures the distance to the classroom (14–20 m) and never widens it for a poor signal.' },
  { icon: Fingerprint, title: 'Automatic student ID check', body: 'Your own ID format with a live counter; verification starts the moment the ID is complete.' },
  { icon: Camera, title: 'Selfie capture', body: 'Front-camera photo, metadata stripped, stored privately with short-lived links and retention controls.' },
  { icon: Radio, title: 'Live lecturer dashboard', body: 'Check-ins appear instantly. See who is absent, correct records with a reason, add manual entries.' },
  { icon: BarChart3, title: 'Reports & exports', body: 'Attendance trends, per-student rates and CSV, Excel and PDF exports generated in the background.' },
  { icon: Upload, title: 'Bulk import', body: 'Students, lecturers, classes and more from CSV or Excel — with column mapping, preview and error reports.' },
  { icon: Users, title: 'Lecturer accounts, automatically', body: 'Adding a lecturer creates their account and emails a setup link. Their personal space stays their own.' },
  { icon: Building2, title: 'One account, many organizations', body: 'Teach at one institution, run your own organization from the same login, and switch between them.' },
  { icon: Shield, title: 'Strict tenant isolation', body: 'Every organization’s data is separated in the application and enforced again in the database.' },
  { icon: Smartphone, title: 'Installs like an app', body: 'Works in any modern browser and installs on phones, tablets and computers — no app store needed.' },
  { icon: History, title: 'Complete audit trail', body: 'Who changed what and when — attendance corrections, venue locations, roles and settings.' },
];

const STATS = [
  { value: 1000, suffix: '', label: 'check-ins in 10.5 s', note: 'measured load test, 0 failures' },
  { value: 1, suffix: '', label: 'record per student, per session', note: '15 simultaneous duplicate attempts → 1 record' },
  { value: 20, suffix: ' m', label: 'maximum geofence radius', note: 'verified on the server, 14–20 m' },
  { value: 256, suffix: '-bit', label: 'QR token entropy', note: 'expiring, revocable, rotating' },
];

const ROLES = [
  { icon: Building2, title: 'Owners & administrators', points: ['Set student ID rules, location and selfie policies', 'Manage faculties, departments, programs, classes', 'Invite staff with custom roles and scopes', 'Organization-wide reports and audit log'] },
  { icon: GraduationCap, title: 'Lecturers', points: ['Account created for you — just set a password', 'Start a QR session in seconds, project it full screen', 'Watch check-ins live; correct records with a reason', 'Create your own organization with the same login'] },
  { icon: Smartphone, title: 'Students & attendees', points: ['No account, no app — scan and go', 'Clear guidance if location or ID needs attention', 'Instant confirmation with a reference number', 'Privacy-minded: masked email, private selfies'] },
];

const SECURITY = [
  { icon: Lock, title: 'Hardened sign-in', body: 'Argon2id password hashing, rotating refresh tokens, optional two-factor authentication and lockout on repeated failures.' },
  { icon: Database, title: 'Isolation by design', body: 'Tenant-scoped data access in the API, plus database rules and triggers that block cross-organization writes.' },
  { icon: ShieldCheck, title: 'Untrusted inputs, trusted decisions', body: 'Location, ID and timing are verified server-side using the server clock. Client “I’m inside” claims are ignored.' },
  { icon: History, title: 'Append-only audit', body: 'Security events and administrative changes are recorded and cannot be edited after the fact.' },
  { icon: KeyRound, title: 'Least privilege', body: 'Granular permissions with department scopes. One active role at a time, and membership never crosses organizations.' },
  { icon: Server, title: 'Backups & recovery', body: 'Encrypted database backups to cloud storage with restore tooling for platform administrators.' },
];

const USE_CASES = [
  { icon: GraduationCap, label: 'Universities' }, { icon: School, label: 'Colleges' }, { icon: School, label: 'Secondary schools' }, { icon: Layers, label: 'Training providers' },
  { icon: CalendarDays, label: 'Conferences & events' }, { icon: Users, label: 'Workshops' }, { icon: Building2, label: 'Professional bodies' }, { icon: Sparkles, label: 'Bootcamps' },
];

const FAQ = [
  ['Do students need to install anything?', 'No. Students scan the QR code with their phone camera and complete the check-in in the browser. Staff can optionally install NTSAttend as an app.'],
  ['Can a student check in from outside the classroom?', 'The phone must provide a fresh, precise location inside your geofence (14–20 m), and the server makes the decision. GPS raises the bar significantly, but like any browser location it is not absolute proof — NTSAttend records signals so staff can review anomalies.'],
  ['What happens if the location is imprecise indoors?', 'The phone keeps collecting readings and uses the most precise one. If it is still too imprecise, the student sees why and can retry — near a window or after a few seconds is usually enough.'],
  ['How do lecturers get accounts?', 'When an administrator adds a lecturer (one by one or by import), NTSAttend creates the account in that organization and emails a link to set a password. If the person already has an NTSAttend account, it is simply added.'],
  ['Can a lecturer also run their own organization?', 'Yes. One login can belong to several organizations. A lecturer can create their own organization and be its owner, then switch between it and the institutions they work for. Data never mixes.'],
  ['Which devices are supported?', 'Any modern browser on Android, iPhone, tablets, Windows, macOS and Linux. Location features need HTTPS (provided) and permission on the device.'],
] as const;

const PLANS = [
  { name: 'Starter', price: 'Free', note: 'For pilots and small classes', items: ['Up to 300 students', '2 staff accounts', 'QR + location + ID verification', 'CSV export'] },
  { name: 'Institution', price: 'Contact us', note: 'For schools and colleges', items: ['Unlimited students', 'Unlimited staff & custom roles', 'Selfies with retention controls', 'Excel & PDF reports', 'Priority support'], featured: true },
  { name: 'Enterprise', price: 'Contact us', note: 'Universities and multi-campus groups', items: ['Everything in Institution', 'Student information system integration', 'Dedicated environment options', 'SLA & security review'] },
];

/* ── Sections ──────────────────────────────────────────────────────────────── */

function UseCaseMarquee() {
  const row = [...USE_CASES, ...USE_CASES];
  return (
    <div className="marquee-mask overflow-hidden border-y border-slate-200/70 bg-slate-50 py-6">
      <div className="marquee gap-4 px-2">
        {row.map((u, i) => (
          <span key={i} className="flex shrink-0 items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
            <u.icon className="h-4 w-4 text-brand-600" /> {u.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatsBand() {
  return (
    <Section className="bg-white !py-16">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 80} variant="zoom">
            <div className="card hover-lift h-full p-6">
              <p className="text-gradient text-4xl font-extrabold lg:text-5xl"><CountUp value={s.value} suffix={s.suffix} /></p>
              <p className="mt-2 font-bold text-navy-900">{s.label}</p>
              <p className="mt-1 text-xs text-slate-500">{s.note}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function FeatureBento({ items = FEATURES.slice(0, 5) }: { items?: typeof FEATURES }) {
  // A wide first card only when it completes rows of three (2 + 1, then threes).
  const wide = items.length % 3 === 2;
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f, i) => (
        <Reveal key={f.title} delay={(i % 3) * 90} variant="tilt" className={clsx(i === 0 && wide && 'lg:col-span-2')}>
          <TiltCard className="card group h-full overflow-hidden p-7">
            <span className="depth flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)] transition group-hover:scale-110">
              <f.icon className="h-6 w-6" />
            </span>
            <h3 className="mt-5 text-lg font-bold text-navy-900">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            {i === 0 && wide && (
              <div className="mt-6 flex items-center gap-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
                <QrGlyph className="h-20 w-20 shrink-0 rounded-lg bg-white p-1.5" />
                <div className="text-xs text-slate-600">
                  <p className="flex items-center gap-1.5 font-semibold text-navy-900"><Timer className="h-3.5 w-3.5 text-brand-600" /> Expires in 14:52</p>
                  <p className="mt-1.5 flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 text-cyan-brand" /> Rotates every 30 s</p>
                  <p className="mt-1.5 flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-check" /> Revoke instantly</p>
                </div>
              </div>
            )}
          </TiltCard>
        </Reveal>
      ))}
    </div>
  );
}

function DashboardPreview() {
  const bars = [62, 78, 71, 88, 92, 84, 95];
  return (
    <Section className="bg-site-hero overflow-hidden text-white">
      <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
      <div className="relative grid items-center gap-14 lg:grid-cols-2">
        <div>
          <Reveal><Eyebrow dark>Live dashboard</Eyebrow></Reveal>
          <Reveal delay={80}><h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">See every check-in <span className="text-gradient-light">as it happens.</span></h2></Reveal>
          <Reveal delay={160}>
            <ul className="mt-8 space-y-4 text-white/80">
              {[[Radio, 'Real-time feed of arrivals, late arrivals and failed attempts'], [Users, 'Present, absent and attendance rate at a glance'], [FileSpreadsheet, 'Export the session to CSV, Excel or PDF in one click'], [Bell, 'Notifications when imports, reports and backups finish']].map(([Icon, t]) => {
                const I = Icon as typeof Radio;
                return <li key={t as string} className="flex gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><I className="h-4 w-4 text-cyan-200" /></span><span>{t as string}</span></li>;
              })}
            </ul>
          </Reveal>
        </div>
        <Parallax speed={0.08}>
          <Reveal variant="tilt">
            <TiltCard max={6} className="rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/15 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div><p className="text-xs text-white/60">CS201 · Group A</p><p className="font-bold">Session live · 09:00–09:15</p></div>
                <span className="flex items-center gap-1.5 rounded-full bg-check/20 px-3 py-1 text-xs font-bold text-emerald-200"><span className="h-2 w-2 animate-pulse rounded-full bg-check" /> Live</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[['Present', '47'], ['Absent', '6'], ['Rate', '89%']].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"><p className="text-[11px] text-white/60">{k}</p><p className="text-2xl font-extrabold">{v}</p></div>
                ))}
              </div>
              <div className="mt-5 flex h-32 items-end gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
                {bars.map((b, i) => (
                  <Reveal key={i} delay={i * 70} variant="up" className="flex-1">
                    <div className="rounded-t-lg bg-gradient-to-t from-brand-500 to-cyan-300" style={{ height: `${b}px` }} />
                  </Reveal>
                ))}
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                {[['Aminata S.', '09:02', 'On time'], ['Mohamed K.', '09:03', 'On time'], ['Fatmata B.', '09:11', 'Late']].map(([n, t, s]) => (
                  <li key={n} className="flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-white/10">
                    <span className="font-semibold">{n}</span><span className="text-xs text-white/60">{t}</span>
                    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', s === 'Late' ? 'bg-amber-400/20 text-amber-200' : 'bg-check/20 text-emerald-200')}>{s}</span>
                  </li>
                ))}
              </ul>
            </TiltCard>
          </Reveal>
        </Parallax>
      </div>
    </Section>
  );
}

function RolesSection() {
  return (
    <Section className="bg-slate-50">
      <SectionHeading eyebrow="Built for everyone involved" title={<>The right tools for <span className="text-gradient">every role.</span></>} />
      <div className="mt-14 grid gap-6 lg:grid-cols-3">
        {ROLES.map((r, i) => (
          <Reveal key={r.title} delay={i * 110} variant="up">
            <TiltCard className="card h-full p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-cyan-200"><r.icon className="h-6 w-6" /></span>
              <h3 className="mt-5 text-xl font-bold text-navy-900">{r.title}</h3>
              <ul className="mt-4 space-y-3">
                {r.points.map((p) => <li key={p} className="flex gap-2.5 text-sm text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-check" /> {p}</li>)}
              </ul>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function SecuritySection() {
  return (
    <Section id="security" className="bg-white">
      <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading center={false} eyebrow="Security & privacy" title={<>Trust that holds up <span className="text-gradient">under scrutiny.</span></>} intro="Attendance decides grades, eligibility and payments. NTSAttend treats every phone as untrusted and every decision as auditable." />
          <Reveal delay={220}>
            <p className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
              Honest note: browser GPS and selfies raise the bar significantly but are not cryptographic proof of presence or identity. NTSAttend records verification signals and flags anomalies for staff review.
            </p>
          </Reveal>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {SECURITY.map((s, i) => (
            <Reveal key={s.title} delay={(i % 2) * 100} variant={i % 2 ? 'right' : 'left'}>
              <div className="card hover-lift h-full p-6">
                <s.icon className="h-6 w-6 text-brand-600" />
                <h3 className="mt-4 font-bold text-navy-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FaqSection({ items = FAQ }: { items?: readonly (readonly [string, string])[] }) {
  return (
    <Section className="bg-slate-50">
      <SectionHeading eyebrow="Questions" title={<>Frequently asked <span className="text-gradient">questions</span></>} />
      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        {items.map(([q, a], i) => (
          <Reveal key={q} delay={i * 50}>
            <details className="group card overflow-hidden p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-left font-bold text-navy-900 transition hover:bg-slate-50">
                {q}
                <ChevronDown className="h-5 w-5 shrink-0 text-brand-600 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="px-6 pb-6 text-sm leading-relaxed text-slate-600">{a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function CtaBand({ title = 'Run your first secure session today.', body = 'Create your organization, import students from Excel, add lecturers and project your first QR code — all in an afternoon.' }: { title?: string; body?: string }) {
  return (
    <Section className="bg-white">
      <Reveal variant="zoom">
        <div className="bg-site-hero relative overflow-hidden rounded-[2.5rem] px-6 py-16 text-center text-white sm:px-12 lg:py-20">
          <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
          <span className="orb -top-10 -left-10 h-72 w-72 bg-cyan-400/40" aria-hidden="true" />
          <span className="orb -right-10 -bottom-16 h-72 w-72 bg-brand-500/50" style={{ animationDelay: '-8s' }} aria-hidden="true" />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">{title}</h2>
            <p className="mt-4 text-lg text-white/75">{body}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <PrimaryCta />
              <GhostCta to="/contact">Talk to us</GhostCta>
            </div>
            <p className="mt-5 text-xs text-white/55">Free Starter plan · No card required · Students never need an account</p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── Pages ─────────────────────────────────────────────────────────────────── */

export function LandingPage() {
  return (
    <>
      <section className="bg-site-hero relative min-h-[100svh] overflow-hidden text-white">
        <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
        <span className="orb top-24 left-[40%] h-80 w-80 bg-brand-500/40" aria-hidden="true" />
        <span className="orb right-0 bottom-10 h-96 w-96 bg-cyan-400/30" style={{ animationDelay: '-9s' }} aria-hidden="true" />
        <div className="relative grid min-h-[100svh] w-full items-center gap-6 px-4 pt-28 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-10 lg:pt-24">
          <div>
            <Reveal><Eyebrow dark><Lock className="h-3.5 w-3.5" /> Secure multi-tenant attendance</Eyebrow></Reveal>
            <Reveal delay={100}>
              <h1 className="mt-6 text-[2.6rem] leading-[1.05] font-extrabold tracking-tight sm:text-6xl xl:text-7xl">
                Attendance that proves <span className="text-gradient-light">someone was really there.</span>
              </h1>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
                Expiring QR codes, server-verified location, automatic student ID checks and selfies — so proxy sign-ins from the hostel stop, and every record holds up.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <div className="mt-9 flex flex-wrap gap-3">
                <PrimaryCta>Register your organization</PrimaryCta>
                <GhostCta to="/how-it-works">See how it works</GhostCta>
              </div>
            </Reveal>
            <Reveal delay={400}>
              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
                {['Students need no account', 'Works on any phone', 'Live dashboard'].map((t) => (
                  <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-check" /> {t}</li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div className="relative h-[380px] sm:h-[480px] lg:h-[620px]">
            <HeroModel />
            <Reveal delay={700} variant="left" className="absolute top-[12%] left-0 hidden sm:block">
              <div className="animate-float rounded-2xl bg-white/10 px-4 py-3 text-sm ring-1 ring-white/20 backdrop-blur-xl">
                <p className="flex items-center gap-2 font-bold"><MapPin className="h-4 w-4 text-check" /> Inside the classroom</p>
                <p className="text-xs text-white/65">6 m from the venue · ±8 m</p>
              </div>
            </Reveal>
            <Reveal delay={900} variant="right" className="absolute right-2 bottom-[14%] hidden sm:block">
              <div className="animate-float rounded-2xl bg-white/10 px-4 py-3 text-sm ring-1 ring-white/20 backdrop-blur-xl" style={{ animationDelay: '-3s' }}>
                <p className="flex items-center gap-2 font-bold"><Zap className="h-4 w-4 text-cyan-200" /> 47 checked in</p>
                <p className="text-xs text-white/65">Live · updated just now</p>
              </div>
            </Reveal>
          </div>
        </div>
        <a href="#next" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-xs font-semibold text-white/60 transition hover:text-white lg:flex">
          Scroll <ChevronDown className="h-4 w-4 animate-bounce" />
        </a>
      </section>

      <div id="next" className="scroll-mt-16"><UseCaseMarquee /></div>
      <StatsBand />

      <Section className="bg-white !pt-6">
        <SectionHeading eyebrow="Everything an institution needs" title={<>Defense in depth, <span className="text-gradient">zero friction.</span></>} intro="Each layer makes cheating harder while keeping check-in fast for honest students." />
        <div className="mt-14"><FeatureBento /></div>
        <Reveal className="mt-10 text-center"><Link to="/features" className="inline-flex items-center gap-1.5 font-bold text-brand-700 hover:text-brand-800">Explore all features <ArrowRight className="h-4 w-4" /></Link></Reveal>
      </Section>

      <ScrollStory />
      <DashboardPreview />
      <RolesSection />
      <SecuritySection />
      <FaqSection />
      <CtaBand />
    </>
  );
}

export function FeaturesPage() {
  return (
    <>
      <PageHero eyebrow="Features" title={<>Every layer of <span className="text-gradient-light">attendance integrity.</span></>} intro="From the QR code on the projector to the export on the registrar’s desk — designed to be hard to cheat and easy to use.">
        <div className="flex flex-wrap gap-3"><PrimaryCta /><GhostCta to="/how-it-works">How it works</GhostCta></div>
      </PageHero>
      <Section className="bg-white">
        <SectionHeading eyebrow="The platform" title={<>Built for real <span className="text-gradient">classrooms.</span></>} />
        <div className="mt-14"><FeatureBento items={FEATURES} /></div>
      </Section>
      <Section className="bg-slate-50">
        <SectionHeading eyebrow="Compared" title={<>Paper registers vs <span className="text-gradient">NTSAttend</span></>} />
        <Reveal variant="up" className="mx-auto mt-12 max-w-4xl">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="bg-slate-50"><th className="table-th">&nbsp;</th><th className="table-th">Paper / spreadsheet</th><th className="table-th text-brand-700">NTSAttend</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ['Proxy sign-ins', 'Easy — sign for a friend', 'Location + ID + optional selfie'],
                  ['Time to take attendance', 'Minutes per class', 'Students check themselves in'],
                  ['Duplicate entries', 'Common', 'Impossible (one record per session)'],
                  ['Reports', 'Manual typing', 'Live dashboards and exports'],
                  ['Corrections', 'Untracked', 'Audited with a reason'],
                ].map(([k, a, b]) => (
                  <tr key={k}><td className="table-td font-bold text-navy-900">{k}</td><td className="table-td text-slate-500">{a}</td><td className="table-td font-semibold text-emerald-700"><span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> {b}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </Section>
      <SecuritySection />
      <CtaBand />
    </>
  );
}

export function HowItWorksPage() {
  const setup = [
    { icon: Building2, title: 'Create your organization', body: 'Register, choose your institution type and set your time zone. You become the owner.' },
    { icon: Fingerprint, title: 'Set your rules', body: 'Student ID format, location radius and accuracy, selfie and enrollment requirements.' },
    { icon: Upload, title: 'Import your data', body: 'Students, departments, programs, courses, classes and lecturers from Excel or CSV.' },
    { icon: UserCog, title: 'Add lecturers', body: 'Each lecturer gets an account automatically and an email to set their password.' },
    { icon: MapPinned, title: 'Register venues', body: 'Capture each classroom by GPS at the venue, or place it precisely on the map.' },
    { icon: QrCode, title: 'Run sessions', body: 'Lecturers start a session, project the QR code and watch attendance arrive live.' },
  ];
  return (
    <>
      <PageHero eyebrow="How it works" title={<>From setup to <span className="text-gradient-light">first check-in</span> in an afternoon.</>} intro="A simple flow for students, a clear workflow for lecturers and full control for administrators." />
      <ScrollStory />
      <Section className="bg-slate-50">
        <SectionHeading eyebrow="For administrators" title={<>Getting your institution <span className="text-gradient">ready.</span></>} />
        <ol className="relative mx-auto mt-14 max-w-4xl">
          <span className="absolute top-0 bottom-0 left-6 w-0.5 bg-gradient-to-b from-brand-500 via-cyan-brand to-check sm:left-1/2" aria-hidden="true" />
          {setup.map((s, i) => (
            <Reveal key={s.title} as="li" variant={i % 2 ? 'right' : 'left'} className={clsx('relative mb-8 pl-16 sm:w-1/2 sm:pl-0', i % 2 ? 'sm:ml-auto sm:pl-12' : 'sm:pr-12 sm:text-right')}>
              <span className={clsx('absolute top-4 left-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-extrabold text-brand-700 ring-4 ring-brand-100', i % 2 ? 'sm:-left-[1.15rem]' : 'sm:right-[-1.15rem] sm:left-auto')}>{i + 1}</span>
              <div className="card hover-lift p-6">
                <s.icon className={clsx('h-6 w-6 text-brand-600', i % 2 ? '' : 'sm:ml-auto')} />
                <h3 className="mt-3 text-lg font-bold text-navy-900">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </Section>
      <DashboardPreview />
      <CtaBand />
    </>
  );
}

export function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title={<>Start free. <span className="text-gradient-light">Grow when you’re ready.</span></>} intro="Plans are informational while billing is being introduced — every organization can start on Starter today." />
      <Section className="bg-white">
        <div className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * 110} variant="tilt">
              <TiltCard className={clsx('card relative h-full p-8', p.featured && 'ring-2 ring-brand-500')}>
                {p.featured && <span className="absolute -top-3 left-8 rounded-full bg-gradient-to-r from-brand-600 to-cyan-brand px-3 py-1 text-xs font-bold text-white shadow-lg">Most popular</span>}
                <h2 className="text-lg font-bold text-navy-900">{p.name}</h2>
                <p className="mt-3 text-4xl font-extrabold text-navy-900">{p.price}</p>
                <p className="mt-1 text-sm text-slate-500">{p.note}</p>
                <ul className="mt-7 space-y-3 text-sm">{p.items.map((it) => <li key={it} className="flex gap-2.5 text-slate-700"><Check className="mt-0.5 h-4 w-4 shrink-0 text-check" /> {it}</li>)}</ul>
                <Link to={p.price === 'Free' ? '/register' : '/contact'} className={clsx('mt-8 block rounded-full py-3 text-center text-sm font-bold transition', p.featured ? 'bg-gradient-to-r from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)] hover:brightness-110' : 'bg-navy-900 text-white hover:bg-navy-800')}>
                  {p.price === 'Free' ? 'Start free' : 'Talk to us'}
                </Link>
              </TiltCard>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10 text-center text-sm text-slate-500">Every plan includes expiring QR codes, server-verified location, automatic ID checks, audit logs and the installable app.</Reveal>
      </Section>
      <FaqSection items={[
        ['Is there really a free plan?', 'Yes. Starter is free for pilots and small classes — create your organization and start right away.'],
        ['Do students count as users?', 'No. Students and event attendees never need accounts; plans count the students in your roster.'],
        ['Can we move to a larger plan later?', 'Yes. Your data, settings and history stay exactly where they are.'],
        ['Do you offer onboarding?', 'Institution and Enterprise plans include help importing data and configuring policies. Contact us to plan it.'],
      ]} />
      <CtaBand />
    </>
  );
}

export function AboutPage() {
  const values = [
    { icon: ShieldCheck, title: 'Integrity first', body: 'Attendance should mean presence. Every feature is judged by whether it makes records more trustworthy.' },
    { icon: Users, title: 'Respect for students', body: 'Minimal data, masked emails, private selfies with retention limits — and clear messages when something needs attention.' },
    { icon: Zap, title: 'Fast for everyone', body: 'Seconds for students, one click for lecturers, minutes to set up for administrators.' },
    { icon: Layers, title: 'Built to scale', body: 'Multi-tenant from day one, so a single lecturer, a school or a multi-campus university all fit.' },
  ];
  return (
    <>
      <PageHero eyebrow="About us" title={<>We build attendance <span className="text-gradient-light">people can trust.</span></>} intro={`${SITE.product} is made by ${SITE.company} to replace paper registers and proxy sign-ins with verifiable, privacy-minded attendance.`} />
      <Section className="bg-white">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <SectionHeading center={false} eyebrow="Our mission" title={<>Make every check-in <span className="text-gradient">mean something.</span></>} />
            <Reveal delay={200}>
              <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
                <p>Institutions depend on attendance for grading, eligibility, scholarships and safety — yet paper registers are slow and easy to fake. We set out to build something that respects everyone’s time and still holds up to scrutiny.</p>
                <p>{SITE.product} combines several independent checks — a short-lived QR code, server-verified location, automatic ID validation and optional selfies — and records the evidence so staff can review anything unusual.</p>
              </div>
            </Reveal>
          </div>
          <Reveal variant="right">
            <div className="grid grid-cols-2 gap-4">
              {[[QrCode, 'Expiring QR'], [MapPin, 'Verified location'], [Fingerprint, 'ID checks'], [Radio, 'Live results']].map(([Icon, t], i) => {
                const I = Icon as typeof QrCode;
                return (
                  <TiltCard key={t as string} className={clsx('card flex aspect-square flex-col items-center justify-center p-6 text-center', i % 2 && 'translate-y-8')}>
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]"><I className="h-7 w-7" /></span>
                    <p className="mt-4 font-bold text-navy-900">{t as string}</p>
                  </TiltCard>
                );
              })}
            </div>
          </Reveal>
        </div>
      </Section>
      <Section className="bg-slate-50">
        <SectionHeading eyebrow="What we value" title={<>Principles behind <span className="text-gradient">the product.</span></>} />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v, i) => (
            <Reveal key={v.title} delay={i * 90} variant="up">
              <div className="card hover-lift h-full p-6"><v.icon className="h-6 w-6 text-brand-600" /><h3 className="mt-4 font-bold text-navy-900">{v.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{v.body}</p></div>
            </Reveal>
          ))}
        </div>
      </Section>
      <StatsBand />
      <CtaBand />
    </>
  );
}

export function ContactPage() {
  const channels = [
    { icon: Sparkles, title: 'Start right away', body: 'Create your organization on the free Starter plan and run your first session today.', action: { label: 'Create an account', to: '/register' } },
    { icon: Headset, title: 'Existing customers', body: 'Sign in and open Help & support to message our team directly from your organization.', action: { label: 'Sign in', to: '/login' } },
    { icon: Building2, title: 'Institutions & universities', body: 'Planning a rollout across departments or campuses? We can help with data import and policies.', action: SITE.contactEmail ? { label: 'Email us', href: `mailto:${SITE.contactEmail}` } : { label: 'Sign in to contact us', to: '/login' } },
  ];
  return (
    <>
      <PageHero eyebrow="Contact" title={<>Let’s talk about <span className="text-gradient-light">your attendance.</span></>} intro="Demos, pricing, onboarding or support — here is how to reach the right people." />
      <Section className="bg-white">
        <div className="grid gap-6 lg:grid-cols-3">
          {channels.map((c, i) => (
            <Reveal key={c.title} delay={i * 100} variant="up">
              <TiltCard className="card flex h-full flex-col p-7">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white"><c.icon className="h-6 w-6" /></span>
                <h2 className="mt-5 text-lg font-bold text-navy-900">{c.title}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{c.body}</p>
                {'href' in c.action ? (
                  <a href={c.action.href} className="mt-6 inline-flex items-center gap-1.5 font-bold text-brand-700 hover:text-brand-800">{c.action.label} <ArrowRight className="h-4 w-4" /></a>
                ) : (
                  <Link to={c.action.to} className="mt-6 inline-flex items-center gap-1.5 font-bold text-brand-700 hover:text-brand-800">{c.action.label} <ArrowRight className="h-4 w-4" /></Link>
                )}
              </TiltCard>
            </Reveal>
          ))}
        </div>
        {(SITE.contactEmail || SITE.contactPhone || SITE.address) && (
          <Reveal className="mx-auto mt-12 max-w-3xl">
            <div className="card grid gap-4 p-6 sm:grid-cols-3">
              {SITE.contactEmail && <a href={`mailto:${SITE.contactEmail}`} className="flex items-center gap-3 text-sm font-semibold text-navy-900"><Mail className="h-5 w-5 text-brand-600" /> {SITE.contactEmail}</a>}
              {SITE.contactPhone && <a href={`tel:${SITE.contactPhone.replace(/\s/g, '')}`} className="flex items-center gap-3 text-sm font-semibold text-navy-900"><PhoneIcon className="h-5 w-5 text-brand-600" /> {SITE.contactPhone}</a>}
              {SITE.address && <p className="flex items-center gap-3 text-sm font-semibold text-navy-900"><MapPin className="h-5 w-5 text-brand-600" /> {SITE.address}</p>}
            </div>
          </Reveal>
        )}
        <Reveal className="mx-auto mt-12 max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-3">
            {[[Clock, 'Quick replies', 'Support requests from inside the app reach our team directly.'], [Download, 'Install the app', 'Use the install button in your browser on any device.'], [LayoutDashboard, 'Self-service', 'Administrators manage users, roles and settings themselves.']].map(([Icon, t, b]) => {
              const I = Icon as typeof Clock;
              return <div key={t as string} className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200/70"><I className="h-5 w-5 text-brand-600" /><p className="mt-3 font-bold text-navy-900">{t as string}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{b as string}</p></div>;
            })}
          </div>
        </Reveal>
      </Section>
      <FaqSection items={FAQ.slice(0, 4)} />
    </>
  );
}

export function NotFoundPage() {
  return (
    <section className="bg-site-hero relative flex min-h-[80vh] items-center justify-center overflow-hidden px-4 pt-24 text-center text-white">
      <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
      <div className="relative">
        <Reveal variant="zoom"><ScanLine className="mx-auto h-14 w-14 text-cyan-200" /></Reveal>
        <Reveal delay={100}><p className="text-gradient-light mt-4 text-8xl font-extrabold">404</p></Reveal>
        <Reveal delay={200}><h1 className="mt-2 text-2xl font-bold">This page couldn’t be scanned.</h1></Reveal>
        <Reveal delay={300}><p className="mt-2 text-white/70">The link may be broken or the page may have moved.</p></Reveal>
        <Reveal delay={400}><div className="mt-8 flex justify-center gap-3"><PrimaryCta to="/">Go home</PrimaryCta><GhostCta to="/contact">Contact</GhostCta></div></Reveal>
      </div>
    </section>
  );
}
