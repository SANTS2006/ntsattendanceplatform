import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Activity, ArrowLeft, Building2, DatabaseBackup, FileText, Gauge, Headset, Lightbulb, Menu, Settings, ShieldAlert, Users, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/brand';
import { SidebarUserCard } from '@/components/UserCard';
import { NotificationsMenu, ProfileMenu } from '@/components/HeaderMenus';
import { ThemeToggle, useTheme } from '@/theme/ThemeProvider';
import { usePlatformSupportUnread } from '@/features/support/SupportPages';

const NAV = [
  { to: '/platform', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/platform/organizations', label: 'Organizations', icon: Building2 },
  { to: '/platform/users', label: 'Users', icon: Users },
  { to: '/platform/analytics', label: 'Usage analytics', icon: Activity },
  { to: '/platform/security', label: 'Security', icon: ShieldAlert },
  { to: '/platform/support', label: 'Support inbox', icon: Headset, badge: true },
  { to: '/platform/feedback', label: 'Feedback', icon: Lightbulb },
  { to: '/platform/audit', label: 'Audit logs', icon: FileText },
  { to: '/platform/backups', label: 'Backup & recovery', icon: DatabaseBackup },
  { to: '/platform/settings', label: 'Platform settings', icon: Settings },
];

function PlatformSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me } = useAuth();
  const unread = usePlatformSupportUnread();
  const dark = useTheme().resolved === 'dark';
  return (
    <div className="bg-sidebar flex h-full flex-col">
      <div className="flex h-[4.5rem] items-center gap-2 px-5">
        <Logo light={dark} />
        <span className="rounded-md bg-(--sb-violet-bg) px-2 py-0.5 text-[10px] font-bold tracking-wider text-(--sb-violet-text) uppercase">Platform</span>
      </div>
      <nav className="scroll-dark flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Platform">
        <p className="mb-1.5 px-3 text-[10px] font-bold tracking-[0.14em] text-(--sb-text-3) uppercase">Super admin</p>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-(--sb-active) text-(--sb-active-text)' : 'text-(--sb-text-2) hover:bg-(--sb-hover) hover:text-(--sb-text)')
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-violet-300 to-cyan-300" />}
                <span className={clsx('flex h-8 w-8 items-center justify-center rounded-lg', isActive ? 'bg-gradient-to-br from-violet-500 to-brand-600 text-white' : 'bg-(--sb-surface-2) text-(--sb-icon)')}>
                  <n.icon className="h-[18px] w-[18px]" />
                </span>
                {n.label}
                {'badge' in n && n.badge && unread > 0 && <span className="ml-auto rounded-full bg-gradient-to-r from-rose-500 to-pink-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
              </>
            )}
          </NavLink>
        ))}
        {me?.activeOrganizationId && (
          <Link to="/app" onClick={onNavigate} className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-(--sb-text-2) hover:text-(--sb-text)">
            <ArrowLeft className="h-[18px] w-[18px]" /> Back to organization
          </Link>
        )}
      </nav>
      <SidebarUserCard context="platform" onNavigate={onNavigate} />
    </div>
  );
}

/** Completely separate shell for platform (Super Admin) administration. */
export function PlatformLayout() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="bg-app min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] shadow-2xl lg:block">
        <PlatformSidebar />
      </aside>
      <div className={clsx('fixed inset-0 z-40 lg:hidden', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
        <div className={clsx('absolute inset-0 bg-navy-950/50 backdrop-blur-sm transition-opacity', open ? 'opacity-100' : 'opacity-0')} onClick={() => setOpen(false)} />
        <aside className={clsx('absolute inset-y-0 left-0 w-[17.5rem] max-w-[85vw] transition-transform duration-300', open ? 'translate-x-0' : '-translate-x-full')}>
          <button className="absolute top-5 right-3 z-10 rounded-lg p-1.5 text-slate-500 dark:text-white/70" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
          <PlatformSidebar onNavigate={() => setOpen(false)} />
        </aside>
      </div>
      <div className="lg:pl-[17rem]">
        <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
            <button className="rounded-xl p-2 text-navy-800 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-6 w-6" />
            </button>
            <span className="lg:hidden"><Logo size="sm" /></span>
            <p className="hidden text-sm font-bold text-navy-900 lg:block">Platform administration</p>
            <div className="flex-1" />
            <span className="hidden rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 sm:inline">All organizations</span>
            <ThemeToggle className="hidden sm:inline-flex" />
            <NotificationsMenu context="platform" />
            <ProfileMenu context="platform" />
          </div>
        </header>
        <main className="w-full px-3 py-5 sm:px-4 lg:px-6 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
