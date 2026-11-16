import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/theme/ThemeProvider';
import { InstallAppButton } from '@/pwa/InstallButtons';
import { SITE } from '@/features/marketing/site';

const links = [
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

/** Marketing pages open with a dark hero, so the header starts transparent with light text. */
export function PublicLayout() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  const solid = scrolled || open;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header
        className={clsx(
          'fixed inset-x-0 top-0 z-40 transition-all duration-500',
          solid ? 'border-b border-slate-200/60 bg-white/80 shadow-[0_10px_30px_-20px_rgb(11_31_77/0.35)] backdrop-blur-xl' : 'bg-transparent',
        )}
      >
        <div className={clsx('flex w-full items-center justify-between px-4 transition-all duration-500 sm:px-6 lg:px-10', solid ? 'h-16' : 'h-20')}>
          <Link to="/" aria-label={`${SITE.product} home`}>
            <Logo light={!solid} />
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Site">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  clsx(
                    'relative rounded-full px-4 py-2 text-sm font-semibold transition',
                    solid
                      ? isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      : isActive ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <InstallAppButton variant="ghost" />
            <span className={clsx(!solid && '[&_button]:text-white [&_button:hover]:bg-white/10')}><ThemeToggle /></span>
            {status === 'authenticated' ? (
              <Link to="/app" className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-cyan-brand px-5 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-glow)] transition hover:brightness-110">
                Open dashboard <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <>
                <Link to="/login" className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition', solid ? 'text-slate-700 hover:bg-slate-100' : 'text-white/85 hover:bg-white/10 hover:text-white')}>
                  Sign in
                </Link>
                <Link to="/register" className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-cyan-brand px-5 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-glow)] transition hover:brightness-110">
                  Get started free <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <span className={clsx(!solid && '[&_button]:text-white')}><ThemeToggle /></span>
            <button
              className={clsx('rounded-xl p-2.5 transition', solid ? 'text-slate-800 hover:bg-slate-100' : 'text-white hover:bg-white/10')}
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        <div className={clsx('grid overflow-hidden transition-all duration-500 lg:hidden', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
          <div className="min-h-0">
            <nav className="space-y-1 border-t border-slate-200/60 px-4 pt-3 pb-5" aria-label="Site (mobile)">
              {links.map((l, i) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  style={{ transitionDelay: open ? `${i * 40}ms` : '0ms' }}
                  className={({ isActive }) => clsx('block rounded-xl px-4 py-3 text-base font-semibold transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100', open ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0')}
                >
                  {l.label}
                </NavLink>
              ))}
              <div className="grid gap-2 pt-3 sm:grid-cols-2">
                <InstallAppButton className="w-full" />
                <Link to={status === 'authenticated' ? '/app' : '/login'} className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-bold text-slate-800">
                  {status === 'authenticated' ? 'Open dashboard' : 'Sign in'}
                </Link>
                {status !== 'authenticated' && (
                  <Link to="/register" className="rounded-xl bg-gradient-to-r from-brand-600 to-cyan-brand px-4 py-3 text-center text-sm font-bold text-white sm:col-span-2">
                    Get started free
                  </Link>
                )}
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* clip (not hidden): stops slide-in animations widening the page without breaking sticky sections */}
      <main className="flex-1 overflow-x-clip">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  const cols: { title: string; items: [string, string][] }[] = [
    { title: 'Product', items: [['Features', '/features'], ['How it works', '/how-it-works'], ['Pricing', '/pricing'], ['Security', '/features#security']] },
    { title: 'Company', items: [['About us', '/about'], ['Contact', '/contact']] },
    { title: 'Get started', items: [['Create an account', '/register'], ['Sign in', '/login'], ['Forgot password', '/forgot-password']] },
    { title: 'Legal', items: [['Privacy Policy', '/privacy'], ['Terms of Service', '/terms']] },
  ];
  return (
    <footer className="bg-site-hero relative overflow-hidden text-white">
      <div className="bg-grid-dark absolute inset-0" aria-hidden="true" />
      <div className="relative w-full px-4 pt-16 pb-8 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo light />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
              {SITE.tagline} Expiring QR codes, server-verified location, automatic ID checks and live dashboards — built by {SITE.company}.
            </p>
            {(SITE.contactEmail || SITE.contactPhone || SITE.address) && (
              <ul className="mt-5 space-y-1.5 text-sm text-white/75">
                {SITE.contactEmail && <li><a className="hover:text-white" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></li>}
                {SITE.contactPhone && <li><a className="hover:text-white" href={`tel:${SITE.contactPhone.replace(/\s/g, '')}`}>{SITE.contactPhone}</a></li>}
                {SITE.address && <li>{SITE.address}</li>}
              </ul>
            )}
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <p className="text-xs font-bold tracking-[0.16em] text-cyan-200/80 uppercase">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.items.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-sm text-white/70 transition hover:text-white">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {SITE.company}. All rights reserved.</p>
          <p>Works on any phone, tablet or computer — install it as an app from your browser.</p>
        </div>
      </div>
    </footer>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-slate-50 px-4 pt-28 pb-12">
      <div className="w-full max-w-md">
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
