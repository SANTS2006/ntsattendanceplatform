import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/theme/ThemeProvider';

const links = [
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export function PublicLayout() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Site">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `text-sm font-medium ${isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900'}`}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            {status === 'authenticated' ? (
              <Link to="/app" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                  Get started
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center md:hidden"><ThemeToggle /></div>
          <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-slate-100 px-4 py-3 md:hidden">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="block py-2 text-sm text-slate-700" onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            <Link to={status === 'authenticated' ? '/app' : '/login'} className="block py-2 text-sm font-medium text-brand-700" onClick={() => setOpen(false)}>
              {status === 'authenticated' ? 'Open dashboard' : 'Sign in'}
            </Link>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} NTS Digital Solutions. Secure attendance for every institution.</p>
          <nav className="flex gap-4" aria-label="Legal">
            <Link to="/privacy" className="hover:text-brand-700">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-brand-700">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-slate-50 px-4 py-12">
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
