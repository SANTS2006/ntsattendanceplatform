import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, BellRing, Check, CheckCheck, ChevronDown, LogOut, Mail, Repeat, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';
import { errorMessage } from '@/api/client';
import { get, getPaged, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, useRoleLabel } from '@/components/UserCard';
import { Button, Modal } from '@/components/ui';
import { LogoSpinner } from '@/components/brand';
import { ThemeSegmented } from '@/theme/ThemeProvider';
import { InstallAppMenuItem } from '@/pwa/InstallButtons';
import type { AppNotification } from '@/types';
import { fmtDateTime } from '@/utils/format';

/** Closes a popover on outside click or Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

function Popover({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'animate-pop absolute top-full right-0 z-50 mt-2 origin-top-right overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_60px_-20px_rgb(11_31_77/0.35)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Profile ─────────────────────────────────────────────────────────────── */

export function ProfileMenu({ context = 'org' }: { context?: 'org' | 'platform' }) {
  const { me, org, logout, switchRole } = useAuth();
  const role = useRoleLabel(context);
  const nav = useNavigate();
  const membership = context === 'org' ? me?.organizations.find((o) => o.id === org?.id) : undefined;
  const options = membership?.roleOptions ?? [];
  const [switching, setSwitching] = useState<string | null>(null);
  const doSwitch = async (id: string) => {
    setSwitching(id);
    try {
      await switchRole(id);
      const r = options.find((o) => o.id === id);
      toast.success(`You are now acting as ${r?.name ?? 'the selected role'}`);
      close();
      nav('/app');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSwitching(null);
    }
  };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(ref, open, close);
  const base = context === 'platform' ? '/platform' : '/app';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-slate-100"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar size="sm" />
        <ChevronDown className={clsx('hidden h-4 w-4 text-slate-400 transition sm:block', open && 'rotate-180')} />
      </button>
      {open && (
        <Popover className="w-[min(18.5rem,calc(100vw-1.5rem))]">
          <div role="menu" aria-label="Account">
            <div className="bg-hero relative px-4 pt-4 pb-3 text-white">
              <div className="flex items-center gap-3">
                <Avatar size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{me?.user.firstName} {me?.user.lastName}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-white/75"><Mail className="h-3 w-3 shrink-0" /> <span className="truncate">{me?.user.email}</span></p>
                  <span className="mt-1.5 inline-block rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-100 ring-1 ring-white/20">{role}</span>
                </div>
              </div>
            </div>
            <div className="p-2">
              <Link to={`${base}/account`} role="menuitem" onClick={close} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700">
                <UserCog className="h-[18px] w-[18px]" /> Profile settings
              </Link>
              <InstallAppMenuItem onDone={close} />
              {options.length > 1 && (
                <div className="mt-1 border-t border-slate-100 px-1 pt-2">
                  <p className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase"><Repeat className="h-3.5 w-3.5" /> Switch role</p>
                  {options.map((o) => {
                    const isActive = o.id === membership?.activeRole;
                    return (
                      <button
                        key={o.id}
                        role="menuitemradio"
                        aria-checked={isActive}
                        disabled={isActive || !!switching}
                        onClick={() => void doSwitch(o.id)}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0 flex-1 truncate">{o.name}{o.department ? <span className="font-normal text-slate-500"> · {o.department}</span> : null}</span>
                        {isActive ? <Check className="h-4 w-4 text-brand-600" /> : switching === o.id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="px-3 py-2">
                <p className="mb-1.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">Appearance</p>
                <ThemeSegmented />
              </div>
              <button
                role="menuitem"
                onClick={() => { close(); logout(); }}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
              >
                <LogOut className="h-[18px] w-[18px]" /> Log out
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ── Notifications ───────────────────────────────────────────────────────── */

export function useUnreadCount() {
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => getPaged<AppNotification>('/notifications', { pageSize: 1, unread: 'true' }),
    refetchInterval: 60_000,
  });
  return (q.data?.meta as unknown as { unread?: number })?.unread ?? 0;
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
}

export function NotificationItem({ n, onClick, compact }: { n: AppNotification; onClick: () => void; compact?: boolean }) {
  return (
    <button onClick={onClick} className={clsx('flex w-full gap-3 text-left transition hover:bg-slate-50', compact ? 'px-4 py-3' : 'px-5 py-4')}>
      <span className={clsx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', n.readAt ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-600')}>
        {n.readAt ? <Bell className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-sm', n.readAt ? 'font-medium text-slate-600' : 'font-bold text-navy-900')}>{n.title}</span>
        <span className={clsx('block text-sm text-slate-500', compact && 'truncate')}>{n.body}</span>
        <span className="mt-0.5 block text-xs text-slate-400">{fmtDateTime(n.createdAt)}</span>
      </span>
      {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
    </button>
  );
}

/** Detail view; opening it marks the notification read (server side). */
export function NotificationDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ['notifications', 'one', id],
    queryFn: () => get<AppNotification>(`/notifications/${id}`),
    enabled: !!id,
  });
  useEffect(() => {
    if (q.isSuccess) qc.invalidateQueries({ queryKey: ['notifications'], predicate: (k) => k.queryKey[1] !== 'one' });
  }, [q.isSuccess, qc]);
  const n = q.data;
  const link = typeof n?.data?.link === 'string' && n.data.link.startsWith('/') ? n.data.link : null;
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title="Notification"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {link && <Button onClick={() => { onClose(); nav(link); }}>Open <ArrowRight className="h-4 w-4" /></Button>}
        </>
      }
    >
      {q.isLoading ? (
        <div className="flex justify-center py-8"><LogoSpinner /></div>
      ) : n ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-brand text-white"><BellRing className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-base font-bold text-navy-900">{n.title}</p>
              <p className="text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p>
            </div>
          </div>
          <p className="rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed whitespace-pre-line text-slate-700">{n.body}</p>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-slate-500">This notification is no longer available.</p>
      )}
    </Modal>
  );
}

export function NotificationsMenu({ context = 'org' }: { context?: 'org' | 'platform' }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(ref, open, close);
  const unread = useUnreadCount();
  const readAll = useMarkAllRead();
  const list = useQuery({
    queryKey: ['notifications', 'menu'],
    queryFn: () => getPaged<AppNotification>('/notifications', { pageSize: 6 }),
    enabled: open,
  });
  const base = context === 'platform' ? '/platform' : '/app';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx('relative rounded-xl p-2.5 transition', open ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700')}
        aria-label={`Notifications (${unread} unread)`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-pink-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <Popover className="w-[min(23rem,calc(100vw-1.5rem))] max-sm:fixed max-sm:top-16 max-sm:right-3">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-extrabold text-navy-900">Notifications</p>
            {unread > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{unread} new</span>}
          </div>
          <div className="max-h-[min(24rem,60vh)] divide-y divide-slate-100 overflow-y-auto">
            {list.isLoading ? (
              <div className="flex justify-center py-8"><LogoSpinner size="sm" /></div>
            ) : list.data?.items.length ? (
              list.data.items.map((n) => <NotificationItem key={n.id} n={n} compact onClick={() => { setDetail(n.id); close(); }} />)
            ) : (
              <div className="px-4 py-10 text-center">
                <CheckCheck className="mx-auto h-8 w-8 text-check" />
                <p className="mt-2 text-sm font-semibold text-slate-700">You’re all caught up</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-2.5">
            <button
              onClick={() => readAll.mutate()}
              disabled={!unread || readAll.isPending}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-brand-700 disabled:opacity-40"
            >
              <CheckCheck className="h-4 w-4" /> Mark all as read
            </button>
            <Link to={`${base}/notifications`} onClick={close} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-white">
              View all notifications <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Popover>
      )}
      <NotificationDetailModal id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
