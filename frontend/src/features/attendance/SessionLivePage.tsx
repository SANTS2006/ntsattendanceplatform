import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Ban, Clock, Copy, Download, Maximize2, Minimize2, RefreshCw, Square, UserPlus, Users, Wifi, WifiOff } from 'lucide-react';
import { errorMessage, get, getPaged, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Modal, PageHeader, Pagination, Select, Spinner, StatCard, Tabs, Textarea, BackButton } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { useSessionSocket } from '@/hooks/useSessionSocket';
import type { AttendanceRecord, AttendanceSession, QrInfo } from '@/types';
import { fmtDateTime } from '@/utils/format';
import { RecordsTable } from './RecordsTable';

function useCountdown(target: string | undefined, offsetMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return { left: 0, label: '—' };
  const left = Math.max(0, new Date(target).getTime() - (now + offsetMs));
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, label: `${m}:${String(s).padStart(2, '0')}` };
}

type FeedItem = { id: string; name: string; at: string; flagged?: boolean };

export function SessionLivePage() {
  const { id = '' } = useParams();
  const { org, can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState('records');
  const [qr, setQr] = useState<QrInfo | null>(() => {
    try {
      const raw = sessionStorage.getItem(`nts-qr-${id}`);
      return raw ? (JSON.parse(raw) as QrInfo) : null;
    } catch {
      return null;
    }
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [confirm, setConfirm] = useState<'close' | 'revoke' | 'replace' | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const session = useQuery({ queryKey: ['session', id], queryFn: () => get<AttendanceSession>(`/attendance/sessions/${id}`), refetchInterval: 30_000 });
  const s = session.data;
  const offset = s?.serverTime ? new Date(s.serverTime).getTime() - Date.now() : 0;
  const countdown = useCountdown(s?.expiresAt, offset);
  const active = s?.effectiveStatus === 'ACTIVE' && countdown.left > 0;
  const records = usePaged<AttendanceRecord>(`records-${id}`, `/attendance/sessions/${id}/records`, {}, { pageSize: 25 });
  const absentees = usePaged<{ id: string; studentNumber: string; fullName: string; email: string | null; program: { name: string } | null; level: { name: string } | null }>(
    `absent-${id}`, `/attendance/sessions/${id}/absentees`, {}, { pageSize: 25, enabled: tab === 'absent' },
  );

  const mintQr = useCallback(async () => {
    try {
      const q = await post<QrInfo>(`/attendance/sessions/${id}/qr`);
      setQr(q);
      sessionStorage.setItem(`nts-qr-${id}`, JSON.stringify(q));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [id]);

  // The raw QR token is never stored server-side, so after a reload we mint a fresh one.
  useEffect(() => {
    if (s?.canManage && active && (!qr || new Date(qr.expiresAt).getTime() < Date.now() + 5000)) void mintQr();
  }, [s?.canManage, active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotating QR mode.
  useEffect(() => {
    if (!qr?.rotationSeconds || !active || !s?.canManage) return;
    const t = setInterval(mintQr, Math.max(10, qr.rotationSeconds - 5) * 1000);
    return () => clearInterval(t);
  }, [qr?.rotationSeconds, active, s?.canManage, mintQr]);

  const { connected } = useSessionSocket(id, {
    'attendance:recorded': (p) => {
      const rec = (p as { record?: { id: string; studentNameSnapshot: string; submittedAt: string; flagged?: boolean }; recordId?: string; studentName?: string }).record;
      const item = rec ? { id: rec.id, name: rec.studentNameSnapshot, at: rec.submittedAt, flagged: rec.flagged } : { id: String((p as { recordId: string }).recordId), name: String((p as { studentName: string }).studentName), at: new Date().toISOString() };
      setFeed((f) => [item, ...f.filter((x) => x.id !== item.id)].slice(0, 30));
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: [`records-${id}`] });
      qc.invalidateQueries({ queryKey: [`absent-${id}`] });
    },
    'attendance:corrected': () => {
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: [`records-${id}`] });
    },
    'session:updated': () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });

  const action = useMutation({
    mutationFn: async (kind: 'close' | 'revoke' | 'replace') => {
      if (kind === 'replace') return post<{ session: { id: string }; qr: QrInfo }>(`/attendance/sessions/${id}/replace`, {});
      return post(`/attendance/sessions/${id}/${kind}`);
    },
    onSuccess: (r, kind) => {
      setConfirm(null);
      if (kind === 'replace') {
        const rr = r as { session: { id: string }; qr: QrInfo };
        sessionStorage.setItem(`nts-qr-${rr.session.id}`, JSON.stringify(rr.qr));
        toast.success('Replacement session started');
        nav(`/app/attendance/${rr.session.id}`);
        return;
      }
      sessionStorage.removeItem(`nts-qr-${id}`);
      setQr(null);
      toast.success(kind === 'close' ? 'Session closed' : 'QR code revoked');
      qc.invalidateQueries({ queryKey: ['session', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const exportCsv = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    try {
      await post('/reports/export', { format, filters: { sessionId: id } });
      toast.success('Export queued — find it under Reports when ready.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (session.isLoading) return <Spinner />;
  if (session.error || !s) return <ErrorState message={errorMessage(session.error)} onRetry={() => session.refetch()} />;
  const st = s.stats!;

  const qrBlock = qr && active && s.canManage && (
    <div className={clsx('flex w-full flex-col items-center', fullscreen && 'fixed inset-0 z-50 justify-center overflow-y-auto bg-white p-4 sm:p-6')}>
      {fullscreen && (
        <div className="mb-6 text-center">
          <p className="text-sm text-slate-500">{org?.name}</p>
          <h2 className="text-2xl font-semibold break-words text-slate-900 sm:text-3xl">{s.title}</h2>
        </div>
      )}
      {/* The QR scales with its container (and with the screen in full-screen mode) instead of a fixed pixel size. */}
      <div className={clsx('w-full rounded-2xl border border-slate-200 bg-white p-3 sm:p-4', fullscreen ? 'max-w-[min(88vw,68vh)]' : 'max-w-[340px]')}>
        <QRCodeSVG value={qr.url} size={512} style={{ width: '100%', height: 'auto', display: 'block' }} level="M" marginSize={2} aria-label="Attendance QR code" />
      </div>
      <p className={clsx('mt-4 flex items-center gap-2 font-medium tabular-nums', fullscreen ? 'text-3xl' : 'text-lg', countdown.left < 60_000 ? 'text-rose-600' : 'text-slate-800')}>
        <Clock className={fullscreen ? 'h-7 w-7' : 'h-5 w-5'} /> {countdown.label}
      </p>
      {fullscreen && <p className="mt-2 text-2xl font-semibold text-emerald-700">{st.present} present</p>}
      <div className="mt-3 flex w-full flex-wrap justify-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (fullscreen) return setFullscreen(false);
            // New tab (sessionStorage — including the current code — is copied to it).
            const w = window.open(`/present/${id}`, '_blank');
            if (!w) setFullscreen(true); // pop-up blocked: fall back to the in-page view
          }}
          icon={fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        >
          {fullscreen ? 'Exit full screen' : 'Present full screen'}
        </Button>
        {!fullscreen && (
          <>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(qr.url).then(() => toast.success('Link copied'))} icon={<Copy className="h-4 w-4" />}>
              Copy link
            </Button>
            <Button size="sm" variant="secondary" onClick={mintQr} icon={<RefreshCw className="h-4 w-4" />}>
              New code
            </Button>
          </>
        )}
      </div>
      {qr.rotationSeconds && <p className="mt-2 text-center text-xs text-slate-400">The code changes every {qr.rotationSeconds} seconds.</p>}
    </div>
  );

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={s.title}
        description={`${s.class ? `${s.class.course?.code ?? ''} ${s.class.course?.title ?? ''} · ${s.class.name}` : s.event?.name ?? ''} · started ${fmtDateTime(s.startsAt, org?.timezone)}`}
        back={<BackButton to="/app/attendance" label="Back to sessions" />}
        actions={
          <>
            <Badge>{countdown.left === 0 && s.effectiveStatus === 'ACTIVE' ? 'EXPIRED' : s.effectiveStatus}</Badge>
            <span className={clsx('inline-flex items-center gap-1 text-xs', connected ? 'text-emerald-600' : 'text-slate-400')}>
              {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} {connected ? 'Live' : 'Offline'}
            </span>
            {s.canManage && s.status === 'ACTIVE' && (
              <>
                <Button variant="secondary" onClick={() => setConfirm('close')} icon={<Square className="h-4 w-4" />}>Close</Button>
                <Button variant="danger" onClick={() => setConfirm('revoke')} icon={<Ban className="h-4 w-4" />}>Revoke QR</Button>
              </>
            )}
            {s.canManage && <Button variant="secondary" onClick={() => setConfirm('replace')} icon={<RefreshCw className="h-4 w-4" />}>Replace</Button>}
          </>
        }
      />

      <div className="grid w-full gap-4 sm:gap-6 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)] 2xl:grid-cols-[440px_minmax(0,1fr)]">
        <Card title="QR code" className="min-w-0">
          {qrBlock || (
            <EmptyState
              title={s.effectiveStatus === 'ACTIVE' && countdown.left > 0 ? (s.canManage ? 'Generating QR code…' : 'Only the session owner can display the QR code') : `This session is ${(countdown.left === 0 && s.effectiveStatus === 'ACTIVE' ? 'expired' : s.effectiveStatus).toLowerCase()}`}
              description={s.effectiveStatus !== 'ACTIVE' || countdown.left === 0 ? 'Students can no longer check in. Start a replacement session if needed.' : undefined}
            />
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <div>Expires<dd className="font-medium text-slate-800">{fmtDateTime(s.expiresAt, org?.timezone)}</dd></div>
            <div>Location<dd className="font-medium text-slate-800">{s.locationRequired ? `Within ${s.radiusM} m` : 'Not required'}</dd></div>
            <div>Selfie<dd className="font-medium text-slate-800">{s.selfieRequired ? 'Required' : 'Optional'}</dd></div>
            <div>Enrollment<dd className="font-medium text-slate-800">{s.requireEnrollment ? 'Enrolled only' : 'Anyone in org'}</dd></div>
          </dl>
        </Card>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            <StatCard label="Present" value={st.present} tone="green" hint={st.late ? `${st.late} late` : undefined} />
            <StatCard label="Absent" value={st.absent} tone="rose" hint={`of ${st.expected} expected`} />
            <StatCard label="Attendance" value={st.attendanceRate == null ? '—' : `${st.attendanceRate}%`} tone="brand" />
            <StatCard label="Failed attempts" value={st.failedAttemptsTotal} tone="amber" hint={Object.entries(st.failedAttempts).map(([k, v]) => `${k.replace('_', ' ').toLowerCase()}: ${v}`).join(', ') || undefined} />
          </div>
          <Card title="Live check-ins" actions={<Users className="h-4 w-4 text-slate-400" />}>
            {feed.length === 0 ? (
              <p className="text-sm text-slate-500">New check-ins will appear here instantly.</p>
            ) : (
              <ul className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 2xl:grid-cols-3">
                {feed.map((f) => (
                  <li key={f.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium text-emerald-900">{f.name}</span>
                    <span className="shrink-0 text-xs text-emerald-700">{f.flagged ? '⚠ review · ' : ''}{new Date(f.at).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 min-w-0 sm:mt-6">
        <Tabs tabs={[{ key: 'records', label: `Present (${st.totalSubmissions})` }, { key: 'absent', label: `Absent (${st.absent})` }]} active={tab} onChange={setTab} />
        <Card
          padded={false}
          title={tab === 'records' ? 'Attendance records' : 'Not yet checked in'}
          actions={
            <div className="flex flex-wrap gap-2">
              {can('attendance.correct') && <Button size="sm" variant="secondary" onClick={() => setManualOpen(true)} icon={<UserPlus className="h-4 w-4" />}>Manual entry</Button>}
              {(can('attendance.export') || can('reports.export')) && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => exportCsv('CSV')} icon={<Download className="h-4 w-4" />}>CSV</Button>
                  <Button size="sm" variant="secondary" onClick={() => exportCsv('XLSX')}>Excel</Button>
                  <Button size="sm" variant="secondary" onClick={() => exportCsv('PDF')}>PDF</Button>
                </>
              )}
            </div>
          }
        >
          {tab === 'records' ? (
            <RecordsTable queryKey={`records-${id}`} rows={records.rows} meta={records.meta} loading={records.isFetching} error={records.errorText} onRetry={() => records.refetch()} onPage={records.setPage} sort={records.sort} onSort={records.setSort} showContext={false} />
          ) : (
            <>
              <DataTable
                rows={absentees.rows}
                loading={absentees.isFetching}
                error={absentees.errorText}
                empty={<EmptyState title="Everyone is here" />}
                columns={[
                  { key: 'name', header: 'Student', render: (r) => <span className="font-medium">{r.fullName}</span> },
                  { key: 'id', header: 'Student ID', render: (r) => <span className="font-mono text-xs">{r.studentNumber}</span> },
                  { key: 'email', header: 'Email', render: (r) => r.email ?? '—' },
                  { key: 'p', header: 'Program / level', render: (r) => [r.program?.name, r.level?.name].filter(Boolean).join(' · ') || '—' },
                ]}
              />
              {absentees.meta && <Pagination page={absentees.meta.page} totalPages={absentees.meta.totalPages} total={absentees.meta.total} onPage={absentees.setPage} />}
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && action.mutate(confirm)}
        loading={action.isPending}
        danger={confirm === 'revoke'}
        title={confirm === 'close' ? 'Close this session?' : confirm === 'revoke' ? 'Revoke the QR code?' : 'Replace this session?'}
        confirmLabel={confirm === 'close' ? 'Close session' : confirm === 'revoke' ? 'Revoke' : 'Replace'}
        message={
          confirm === 'close'
            ? 'Students will no longer be able to check in. Existing records are kept.'
            : confirm === 'revoke'
              ? 'The QR code stops working immediately (use this if the code was shared). Existing records are kept.'
              : 'The current QR code is revoked and a new session with the same settings starts.'
        }
      />
      <ManualEntry open={manualOpen} onClose={() => setManualOpen(false)} sessionId={id} />
    </div>
  );
}

function ManualEntry({ open, onClose, sessionId }: { open: boolean; onClose: () => void; sessionId: string }) {
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState('');
  const [status, setStatus] = useState('PRESENT');
  const [reason, setReason] = useState('');
  const absentees = useQuery({
    queryKey: [`absent-${sessionId}`, 'all'],
    queryFn: () => getPaged<{ id: string; fullName: string; studentNumber: string }>(`/attendance/sessions/${sessionId}/absentees`, { pageSize: 100 }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => post(`/attendance/sessions/${sessionId}/manual-records`, { studentId, status, reason }),
    onSuccess: () => {
      toast.success('Attendance recorded');
      onClose();
      setStudentId('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
      qc.invalidateQueries({ queryKey: [`records-${sessionId}`] });
      qc.invalidateQueries({ queryKey: [`absent-${sessionId}`] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manual attendance entry"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!studentId || reason.length < 3} onClick={() => save.mutate()}>Record</Button></>}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Use this when a student could not check in (e.g. no phone). Manual entries are labelled and audited.</p>
        <Select label="Student" options={(absentees.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.fullName} (${a.studentNumber})` }))} placeholder="Select your student" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
        <Select label="Status" options={['PRESENT', 'LATE', 'EXCUSED'].map((s) => ({ value: s, label: s }))} value={status} onChange={(e) => setStatus(e.target.value)} />
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
