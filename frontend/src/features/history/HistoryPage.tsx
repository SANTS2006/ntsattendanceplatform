import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { History as HistoryIcon } from 'lucide-react';
import { getPaged } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Card, DataTable, EmptyState, Input, PageHeader, Pagination, SearchInput, Tabs, Toggle } from '@/components/ui';
import { TableSkeleton } from '@/components/brand';
import { HistoryButton, HistoryList, type HistoryEntry } from '@/components/History';
import { usePaged } from '@/hooks/usePaged';
import type { Student } from '@/types';
import { StudentStatusButton } from '@/features/students/StudentStatus';

const MODULES = [
  { key: 'all', label: 'All activity' },
  { key: 'students', label: 'Students' },
  { key: 'by-status', label: 'Students by status' },
  { key: 'classes', label: 'Classes & enrolments' },
  { key: 'events', label: 'Events' },
  { key: 'lecturers', label: 'Lecturers' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'academics', label: 'Academic structure' },
  { key: 'people', label: 'Users & roles' },
  { key: 'organization', label: 'Organization' },
];

const LINKS: Record<string, (id: string) => string> = {
  Student: (id) => `/app/students/${id}`,
  Class: (id) => `/app/classes/${id}`,
  Event: (id) => `/app/events/${id}`,
  AttendanceSession: (id) => `/app/attendance/${id}`,
};

function ActivityFeed({ module }: { module: string }) {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [statusOnly, setStatusOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery({
    queryKey: ['history', 'org', module, action, statusOnly, from, to, page],
    queryFn: () =>
      getPaged<HistoryEntry>('/history', {
        module: module === 'all' ? undefined : module, action: action || undefined, statusChangesOnly: statusOnly ? 'true' : undefined,
        from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, page, pageSize: 25,
      }),
  });
  return (
    <Card padded={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SearchInput value={action} onChange={(v) => { setAction(v); setPage(1); }} placeholder="Filter by action (e.g. status, enrolled)…" />
        <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        <div className="rounded-xl border border-slate-200 px-3"><Toggle label="Status changes only" checked={statusOnly} onChange={(v) => { setStatusOnly(v); setPage(1); }} /></div>
      </div>
      <div className="p-5">
        {q.isLoading ? (
          <TableSkeleton columns={2} rows={6} />
        ) : q.data?.items.length ? (
          <HistoryList items={q.data.items} showTarget />
        ) : (
          <EmptyState icon={<HistoryIcon />} title="Nothing recorded yet" description="Actions in this module will appear here as they happen." />
        )}
      </div>
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
      {q.data?.items.some((i) => i.targetType && i.targetId && LINKS[i.targetType]) && (
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Open a record from its page to see its full timeline.</p>
      )}
    </Card>
  );
}

function StudentsByStatus() {
  const [status, setStatus] = useState('ACTIVE');
  const list = usePaged<Student>('students', '/students', { status });
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mb-6"><Tabs tabs={['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED'].map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} active={status} onChange={setStatus} /></div>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name or student ID…" />
      </div>
      <DataTable
        rows={list.rows}
        loading={list.isFetching}
        error={list.errorText}
        empty={<EmptyState title={`No ${status.toLowerCase()} students`} />}
        columns={[
          { key: 'n', header: 'Student', render: (s) => <Link to={`/app/students/${s.id}`} className="font-semibold text-navy-900 hover:text-brand-700">{s.fullName}</Link> },
          { key: 'id', header: 'Student ID', render: (s) => <span className="font-mono text-xs">{s.studentNumber}</span> },
          { key: 'p', header: 'Program', render: (s) => s.program?.name ?? '—' },
          { key: 's', header: 'Status', render: (s) => <Badge>{s.status}</Badge> },
          { key: 'a', header: '', className: 'text-right', render: (s) => <div className="flex justify-end gap-2"><HistoryButton targetType="Student" targetId={s.id} perspective="student" /><StudentStatusButton student={s} size="sm" /></div> },
        ]}
      />
      {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
    </Card>
  );
}

export function HistoryPage() {
  const [module, setModule] = useState('all');
  const { can } = useAuth();
  const tabs = MODULES.filter((m) => m.key !== 'by-status' || can('students.read'));
  return (
    <div>
      <PageHeader title="History" description="Every record’s status changes and the actions performed on it — who did what, and when." />
      <Tabs tabs={tabs} active={module} onChange={setModule} />
      {module === 'by-status' ? <StudentsByStatus /> : <ActivityFeed key={module} module={module} />}
    </div>
  );
}
