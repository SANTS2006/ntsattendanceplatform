import clsx from 'clsx';
import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { displayName, initials } from '@/utils/format';

/** Human-readable role of the signed-in user in the active organization. */
export function useRoleLabel(context: 'org' | 'platform' = 'org') {
  const { me, org } = useAuth();
  if (context === 'platform') return me?.platformRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Platform Admin';
  const m = me?.organizations.find((o) => o.id === org?.id);
  if (!m) return me?.platformRole ? 'Platform admin' : 'Member';
  const active = m.roleOptions?.find((r) => r.id === m.activeRole);
  if (active) return `${active.name}${active.department ? ` · ${active.department}` : ''}`;
  if (m.isOwner) return 'Owner';
  return (m.roles ?? []).map((r) => r.name).join(' · ') || (m.isLecturer ? 'Lecturer' : 'Member');
}

export function Avatar({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { me } = useAuth();
  const dim = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm';
  if (me?.user.avatarUrl) {
    return <img src={me.user.avatarUrl} alt="" referrerPolicy="no-referrer" className={clsx(dim, 'shrink-0 rounded-full object-cover ring-2 ring-white/70', className)} />;
  }
  return (
    <span className={clsx(dim, 'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 via-cyan-brand to-check font-bold text-white ring-2 ring-white/40', className)}>
      {initials(me?.user.firstName, me?.user.lastName)}
    </span>
  );
}

/** Profile block shown at the bottom of the sidebar (desktop and mobile drawer). */
export function SidebarUserCard({ context = 'org', onNavigate }: { context?: 'org' | 'platform'; onNavigate?: () => void }) {
  const { me, logout } = useAuth();
  const role = useRoleLabel(context);
  return (
    <div className="m-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <Link to={context === 'platform' ? '/platform/account' : '/app/account'} onClick={onNavigate} className="shrink-0" aria-label="Account settings">
          <Avatar />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">
            {displayName(me?.user.firstName, me?.user.lastName)}
          </p>
          <p className="truncate text-xs font-medium text-cyan-200/90">{role}</p>
        </div>
        <button
          onClick={() => logout()}
          className="rounded-xl p-2 text-white/60 transition hover:bg-rose-500/20 hover:text-rose-200"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}
