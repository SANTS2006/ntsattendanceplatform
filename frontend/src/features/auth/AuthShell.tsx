import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, MapPin, QrCode, ShieldCheck } from 'lucide-react';
import { Logo, LOGO_SRC } from '@/components/brand';
import { ThemeToggle } from '@/theme/ThemeProvider';

const FEATURES = [
  { icon: QrCode, title: 'Expiring, rotating QR codes', body: 'Unguessable codes that die in minutes — screenshots can’t be shared.' },
  { icon: MapPin, title: 'Server-side GPS geofence', body: 'Distance is computed by us, never trusted from the phone.' },
  { icon: ShieldCheck, title: 'Isolated & audited', body: 'Every organization’s data is walled off and every action logged.' },
];

const CHECKINS = [
  { name: 'Aminata Sesay', meta: 'CS201 · 6 m from venue' },
  { name: 'Ibrahim Kamara', meta: 'MTH102 · 11 m from venue' },
  { name: 'Fatmata Conteh', meta: 'Orientation Day · 4 m' },
  { name: 'Joseph Bangura', meta: 'ENG110 · 9 m from venue' },
];

function LiveCheckinCard() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % CHECKINS.length), 2600);
    return () => clearInterval(t);
  }, []);
  const c = CHECKINS[i];
  return (
    <div className="glass animate-float w-72 rounded-2xl p-4 text-navy-900 shadow-2xl [animation-duration:7s]">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-emerald-700 uppercase">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live check-in
        </span>
        <span className="text-[11px] text-slate-500">just now</span>
      </div>
      <div key={i} className="animate-fade-up flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-cyan-brand text-sm font-bold text-white">
          {c.name.split(' ').map((p) => p[0]).join('')}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{c.name}</p>
          <p className="truncate text-xs text-slate-500">{c.meta}</p>
        </div>
        <CheckCircle2 className="h-6 w-6 text-check" />
      </div>
    </div>
  );
}

/** Split-screen frame shared by every authentication page. */
export function AuthShell({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Brand panel (desktop) */}
      <aside className="bg-hero animate-gradient relative hidden w-[46%] max-w-[44rem] overflow-hidden text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:self-start">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="animate-float pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-cyan-400/25 blur-3xl" />
        <div className="animate-float pointer-events-none absolute right-[-6rem] bottom-[-6rem] h-96 w-96 rounded-full bg-brand-500/35 blur-3xl [animation-delay:-3s]" />
        <div className="relative flex flex-1 flex-col px-12 py-10 xl:px-16">
          <Link to="/" aria-label="NTSAttend home">
            <Logo light size="lg" />
          </Link>
          <div className="my-auto py-10">
            <img src={LOGO_SRC} alt="" className="animate-float mb-8 h-28 w-28 drop-shadow-[0_20px_40px_rgb(14_165_233/0.45)] [animation-duration:8s]" />
            <h2 className="max-w-md text-4xl leading-tight font-extrabold xl:text-[2.75rem]">
              Attendance that <span className="text-gradient-light">proves presence.</span>
            </h2>
            <p className="mt-4 max-w-md text-white/75">QR codes, GPS geofencing, automatic ID checks and selfies — for universities, schools and events.</p>
            <ul className="mt-8 space-y-4">
              {FEATURES.map((f, idx) => (
                <li key={f.title} className="animate-fade-up flex gap-3" style={{ animationDelay: `${150 + idx * 120}ms` }}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                    <f.icon className="h-5 w-5 text-cyan-200" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{f.title}</span>
                    <span className="block text-sm text-white/65">{f.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-end justify-between gap-6">
            <p className="text-xs text-white/50">© {new Date().getFullYear()} NTS Digital Solutions</p>
            <div className="hidden xl:block">
              <LiveCheckinCard />
            </div>
          </div>
        </div>
      </aside>

      {/* Form panel */}
      <main className="bg-app relative flex min-h-screen flex-1 flex-col">
        <div className="absolute top-4 right-4 z-10 hidden lg:block">
          <ThemeToggle />
        </div>
        <div className="bg-hero animate-gradient relative overflow-hidden px-5 pt-6 pb-16 text-white lg:hidden">
          <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-cyan-400/30 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <Link to="/" aria-label="NTSAttend home">
              <Logo light />
            </Link>
            <ThemeToggle light />
          </div>
          <p className="relative mt-3 text-sm text-white/75">Attendance that proves presence.</p>
        </div>
        <div className="-mt-10 flex flex-1 items-start justify-center px-3 pb-10 sm:px-6 lg:mt-0 lg:items-center lg:py-14">
          <div className={clsx('animate-fade-up w-full', wide ? 'max-w-xl' : 'max-w-md')}>
            <div className="glass relative overflow-hidden rounded-[1.75rem] shadow-[0_30px_70px_-28px_rgb(11_31_77/0.45)]">
              <div className="h-1.5 w-full bg-gradient-to-r from-brand-700 via-cyan-brand to-check" />
              <div className="p-5 sm:p-8">
                <div className="flex items-start gap-3.5">
                  <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-800 via-brand-700 to-cyan-brand shadow-[var(--shadow-glow)] sm:flex">
                    <img src={LOGO_SRC} alt="" className="h-8 w-8" />
                  </span>
                  <div className="min-w-0">
                    <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-[1.65rem]">{title}</h1>
                    {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
                  </div>
                </div>
                <div className="mt-6">{children}</div>
              </div>
              {footer && <div className="border-t border-slate-200/70 bg-slate-50/60 px-5 py-4 text-center text-sm text-slate-500 sm:px-8">{footer}</div>}
            </div>
            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> Secured with encryption · <Link to="/privacy" className="hover:text-brand-600">Privacy</Link> · <Link to="/terms" className="hover:text-brand-600">Terms</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
