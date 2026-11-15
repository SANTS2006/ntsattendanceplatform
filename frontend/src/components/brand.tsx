import clsx from 'clsx';
import { LogOut } from 'lucide-react';

export const APP_NAME = 'NTSAttend';
export const LOGO_SRC = '/logo.png';

/* ── Logo & wordmark ─────────────────────────────────────────────────────── */
export function Logo({ className, light, size = 'md', withName = true }: { className?: string; light?: boolean; size?: 'sm' | 'md' | 'lg'; withName?: boolean }) {
  const img = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9';
  const text = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  return (
    <span className={clsx('inline-flex items-center gap-2.5 font-extrabold tracking-tight', className)}>
      <img src={LOGO_SRC} alt={withName ? '' : APP_NAME} className={clsx(img, 'shrink-0 drop-shadow-sm')} />
      {withName && (
        <span className={clsx(text, light ? 'text-white' : 'text-navy-800')}>
          NTS<span className={light ? 'text-gradient-light' : 'text-gradient'}>Attend</span>
        </span>
      )}
    </span>
  );
}

/* ── Logo spinner: the logo inside a rotating brand-gradient ring ───────────── */
const SPIN_SIZES = {
  xs: { box: 'h-5 w-5', img: 'h-3 w-3', ring: 2 },
  sm: { box: 'h-9 w-9', img: 'h-5 w-5', ring: 2.5 },
  md: { box: 'h-16 w-16', img: 'h-9 w-9', ring: 3 },
  lg: { box: 'h-24 w-24', img: 'h-14 w-14', ring: 4 },
} as const;

export function LogoSpinner({ size = 'md', className, light }: { size?: keyof typeof SPIN_SIZES; className?: string; light?: boolean }) {
  const s = SPIN_SIZES[size];
  return (
    <span className={clsx('relative inline-flex shrink-0 items-center justify-center', s.box, className)} role="status" aria-label="Loading">
      {size !== 'xs' && <span className={clsx('animate-pulse-glow absolute inset-0 rounded-full blur-md', light ? 'bg-white/25' : 'bg-brand-400/30')} />}
      <span
        className="animate-spin-slow absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, #2563eb 120deg, #0ea5e9 240deg, #22c55e 330deg, transparent 360deg)',
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${s.ring}px), #000 calc(100% - ${s.ring}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${s.ring}px), #000 calc(100% - ${s.ring}px))`,
        }}
      />
      <img src={LOGO_SRC} alt="" className={clsx('relative', s.img)} />
    </span>
  );
}

/** Full-screen loader (route chunks, session restore). */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="bg-app flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 py-24">
      <LogoSpinner size="lg" />
      <p className="text-sm font-semibold text-navy-700">{label}</p>
    </div>
  );
}

/** Section / widget loader. */
export function ModuleLoader({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 py-14', className)}>
      <LogoSpinner size="md" />
      <p className="text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}

/** Table loader: shimmering skeleton rows with the logo spinner floating above. */
export function TableSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="relative" aria-busy="true">
      <table className="min-w-full">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0">
              {Array.from({ length: columns }).map((__, c) => (
                <td key={c} className="px-4 py-4">
                  <div className="skeleton h-3.5" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="absolute inset-0 flex items-center justify-center bg-white/40">
        <div className="glass flex items-center gap-3 rounded-2xl px-5 py-3 shadow-[var(--shadow-soft)]">
          <LogoSpinner size="sm" />
          <span className="text-sm font-semibold text-navy-700">Loading data…</span>
        </div>
      </div>
    </div>
  );
}

/** Full-screen sign-out animation. */
export function SignOutOverlay() {
  return (
    <div className="bg-hero animate-gradient fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 text-white" role="alert" aria-live="assertive">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-float absolute -top-20 -left-16 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="animate-float absolute -right-10 -bottom-24 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl [animation-delay:-3s]" />
      </div>
      <LogoSpinner size="lg" light />
      <div className="animate-fade-up text-center">
        <p className="flex items-center justify-center gap-2 text-lg font-bold">
          <LogOut className="h-5 w-5" /> Signing you out securely…
        </p>
        <p className="mt-1 text-sm text-white/70">Revoking this device’s session</p>
      </div>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/15">
        <div className="animate-indeterminate h-full w-2/5 rounded-full bg-gradient-to-r from-cyan-300 via-white to-emerald-300" />
      </div>
    </div>
  );
}
