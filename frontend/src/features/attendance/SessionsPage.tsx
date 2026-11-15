import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QrCode } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Pagination, Select, Tabs } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import type { AttendanceSession, ClassItem } from '@/types';
import { fmtDateTime } from '@/utils/format';

export function SessionsPage() {
  const { can, org } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [classId, setClassId] = useState('');
  const [mine, setMine] = useState(false);
  const classes = useOptions<ClassItem>('/classes', (c) => `${c.course?.code ?? c.code} · ${c.name}`);
  const list = usePaged<AttendanceSession>('sessions', '/attendance/sessions', { status: status || undefined, classId: classId || undefined, mine: mine ? 'true' : undefined });
  const canCreate = can('attendance.sessions.create') || can('attendance.sessions.manage_all');
  return (
    <div>
      <PageHeader
        title="Attendance sessions"
        description="Generate QR codes, monitor live check-ins and review past sessions."
        actions={canCreate && <Link to="/app/attendance/new"><Button icon={<QrCode className="h-4 w-4" />}>New session</Button></Link>}
      />
      <Tabs
        tabs={[{ key: '', label: 'All' }, { key: 'ACTIVE', label: 'Active' }, { key: 'EXPIRED', label: 'Expired' }, { key: 'CLOSED', label: 'Closed' }, { key: 'REVOKED', label: 'Revoked' }]}
        active={status}
        onChange={setStatus}
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="sm:w-72">
            <Select aria-label="Filter by class" options={classes.options} placeholder="All classes" value={classId} onChange={(e) => setClassId(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="rounded border-slate-300" /> Only my sessions
          </label>
        </div>
        <DataTable
          rows={list.rows}
          loading={list.isFetching}
          error={list.errorText}
          onRetry={() => list.refetch()}
          onRowClick={(r) => nav(`/app/attendance/${r.id}`)}
          empty={<EmptyState title="No sessions found" description="Create a session to generate a QR code for your class or event." />}
          columns={[
            { key: 'title', header: 'Session', render: (s) => <div><p className="font-medium text-slate-900">{s.title}</p><p className="text-xs text-slate-500">{s.class ? `${s.class.course?.code ?? ''} ${s.class.name}` : s.event?.name}</p></div> },
            { key: 'lecturer', header: 'Lecturer', render: (s) => (s.lecturer ? `${s.lecturer.firstName} ${s.lecturer.lastName}` : '—') },
            { key: 'created', header: 'Started', render: (s) => fmtDateTime(s.startsAt, org?.timezone) },
            { key: 'expires', header: 'Expires', render: (s) => fmtDateTime(s.expiresAt, org?.timezone) },
            { key: 'count', header: 'Present', render: (s) => <span className="tabular-nums">{s._count?.records ?? 0}</span> },
            { key: 'status', header: 'Status', render: (s) => <Badge>{s.effectiveStatus}</Badge> },
          ]}
        />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
    </div>
  );
}
