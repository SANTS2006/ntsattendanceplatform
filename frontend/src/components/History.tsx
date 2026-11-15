import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArrowRightLeft, CircleDot, History as HistoryIcon, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { getPaged } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, EmptyState, Modal, Pagination } from '@/components/ui';
import { LogoSpinner } from '@/components/brand';
import { fmtDateTime, humanize } from '@/utils/format';

export type HistoryEntry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorType: string;
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
};

const statusLabel = (s: unknown) => humanize(String(s ?? '')).replace(/^\w/, (c) => c.toUpperCase());

/** Human-readable sentence and icon for an audit entry. */
export function describeEntry(e: HistoryEntry, perspective?: 'student'): { icon: ReactNode; text: ReactNode; tone: string } {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const [, verb = e.action] = e.action.split(/\.(.+)/);
  if (verb === 'status_changed' || (verb === 'archived' && m.statusTo)) {
    return {
      icon: <ArrowRightLeft className="h-4 w-4" />, tone: 'brand',
      text: (
        <>
          Status changed from <Badge>{statusLabel(m.statusFrom)}</Badge> to <Badge>{statusLabel(m.statusTo)}</Badge>
          {m.reason ? <span className="text-slate-600"> — “{String(m.reason)}”</span> : null}
        </>
      ),
    };
  }
  if (e.action === 'enrollment.created') {
    return perspective === 'student'
      ? { icon: <UserPlus className="h-4 w-4" />, tone: 'green', text: <>Enrolled in class <strong>{e.targetLabel ?? 'a class'}</strong></> }
      : { icon: <UserPlus className="h-4 w-4" />, tone: 'green', text: <>Enrolled {String(m.count ?? '')} student(s)</> };
  }
  if (e.action === 'enrollment.dropped') {
    return { icon: <UserMinus className="h-4 w-4" />, tone: 'rose', text: perspective === 'student' ? <>Removed from class <strong>{e.targetLabel ?? ''}</strong></> : <>A student was removed from the class</> };
  }
  if (e.action === 'event.participants_added') {
    return { icon: <UserPlus className="h-4 w-4" />, tone: 'green', text: perspective === 'student' ? <>Registered for event <strong>{e.targetLabel ?? ''}</strong></> : <>Registered {String(m.count ?? '')} participant(s)</> };
  }
  if (e.action === 'event.participant_removed') {
    return { icon: <UserMinus className="h-4 w-4" />, tone: 'rose', text: perspective === 'student' ? <>Removed from event <strong>{e.targetLabel ?? ''}</strong></> : <>A participant was removed</> };
  }
  if (e.action.endsWith('lecturer_assigned') || e.action.endsWith('manager_assigned')) return { icon: <UserPlus className="h-4 w-4" />, tone: 'green', text: <>Lecturer assigned</> };
  if (e.action.endsWith('lecturer_unassigned')) return { icon: <UserMinus className="h-4 w-4" />, tone: 'rose', text: <>Lecturer unassigned</> };
  if (verb === 'created') return { icon: <Plus className="h-4 w-4" />, tone: 'green', text: <>Created</> };
  if (verb === 'updated') {
    const fields = Array.isArray(m.fields) ? (m.fields as string[]).map((f) => humanize(f.replace(/([A-Z])/g, '_$1'))).join(', ') : '';
    return { icon: <Pencil className="h-4 w-4" />, tone: 'slate', text: <>Updated{fields ? <span className="text-slate-600"> — {fields}</span> : null}</> };
  }
  if (verb === 'archived') return { icon: <Archive className="h-4 w-4" />, tone: 'amber', text: <>Archived</> };
  if (verb === 'deleted') return { icon: <Trash2 className="h-4 w-4" />, tone: 'rose', text: <>Deleted</> };
  if (e.action === 'member.role_switched') return { icon: <ArrowRightLeft className="h-4 w-4" />, tone: 'brand', text: <>Switched role</> };
  return { icon: <CircleDot className="h-4 w-4" />, tone: 'slate', text: <>{humanize(e.action.replace(/\./g, ' · '))}</> };
}

const TONE: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-700', slate: 'bg-slate-100 text-slate-600',
};

export function HistoryList({ items, perspective, showTarget }: { items: HistoryEntry[]; perspective?: 'student'; showTarget?: boolean }) {
  const { org } = useAuth();
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
      {items.map((e) => {
        const d = describeEntry(e, perspective);
        return (
          <li key={e.id} className="relative">
            <span className={clsx('absolute top-0 -left-[33px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white', TONE[d.tone])}>{d.icon}</span>
            <div className="text-sm text-slate-800">
              {showTarget && e.targetLabel && <span className="mr-1 font-semibold text-navy-900">{e.targetLabel}:</span>}
              {d.text}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {fmtDateTime(e.createdAt, org?.timezone)} · {e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : e.actorType === 'SYSTEM' ? 'System' : e.actorType === 'PUBLIC' ? 'Student check-in' : 'Unknown'}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Paged timeline for one record. */
export function RecordHistory({ targetType, targetId, perspective }: { targetType: string; targetId: string; perspective?: 'student' }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['history', targetType, targetId, page],
    queryFn: () => getPaged<HistoryEntry>(`/history/${targetType}/${targetId}`, { page, pageSize: 15 }),
  });
  if (q.isLoading) return <div className="flex justify-center py-8"><LogoSpinner /></div>;
  if (q.error) return <p className="py-6 text-center text-sm text-slate-500">History is not available for this record.</p>;
  if (!q.data?.items.length) return <EmptyState icon={<HistoryIcon />} title="No history yet" description="Status changes and actions on this record will appear here." />;
  return (
    <>
      <div className="px-1 py-2"><HistoryList items={q.data.items} perspective={perspective} /></div>
      {q.data.meta.totalPages > 1 && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
    </>
  );
}

/** "History" button that opens the record's timeline. */
export function HistoryButton({ targetType, targetId, perspective, label = 'History' }: { targetType: string; targetId: string; perspective?: 'student'; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={<HistoryIcon className="h-4 w-4" />} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${humanize(targetType)} history`} size="lg">
        {open && <RecordHistory targetType={targetType} targetId={targetId} perspective={perspective} />}
      </Modal>
    </>
  );
}
