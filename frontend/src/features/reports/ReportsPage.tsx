import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileDown, RefreshCw } from 'lucide-react';
import { errorMessage, get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, PageHeader, Select, Spinner, StatCard } from '@/components/ui';
import { useOptions } from '@/hooks/useOptions';
import type { ClassItem, EventItem, Ref } from '@/types';
import { fmtDateTime } from '@/utils/format';

type Analytics = {
  totalRecords: number; sessions: number; verificationFailures: number; byStatus: Record<string, number>;
  trend: { date: string; count: number }[]; topContexts: { label: string; count: number }[]; byProgram: { label: string; count: number }[]; byLevel: { label: string; count: number }[];
};
type Summary = { class: { name: string; code: string }; totalSessions: number; students: { studentId: string; studentNumber: string; fullName: string; attended: number; late: number; excused: number; absent: number; rate: number | null }[] };
type Export = { id: string; format: string; reportType: string; status: string; rowCount: number | null; createdAt: string; error: string | null };

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'];

export function ReportsPage() {
  const { can, org } = useAuth();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ classId: sp.get('classId') ?? '', eventId: '', programId: '', levelId: '', from: '', to: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const classes = useOptions<ClassItem>('/classes', (c) => `${c.course?.code ?? c.code} · ${c.name}`);
  const events = useOptions<EventItem>('/events', (e) => e.name, {}, can('events.read'));
  const programs = useOptions<Ref>('/programs', (p) => p.name, {}, can('academics.read'));
  const levels = useOptions<Ref>('/levels', (l) => l.name, {}, can('academics.read'));
  const params = {
    ...f,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined,
  };
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const analytics = useQuery({ queryKey: ['analytics', clean], queryFn: () => get<Analytics>('/reports/attendance', clean) });
  const summary = useQuery({ queryKey: ['class-summary', f.classId, f.from, f.to], queryFn: () => get<Summary>(`/reports/classes/${f.classId}/summary`, { from: params.from, to: params.to }), enabled: !!f.classId });
  const canExport = can('reports.export') || can('attendance.export');
  const exports = useQuery({ queryKey: ['exports'], queryFn: () => get<Export[]>('/reports/export'), enabled: canExport, refetchInterval: (q) => (q.state.data?.some((e) => ['PENDING', 'PROCESSING'].includes(e.status)) ? 2000 : false) });

  const requestExport = useMutation({
    mutationFn: (v: { format: string; reportType: string }) => post('/reports/export', { ...v, filters: clean }),
    onSuccess: () => { toast.success('Export queued'); qc.invalidateQueries({ queryKey: ['exports'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const download = async (id: string) => {
    try {
      const r = await get<{ downloadUrl: string | null }>(`/reports/export/${id}`);
      if (r.downloadUrl) window.location.assign(r.downloadUrl);
      else toast.error('This export is not available');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const a = analytics.data;
  const statusData = a ? Object.entries(a.byStatus).map(([name, value]) => ({ name, value })) : [];
  return (
    <div>
      <PageHeader title="Reports & analytics" description="Attendance across your permitted classes and events." />
      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select aria-label="Class" options={classes.options} placeholder="All classes" value={f.classId} onChange={set('classId')} />
          {can('events.read') && <Select aria-label="Event" options={events.options} placeholder="All events" value={f.eventId} onChange={set('eventId')} />}
          <Select aria-label="Program" options={programs.options} placeholder="All programs" value={f.programId} onChange={set('programId')} />
          <Select aria-label="Level" options={levels.options} placeholder="All levels" value={f.levelId} onChange={set('levelId')} />
          <Input aria-label="From" type="date" value={f.from} onChange={set('from')} />
          <Input aria-label="To" type="date" value={f.to} onChange={set('to')} />
        </div>
      </Card>

      {analytics.isLoading ? <Spinner /> : analytics.error ? <ErrorState message={errorMessage(analytics.error)} onRetry={() => analytics.refetch()} /> : a && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Check-ins" value={a.totalRecords.toLocaleString()} />
            <StatCard label="Sessions" value={a.sessions.toLocaleString()} tone="slate" />
            <StatCard label="Late arrivals" value={(a.byStatus.LATE ?? 0).toLocaleString()} tone="amber" />
            <StatCard label="Failed verification attempts" value={a.verificationFailures.toLocaleString()} tone="rose" />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card title="Daily check-ins" className="lg:col-span-2">
              {a.trend.length ? (
                <div className="h-64"><ResponsiveContainer><LineChart data={a.trend}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} /><Tooltip /><Line type="monotone" dataKey="count" name="Check-ins" stroke="#4f46e5" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
              ) : <EmptyState title="No data for these filters" />}
            </Card>
            <Card title="By status">
              {statusData.length ? (
                <div className="h-64"><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} label>{statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
              ) : <EmptyState title="No data" />}
            </Card>
            <Card title="Top classes / events" className="lg:col-span-2">
              {a.topContexts.length ? (
                <div className="h-64"><ResponsiveContainer><BarChart data={a.topContexts} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>
              ) : <EmptyState title="No data" />}
            </Card>
            <Card title="By program">
              <ul className="space-y-2 text-sm">{a.byProgram.map((p) => <li key={p.label} className="flex justify-between"><span className="truncate">{p.label}</span><span className="tabular-nums font-medium">{p.count}</span></li>)}</ul>
            </Card>
          </div>
        </>
      )}

      {f.classId && (
        <Card title={summary.data ? `Per-student attendance — ${summary.data.class.code} (${summary.data.totalSessions} sessions)` : 'Per-student attendance'} className="mt-6" padded={false}
          actions={canExport && <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => requestExport.mutate({ format: 'XLSX', reportType: 'class_summary' })}>Export summary</Button>}>
          <DataTable
            rows={summary.data?.students.map((s) => ({ ...s, id: s.studentId }))}
            loading={summary.isFetching}
            error={summary.error ? errorMessage(summary.error) : null}
            columns={[
              { key: 'id', header: 'ID', render: (s) => <span className="font-mono text-xs">{s.studentNumber}</span> },
              { key: 'n', header: 'Name', render: (s) => s.fullName },
              { key: 'a', header: 'Attended', render: (s) => s.attended },
              { key: 'l', header: 'Late', render: (s) => s.late },
              { key: 'ab', header: 'Absent', render: (s) => s.absent },
              { key: 'r', header: 'Rate', render: (s) => (s.rate == null ? '—' : <span className={s.rate < 75 ? 'font-medium text-rose-600' : 'text-emerald-700'}>{s.rate}%</span>) },
            ]}
          />
        </Card>
      )}

      {canExport && (
        <Card title="Exports" className="mt-6" padded={false}
          actions={<div className="flex gap-2">{['CSV', 'XLSX', 'PDF'].map((fmt) => <Button key={fmt} size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} loading={requestExport.isPending && requestExport.variables?.format === fmt} onClick={() => requestExport.mutate({ format: fmt, reportType: 'records' })}>{fmt === 'XLSX' ? 'Excel' : fmt}</Button>)}<Button size="sm" variant="ghost" aria-label="Refresh" icon={<RefreshCw className="h-4 w-4" />} onClick={() => exports.refetch()} /></div>}>
          <DataTable
            rows={exports.data}
            loading={exports.isFetching}
            empty={<EmptyState title="No exports yet" description="Exports use the filters above and are generated in the background. Links expire after 7 days." />}
            columns={[
              { key: 'c', header: 'Requested', render: (e) => fmtDateTime(e.createdAt, org?.timezone) },
              { key: 't', header: 'Report', render: (e) => (e.reportType === 'class_summary' ? 'Class summary' : 'Attendance records') },
              { key: 'f', header: 'Format', render: (e) => e.format },
              { key: 'r', header: 'Rows', render: (e) => e.rowCount ?? '—' },
              { key: 's', header: 'Status', render: (e) => <span title={e.error ?? undefined}><Badge>{e.status}</Badge></span> },
              { key: 'd', header: '', render: (e) => e.status === 'COMPLETED' && <Button size="sm" variant="secondary" onClick={() => download(e.id)}>Download</Button> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
