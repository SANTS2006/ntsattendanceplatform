import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Building2, CheckCircle2, Headset, Inbox, Lightbulb, MessageSquarePlus, Send, Star } from 'lucide-react';
import { errorMessage, get, getPaged, patch, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { LogoSpinner } from '@/components/brand';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Pagination, SearchInput, Select, Textarea, Input, BackButton } from '@/components/ui';
import { fmtDateTime, humanize, initials } from '@/utils/format';

/* ── Types ─────────────────────────────────────────────────────────────── */

type Person = { id: string; firstName: string; lastName: string; email: string } | null;
type TicketStatus = 'OPEN' | 'AWAITING_ORGANIZATION' | 'RESOLVED' | 'CLOSED';
type Ticket = {
  id: string; subject: string; category: string; priority: string; status: TicketStatus; lastMessageAt: string; createdAt: string;
  orgUnread: boolean; platformUnread: boolean; organization?: { id: string; name: string } | null; _count?: { messages: number };
};
type Message = { id: string; body: string; fromPlatform: boolean; createdAt: string; author: Person };
type TicketDetail = Ticket & { createdBy: Person; messages: Message[] };
type Feedback = {
  id: string; category: string; rating: number | null; message: string; status: string; adminNote: string | null; createdAt: string;
  organization?: { id: string; name: string } | null; user?: Person;
};

const CATEGORIES = ['GENERAL', 'TECHNICAL', 'ACCOUNT', 'BILLING', 'FEATURE_REQUEST'].map((v) => ({ value: v, label: humanize(v) }));
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((v) => ({ value: v, label: humanize(v) }));
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', AWAITING_ORGANIZATION: 'Awaiting reply', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const STATUS_TONE: Record<TicketStatus, string> = { OPEN: 'blue', AWAITING_ORGANIZATION: 'amber', RESOLVED: 'green', CLOSED: 'slate' };
const FB_CATEGORIES = [
  { value: 'IMPROVEMENT', label: 'Improvement idea' }, { value: 'FEATURE', label: 'New feature' }, { value: 'BUG', label: 'Something is broken' },
  { value: 'PRAISE', label: 'Something I like' }, { value: 'OTHER', label: 'Other' },
];
const FB_STATUS_TONE: Record<string, string> = { NEW: 'blue', REVIEWED: 'slate', PLANNED: 'amber', DONE: 'green' };

const StatusBadge = ({ s }: { s: TicketStatus }) => <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>;

/* ── Shared conversation view ─────────────────────────────────────────── */

const replySchema = z.object({ body: z.string().trim().min(2, 'Write your message').max(5000, 'Messages must be at most 5,000 characters') });

