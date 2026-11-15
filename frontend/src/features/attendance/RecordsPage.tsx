import { useState } from 'react';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { errorMessage, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Input, PageHeader, SearchInput, Select } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import type { AttendanceRecord, ClassItem, EventItem, Ref } from '@/types';
import { RecordsTable } from './RecordsTable';

export function RecordsPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ classId: '', eventId: '', programId: '', levelId: '', status: '', from: '', to: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const classes = useOptions<ClassItem>('/classes', (c) => `${c.course?.code ?? c.code} · ${c.name}`);
  const events = useOptions<EventItem>('/events', (e) => e.name, {}, can('events.read'));
  const programs = useOptions<Ref>('/programs', (p) => p.name, {}, can('academics.read'));
  const levels = useOptions<Ref>('/levels', (l) => l.name, {}, can('academics.read'));
  const filters = {
    ...f,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined,
  };
  const list = usePaged<AttendanceRecord>('records', '/attendance/records', filters, { pageSize: 25 });

  const exportAs = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    try {
      await post('/reports/export', { format, filters: Object.fromEntries(Object.entries({ ...filters, search: list.search }).filter(([, v]) => v)) });
      toast.success('Export queued — download it from Reports when ready.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Attendance records"
        description="All check-ins you are authorized to see."
        actions={
          (can('attendance.export') || can('reports.export')) && (
            <>
              <Button variant="secondary" onClick={() => exportAs('CSV')} icon={<Download className="h-4 w-4" />}>CSV</Button>
              <Button variant="secondary" onClick={() => exportAs('XLSX')}>Excel</Button>
              <Button variant="secondary" onClick={() => exportAs('PDF')}>PDF</Button>
            </>
          )
        }
      />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name, ID or reference…" />
          <Select aria-label="Class" options={classes.options} placeholder="All classes" value={f.classId} onChange={set('classId')} />
          {can('events.read') && <Select aria-label="Event" options={events.options} placeholder="All events" value={f.eventId} onChange={set('eventId')} />}
          <Select aria-label="Program" options={programs.options} placeholder="All programs" value={f.programId} onChange={set('programId')} />
          <Select aria-label="Level" options={levels.options} placeholder="All levels" value={f.levelId} onChange={set('levelId')} />
          <Select aria-label="Status" options={['PRESENT', 'LATE', 'EXCUSED', 'INVALIDATED'].map((s) => ({ value: s, label: s }))} placeholder="Any status" value={f.status} onChange={set('status')} />
          <Input aria-label="From date" type="date" value={f.from} onChange={set('from')} />
          <Input aria-label="To date" type="date" value={f.to} onChange={set('to')} />
        </div>
        <RecordsTable queryKey="records" rows={list.rows} meta={list.meta} loading={list.isFetching} error={list.errorText} onRetry={() => list.refetch()} onPage={list.setPage} sort={list.sort} onSort={list.setSort} />
      </Card>
    </div>
  );
}
