import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import {
  BarChart3, BookOpen, Plus, Headset, History, Lightbulb, Building2, CalendarDays, ChevronDown, ClipboardCheck, GraduationCap, LayoutDashboard, Menu, QrCode, Settings,
  Shield, UserCog, Users, X,
} from 'lucide-react';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Logo } from '@/components/brand';
import { SidebarUserCard } from '@/components/UserCard';
import { NotificationsMenu, ProfileMenu } from '@/components/HeaderMenus';
import { ThemeToggle } from '@/theme/ThemeProvider';
import { useSupportUnread } from '@/features/support/SupportPages';

type NavItem = { to: string; label: string; icon: ReactNode; any?: string[]; end?: boolean; ownerOrAdmin?: boolean; badge?: 'support' };

type NavGroup = { title: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { title: 'Workspace', items: [{ to: '/app', label: 'Overview', icon: <LayoutDashboard />, end: true }] },
  {
    title: 'Attendance',
    items: [
      { to: '/app/attendance', label: 'Sessions & QR', icon: <QrCode />, any: ['attendance.sessions.create', 'attendance.sessions.manage_all', 'attendance.read_all', 'attendance.read_assigned'] },
      { to: '/app/records', label: 'Records', icon: <ClipboardCheck />, any: ['attendance.read_all', 'attendance.read_assigned'] },
      { to: '/app/reports', label: 'Reports', icon: <BarChart3 />, any: ['reports.read'] },
    ],
  },
  {
    title: 'People & academics',
    items: [
      { to: '/app/students', label: 'Students', icon: <GraduationCap />, any: ['students.read'] },
      { to: '/app/classes', label: 'Classes', icon: <BookOpen />, any: ['academics.read', 'attendance.sessions.create'] },
      { to: '/app/lecturers', label: 'Lecturers', icon: <UserCog />, any: ['lecturers.read'] },
      { to: '/app/events', label: 'Events', icon: <CalendarDays />, any: ['events.read'] },
      { to: '/app/academics', label: 'Academic structure', icon: <Users />, any: ['academics.manage'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/app/history', label: 'History', icon: <History />, any: ['audit.read'] },
      { to: '/app/settings', label: 'Settings', icon: <Settings />, any: ['organization.manage', 'settings.manage', 'members.read', 'roles.manage', 'audit.read'] },
    ],
  },
  {
    title: 'Help & support',
    items: [
      { to: '/app/support', label: 'Contact support', icon: <Headset />, ownerOrAdmin: true, badge: 'support' },
      { to: '/app/feedback', label: 'Give feedback', icon: <Lightbulb />, ownerOrAdmin: true },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, me, org, switchOrganization } = useAuth();
  const nav = useNavigate();
  const owned = me?.organizations.filter((o) => o.isOwner) ?? [];
  const memberOf = me?.organizations.filter((o) => !o.isOwner) ?? [];
  const isAdmin = !!org && (org.isOwner || can('organization.manage'));
  const supportUnread = useSupportUnread(isAdmin);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => (n.ownerOrAdmin ? isAdmin : !n.any || n.any.some(can))) })).filter((g) => g.items.length);
  return (
    <div className="bg-sidebar flex h-full flex-col text-white">
      <div className="flex h-[4.5rem] items-center px-5">
        <Link to="/app" onClick={onNavigate} aria-label="NTSAttend home">
          <Logo light />
        </Link>
      </div>

      {org && (
        <div className="px-4 pb-4">
          {me && me.organizations.length > 1 ? (
            <div className="relative">
              <Building2 className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-cyan-200" />
              <label className="sr-only" htmlFor="org-switch">Organization</label>
              <select
                id="org-switch"
                className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.07] py-2.5 pr-8 pl-9 text-xs font-semibold text-white outline-none focus:ring-2 focus:ring-cyan-400/40"
                value={org.id}
                onChange={(e) => {
                  if (e.target.value === '__new') { onNavigate?.(); nav('/onboarding'); return; }
                  switchOrganization(e.target.value).then(() => toast.success('Organization switched'), (err) => toast.error(errorMessage(err)));
                }}
              >
                {owned.length > 0 && (
                  <optgroup label="Your organizations" className="text-slate-900">
                    {owned.map((o) => <option key={o.id} value={o.id} className="text-slate-900">{o.name}</option>)}
                  </optgroup>
                )}
                {memberOf.length > 0 && (
                  <optgroup label="Organizations you work in" className="text-slate-900">
                    {memberOf.map((o) => <option key={o.id} value={o.id} className="text-slate-900">{o.name}</option>)}
                  </optgroup>
                )}
                <option value="__new" className="text-slate-900">+ Create your own organization…</option>
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-white/50" />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-xs font-semibold">
              <Building2 className="h-4 w-4 shrink-0 text-cyan-200" />
              <span className="truncate">{org.name}</span>
            </div>
          )}
          {me && owned.length === 0 && (
            // Members (e.g. lecturers added by an institution) can open their own organization space
            // with the same account; it is separate from the organizations they work in.
            <Link to="/onboarding" onClick={onNavigate} className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-cyan-100/80 transition hover:bg-white/[0.06] hover:text-white">
              <Plus className="h-3.5 w-3.5" /> Create your own organization
            </Link>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-5 scroll-dark overflow-y-auto px-3 pb-4" aria-label="Main">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-[10px] font-bold tracking-[0.14em] text-white/40 uppercase">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all',
                      isActive ? 'bg-white/[0.12] text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]' : 'text-white/65 hover:bg-white/[0.06] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-gradient-to-b from-cyan-300 to-check shadow-[0_0_12px_rgb(14_165_233/0.8)]" />}
                      <span
                        className={clsx(
                          'flex h-8 w-8 items-center justify-center rounded-lg transition [&>svg]:h-[18px] [&>svg]:w-[18px]',
                          isActive ? 'bg-gradient-to-br from-brand-500 to-cyan-brand text-white shadow-lg' : 'bg-white/[0.05] text-white/70 group-hover:text-white',
                        )}
                      >
                        {n.icon}
                      </span>
                      {n.label}
                      {n.badge === 'support' && supportUnread > 0 && (
                        <span className="ml-auto rounded-full bg-gradient-to-r from-rose-500 to-pink-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{supportUnread}</span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        {me?.platformRole && (
          <NavLink to="/platform" onClick={onNavigate} className="mx-0 flex items-center gap-3 rounded-xl border border-violet-300/20 bg-violet-500/10 px-3 py-2.5 text-sm font-semibold text-violet-100 hover:bg-violet-500/20">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/30"><Shield className="h-[18px] w-[18px]" /></span>
            Platform admin
          </NavLink>
        )}
      </nav>

      <SidebarUserCard onNavigate={onNavigate} />
    </div>
  );
}

export function AppLayout() {
  const { me, org } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="bg-app min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] shadow-2xl shadow-navy-900/20 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <div className={clsx('fixed inset-0 z-40 lg:hidden', mobileOpen ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!mobileOpen}>
        <div className={clsx('absolute inset-0 bg-navy-950/50 backdrop-blur-sm transition-opacity duration-300', mobileOpen ? 'opacity-100' : 'opacity-0')} onClick={() => setMobileOpen(false)} />
        <aside className={clsx('absolute inset-y-0 left-0 w-[17.5rem] max-w-[85vw] shadow-2xl transition-transform duration-300 ease-out', mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
          <button className="absolute top-5 right-3 z-10 rounded-lg p-1.5 text-white/70 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </aside>
      </div>

      <div className="lg:pl-[17rem]">
        <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
            <button className="rounded-xl p-2 text-navy-800 transition hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen}>
              <Menu className="h-6 w-6" />
            </button>
            <Link to="/app" className="lg:hidden" aria-label="NTSAttend home">
              <Logo size="sm" />
            </Link>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-sm font-bold text-navy-900">
                {greeting}, {me?.user.firstName} <span aria-hidden>👋</span>
              </p>
              <p className="text-xs text-slate-500">{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: org?.timezone }).format(new Date())}</p>
            </div>
            <div className="flex-1" />
            {org && (
              <span className="hidden max-w-56 items-center gap-1.5 truncate rounded-full border border-brand-100 bg-brand-50/70 px-3 py-1.5 text-xs font-semibold text-brand-800 md:inline-flex">
                <Building2 className="h-3.5 w-3.5" /> {org.name}
              </span>
            )}
            <ThemeToggle className="hidden sm:inline-flex" />
            <NotificationsMenu />
            <ProfileMenu />
          </div>
        </header>
        {/* Full-bleed pages use the whole width with a small gutter; the rest stay at a readable max width. */}
        {/* Every page uses the full width of the content area, with small padding. */}
        <main className="w-full px-3 py-5 sm:px-4 lg:px-6 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