function Thread({ ticket, side, onReply, onClose, extra }: {
  ticket: TicketDetail;
  side: 'org' | 'platform';
  onReply: (body: string) => Promise<unknown>;
  onClose?: () => void;
  extra?: React.ReactNode;
}) {
  const form = useForm<z.infer<typeof replySchema>>({ resolver: zodResolver(replySchema), defaultValues: { body: '' } });
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [ticket.messages.length]);
  const closed = ticket.status === 'CLOSED';
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold break-words text-navy-900">{ticket.subject}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              {side === 'platform' && ticket.organization && <span className="inline-flex items-center gap-1 font-semibold text-brand-700"><Building2 className="h-3.5 w-3.5" />{ticket.organization.name}</span>}
              <span>{humanize(ticket.category)}</span>·<span>{humanize(ticket.priority)} priority</span>·<span>Opened {fmtDateTime(ticket.createdAt)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge s={ticket.status} />
            {onClose && !closed && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
          </div>
        </div>
        {extra}
      </div>
      <div className="max-h-[55vh] min-h-48 space-y-4 overflow-y-auto bg-slate-50/50 px-4 py-5 sm:px-6">
        {ticket.messages.map((m) => {
          const mine = side === 'platform' ? m.fromPlatform : !m.fromPlatform;
          return (
            <div key={m.id} className={clsx('flex gap-2.5', mine && 'flex-row-reverse')}>
              <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', m.fromPlatform ? 'bg-gradient-to-br from-violet-500 to-brand-600' : 'bg-gradient-to-br from-brand-500 to-cyan-brand')}>
                {m.fromPlatform ? <Headset className="h-4 w-4" /> : initials(m.author?.firstName, m.author?.lastName)}
              </span>
              <div className={clsx('max-w-[85%] sm:max-w-[75%]', mine && 'text-right')}>
                <p className="mb-1 text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-600">{m.fromPlatform ? 'NTSAttend team' : `${m.author?.firstName ?? ''} ${m.author?.lastName ?? ''}`.trim() || 'Organization'}</span> · {fmtDateTime(m.createdAt)}
                </p>
                <div className={clsx('inline-block rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed whitespace-pre-wrap break-words', mine ? 'rounded-tr-md bg-gradient-to-br from-brand-600 to-cyan-brand text-white' : 'rounded-tl-md border border-slate-200 bg-white text-slate-700')}>
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {closed ? (
        <p className="border-t border-slate-100 px-6 py-4 text-center text-sm text-slate-500">This conversation is closed.{side === 'org' && ' Start a new request if you need more help.'}</p>
      ) : (
        <form
          noValidate
          className="border-t border-slate-100 p-4 sm:px-6"
          onSubmit={form.handleSubmit(async (v) => {
            try { await onReply(v.body); form.reset(); } catch (e) { toast.error(errorMessage(e)); }
          })}
        >
          <Textarea aria-label="Reply" placeholder="Enter your reply" rows={3} error={form.formState.errors.body?.message} {...form.register('body')} />
          <div className="mt-2 flex justify-end">
            <Button type="submit" loading={form.formState.isSubmitting} icon={<Send className="h-4 w-4" />}>Send reply</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function TicketRow({ t, active, onClick, side }: { t: Ticket; active: boolean; onClick: () => void; side: 'org' | 'platform' }) {
  const unread = side === 'org' ? t.orgUnread : t.platformUnread;
  return (
    <button onClick={onClick} className={clsx('flex w-full gap-3 px-4 py-3.5 text-left transition', active ? 'bg-brand-50/70' : 'hover:bg-slate-50')}>
      <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', unread ? 'bg-brand-500' : 'bg-transparent')} aria-label={unread ? 'Unread' : undefined} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={clsx('truncate text-sm', unread ? 'font-bold text-navy-900' : 'font-semibold text-slate-700')}>{t.subject}</span>
          <span className="shrink-0 text-[11px] text-slate-400">{fmtDateTime(t.lastMessageAt)}</span>
        </span>
        {side === 'platform' && t.organization && <span className="block truncate text-xs font-medium text-brand-700">{t.organization.name}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge s={t.status} />
          {(t.priority === 'HIGH' || t.priority === 'URGENT') && <Badge tone="rose">{humanize(t.priority)}</Badge>}
          <span className="text-[11px] text-slate-400">{t._count?.messages ?? 0} message{t._count?.messages === 1 ? '' : 's'}</span>
        </span>
      </span>
    </button>
  );
}

/** Two-pane inbox: list on the left, conversation on the right (stacked on phones). */
function Inbox2({ list, selected, onSelect, detail, empty, page }: {
  list: Ticket[] | undefined; selected: string | null; onSelect: (id: string | null) => void;
  detail: React.ReactNode; empty: React.ReactNode; page?: React.ReactNode;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="grid min-h-[28rem] lg:grid-cols-[22rem_1fr]">
        <div className={clsx('border-slate-100 lg:border-r', selected && 'hidden lg:block')}>
          {list === undefined ? (
            <div className="flex justify-center py-16"><LogoSpinner /></div>
          ) : list.length ? (
            <>
              <div className="divide-y divide-slate-100">{list.map((t) => <TicketRow key={t.id} t={t} active={t.id === selected} onClick={() => onSelect(t.id)} side={t.organization !== undefined ? 'platform' : 'org'} />)}</div>
              {page}
            </>
          ) : (
            empty
          )}
        </div>
        <div className={clsx('min-w-0', !selected && 'hidden lg:block')}>
          {selected ? (
            <>
              <div className="px-4 pt-3 lg:hidden"><BackButton onClick={() => onSelect(null)} label="Back to all conversations" /></div>
              {detail}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-10 text-center text-slate-400">
              <Inbox className="h-10 w-10" />
              <p className="mt-2 text-sm">Select a conversation to read it.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function useSelected() {
  const [sp, setSp] = useSearchParams();
  const selected = sp.get('ticket');
  const select = (id: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('ticket', id); else n.delete('ticket'); return n; });
  return [selected, select] as const;
}

/* ── Organization: support ────────────────────────────────────────────── */

const ticketSchema = z.object({
  subject: z.string().trim().min(3, 'Enter your subject (at least 3 characters)').max(150, 'Subject must be at most 150 characters'),
  category: z.string().min(1, 'Select your category'),
  priority: z.string().min(1, 'Select your priority'),
  message: z.string().trim().min(10, 'Describe your request (at least 10 characters)').max(5000, 'Messages must be at most 5,000 characters'),
});

export function SupportPage() {
  const qc = useQueryClient();
  const [selected, select] = useSelected();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['support', 'tickets', page], queryFn: () => getPaged<Ticket>('/support/tickets', { page, pageSize: 20 }), refetchInterval: 60_000 });
  const detail = useQuery({ queryKey: ['support', 'ticket', selected], queryFn: () => get<TicketDetail>(`/support/tickets/${selected}`), enabled: !!selected });
  useEffect(() => { if (detail.isSuccess) qc.invalidateQueries({ queryKey: ['support', 'tickets'] }); }, [detail.isSuccess, detail.dataUpdatedAt, qc]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['support'] }); };
  const form = useForm<z.infer<typeof ticketSchema>>({ resolver: zodResolver(ticketSchema), defaultValues: { subject: '', category: 'GENERAL', priority: 'NORMAL', message: '' } });
  const fe = form.formState.errors;

  return (
    <div>
      <PageHeader
        title="Help & support"
        description="Talk to the NTSAttend team. Replies arrive here, in your notifications and by email."
        actions={<Button icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New request</Button>}
      />
      <Inbox2
        list={list.data?.items}
        selected={selected}
        onSelect={select}
        page={list.data && list.data.meta.totalPages > 1 ? <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} /> : undefined}
        empty={<EmptyState icon={<Headset />} title="No conversations yet" description="Questions, problems or account requests — we’re here to help." action={<Button onClick={() => setCreating(true)}>Contact the team</Button>} />}
        detail={
          detail.data ? (
            <Thread
              ticket={detail.data}
              side="org"
              onReply={async (body) => { await post(`/support/tickets/${selected}/messages`, { body }); refresh(); }}
              onClose={async () => { try { await post(`/support/tickets/${selected}/close`); toast.success('Conversation closed'); refresh(); } catch (e) { toast.error(errorMessage(e)); } }}
            />
          ) : (
            <div className="flex justify-center py-16"><LogoSpinner /></div>
          )
        }
      />
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Contact the NTSAttend team"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              loading={form.formState.isSubmitting}
              icon={<Send className="h-4 w-4" />}
              onClick={form.handleSubmit(async (v) => {
                try {
                  const t = await post<{ id: string }>('/support/tickets', v);
                  toast.success('Message sent to the NTSAttend team');
                  form.reset();
                  setCreating(false);
                  refresh();
                  select(t.id);
                } catch (e) { toast.error(errorMessage(e)); }
              })}
            >
              Send request
            </Button>
          </>
        }
      >
        <form noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Subject *" maxLength={150} error={fe.subject?.message} {...form.register('subject')} /></div>
          <Select label="Category *" options={CATEGORIES} error={fe.category?.message} {...form.register('category')} />
          <Select label="Priority *" options={PRIORITIES} error={fe.priority?.message} {...form.register('priority')} />
          <div className="sm:col-span-2"><Textarea label="Message *" rows={6} maxLength={5000} placeholder="Enter your message — include steps, screenshots links or session names that help us understand" error={fe.message?.message} {...form.register('message')} /></div>
        </form>
      </Modal>
    </div>
  );
}

/* ── Organization: feedback ───────────────────────────────────────────── */

const feedbackSchema = z.object({
  category: z.string().min(1, 'Select your feedback type'),
  rating: z.number().int().min(1).max(5).nullable(),
  message: z.string().trim().min(5, 'Tell us a little more (at least 5 characters)').max(5000, 'Feedback must be at most 5,000 characters'),
});

function Stars({ value, onChange, size = 'md' }: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'md' }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="flex items-center gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Rating" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={clsx(size === 'sm' ? 'h-4 w-4' : 'h-7 w-7', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => onChange(value === n ? null : n)} className="rounded-lg p-0.5 transition hover:scale-110">
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}

export function FeedbackPage() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ['feedback', 'mine'], queryFn: () => get<Feedback[]>('/feedback') });
  const form = useForm<z.infer<typeof feedbackSchema>>({ resolver: zodResolver(feedbackSchema), defaultValues: { category: 'IMPROVEMENT', rating: null, message: '' } });
  const fe = form.formState.errors;
  const rating = form.watch('rating');
  return (
    <div>
      <PageHeader title="Feedback" description="Tell us what works, what doesn’t and what you’d like next. Every message is read by the NTSAttend team." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card title="Share feedback" icon={<Lightbulb className="h-5 w-5" />}>
          <form
            noValidate
            className="space-y-4"
            onSubmit={form.handleSubmit(async (v) => {
              try {
                await post('/feedback', { ...v, rating: v.rating ?? null });
                toast.success('Thank you for your feedback');
                form.reset();
                qc.invalidateQueries({ queryKey: ['feedback'] });
              } catch (e) { toast.error(errorMessage(e)); }
            })}
          >
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">How would you rate NTSAttend overall? <span className="font-normal text-slate-400">(optional)</span></p>
              <Stars value={rating} onChange={(v) => form.setValue('rating', v, { shouldDirty: true })} />
            </div>
            <Select label="Type of feedback *" options={FB_CATEGORIES} error={fe.category?.message} {...form.register('category')} />
            <Textarea label="Your feedback *" rows={6} maxLength={5000} error={fe.message?.message} {...form.register('message')} />
            <div className="flex justify-end"><Button type="submit" loading={form.formState.isSubmitting} icon={<Send className="h-4 w-4" />}>Send feedback</Button></div>
          </form>
        </Card>
        <Card title="Your organization’s feedback" padded={false}>
          {mine.isLoading ? (
            <div className="flex justify-center py-12"><LogoSpinner /></div>
          ) : mine.data?.length ? (
            <ul className="max-h-[34rem] divide-y divide-slate-100 overflow-y-auto">
              {mine.data.map((f) => (
                <li key={f.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-navy-900">{FB_CATEGORIES.find((c) => c.value === f.category)?.label ?? humanize(f.category)} {f.rating && <Stars value={f.rating} size="sm" />}</span>
                    <Badge tone={FB_STATUS_TONE[f.status]}>{humanize(f.status)}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap text-slate-600">{f.message}</p>
                  {f.adminNote && <p className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-800"><strong>NTSAttend team:</strong> {f.adminNote}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">{fmtDateTime(f.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Lightbulb />} title="No feedback yet" description="Your ideas shape what we build next." />
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Platform: support inbox ──────────────────────────────────────────── */

export function PlatformSupportPage() {
  const qc = useQueryClient();
  const [selected, select] = useSelected();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['platform-support', 'list', status, search, page],
    queryFn: () => getPaged<Ticket>('/platform/support/tickets', { status: status || undefined, search: search || undefined, page, pageSize: 20 }),
    refetchInterval: 30_000,
  });
  const meta = list.data?.meta as unknown as { unread?: number; open?: number } | undefined;
  const detail = useQuery({ queryKey: ['platform-support', 'ticket', selected], queryFn: () => get<TicketDetail>(`/platform/support/tickets/${selected}`), enabled: !!selected });
  useEffect(() => { if (detail.isSuccess) qc.invalidateQueries({ queryKey: ['platform-support', 'list'] }); }, [detail.isSuccess, detail.dataUpdatedAt, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform-support'] });
  const [nextStatus, setNextStatus] = useState<TicketStatus>('AWAITING_ORGANIZATION');
  const update = useMutation({
    mutationFn: (v: { status?: string; priority?: string }) => patch(`/platform/support/tickets/${selected}`, v),
    onSuccess: () => { toast.success('Conversation updated'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader title="Support inbox" description={`${meta?.open ?? 0} open · ${meta?.unread ?? 0} waiting for a reply from the team`} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search subject or organization…" />
        <div className="sm:w-56">
          <Select aria-label="Status" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} placeholder="All statuses" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
        </div>
      </div>
      <Inbox2
        list={list.data?.items}
        selected={selected}
        onSelect={select}
        page={list.data && list.data.meta.totalPages > 1 ? <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} /> : undefined}
        empty={<EmptyState icon={<Inbox />} title="Inbox zero" description="No support conversations match these filters." />}
        detail={
          detail.data ? (
            <Thread
              ticket={detail.data}
              side="platform"
              onReply={async (body) => { await post(`/platform/support/tickets/${selected}/messages`, { body, status: nextStatus }); toast.success('Reply sent — the organization was emailed'); refresh(); }}
              extra={
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Select aria-label="Status" options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} value={detail.data.status} onChange={(e) => update.mutate({ status: e.target.value })} />
                  <Select aria-label="Priority" options={PRIORITIES} value={detail.data.priority} onChange={(e) => update.mutate({ priority: e.target.value })} />
                  <Select aria-label="Status after reply" options={[{ value: 'AWAITING_ORGANIZATION', label: 'After reply: awaiting org' }, { value: 'RESOLVED', label: 'After reply: resolved' }, { value: 'OPEN', label: 'After reply: keep open' }]} value={nextStatus} onChange={(e) => setNextStatus(e.target.value as TicketStatus)} />
                  {detail.data.createdBy && <p className="text-xs text-slate-500 sm:col-span-3">Started by {detail.data.createdBy.firstName} {detail.data.createdBy.lastName} · {detail.data.createdBy.email}</p>}
                </div>
              }
            />
          ) : (
            <div className="flex justify-center py-16"><LogoSpinner /></div>
          )
        }
      />
    </div>
  );
}

/* ── Platform: feedback ───────────────────────────────────────────────── */

export function PlatformFeedbackPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Feedback | null>(null);
  const [note, setNote] = useState('');
  const [nextStatus, setNextStatus] = useState('REVIEWED');
  const list = useQuery({
    queryKey: ['platform-feedback', status, category, page],
    queryFn: () => getPaged<Feedback>('/platform/feedback', { status: status || undefined, category: category || undefined, page, pageSize: 20 }),
  });
  const summary = (list.data?.meta as unknown as { summary?: { averageRating: number | null; ratings: number; new: number } })?.summary;
  const save = useMutation({
    mutationFn: () => patch(`/platform/feedback/${editing!.id}`, { status: nextStatus, adminNote: note.trim() || null }),
    onSuccess: () => { toast.success('Feedback updated — the organization was notified'); setEditing(null); qc.invalidateQueries({ queryKey: ['platform-feedback'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Feedback" description="What organizations think of NTSAttend." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><p className="text-xs font-bold tracking-wider text-slate-400 uppercase">Average rating</p><p className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-navy-900">{summary?.averageRating ?? '—'} <Star className="h-6 w-6 fill-amber-400 text-amber-400" /></p></Card>
        <Card><p className="text-xs font-bold tracking-wider text-slate-400 uppercase">Ratings</p><p className="mt-1 text-3xl font-extrabold text-navy-900">{summary?.ratings ?? 0}</p></Card>
        <Card><p className="text-xs font-bold tracking-wider text-slate-400 uppercase">New</p><p className="mt-1 text-3xl font-extrabold text-brand-700">{summary?.new ?? 0}</p></Card>
      </div>
      <Card padded={false}>
        <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:w-1/2">
          <Select aria-label="Status" options={['NEW', 'REVIEWED', 'PLANNED', 'DONE'].map((v) => ({ value: v, label: humanize(v) }))} placeholder="All statuses" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} />
          <Select aria-label="Type" options={FB_CATEGORIES} placeholder="All types" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} />
        </div>
        {list.isLoading ? (
          <div className="flex justify-center py-12"><LogoSpinner /></div>
        ) : list.data?.items.length ? (
          <ul className="divide-y divide-slate-100">
            {list.data.items.map((f) => (
              <li key={f.id}>
                <button className="w-full px-5 py-4 text-left transition hover:bg-slate-50" onClick={() => { setEditing(f); setNote(f.adminNote ?? ''); setNextStatus(f.status === 'NEW' ? 'REVIEWED' : f.status); }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
                      <Building2 className="h-4 w-4 text-brand-600" /> {f.organization?.name ?? 'Organization'}
                      <span className="font-normal text-slate-400">· {FB_CATEGORIES.find((c) => c.value === f.category)?.label}</span>
                      {f.rating && <Stars value={f.rating} size="sm" />}
                    </span>
                    <Badge tone={FB_STATUS_TONE[f.status]}>{humanize(f.status)}</Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-wrap text-slate-600">{f.message}</p>
                  <p className="mt-1 text-xs text-slate-400">{f.user ? `${f.user.firstName} ${f.user.lastName} · ` : ''}{fmtDateTime(f.createdAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Lightbulb />} title="No feedback" description="Nothing matches these filters yet." />
        )}
        {list.data && list.data.meta.totalPages > 1 && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Feedback"
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => (note.length > 1000 ? toast.error('Note must be at most 1,000 characters') : save.mutate())}>Save</Button></>}
      >
        {editing && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs text-slate-500">{editing.organization?.name} · {editing.user?.email} · {fmtDateTime(editing.createdAt)}</p>
              {editing.rating && <div className="mt-1"><Stars value={editing.rating} size="sm" /></div>}
              <p className="mt-2 text-sm whitespace-pre-wrap text-slate-700">{editing.message}</p>
            </div>
            <Select label="Status" options={['NEW', 'REVIEWED', 'PLANNED', 'DONE'].map((v) => ({ value: v, label: humanize(v) }))} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} />
            <Textarea label="Note to the organization (optional)" rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}/>
            <p className="-mt-2 text-xs text-slate-500">Shown to the organization with the status.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Small hook for the sidebar badge. */
export function useSupportUnread(enabled: boolean) {
  const { org } = useAuth();
  const q = useQuery({ queryKey: ['support', 'unread', org?.id], queryFn: () => get<{ unread: number }>('/support/unread'), enabled, refetchInterval: 60_000 });
  return q.data?.unread ?? 0;
}

export function usePlatformSupportUnread() {
  const q = useQuery({ queryKey: ['platform-support', 'list', 'badge'], queryFn: () => getPaged<Ticket>('/platform/support/tickets', { pageSize: 1 }), refetchInterval: 60_000 });
  return (q.data?.meta as unknown as { unread?: number })?.unread ?? 0;
}
