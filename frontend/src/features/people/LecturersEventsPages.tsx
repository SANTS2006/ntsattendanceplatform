import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays, MapPin, QrCode, Send, Trash2, UserPlus } from 'lucide-react';
import { del, errorMessage, get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ResourceManager, statusBadge } from '@/components/ResourceManager';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, BackButton } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import type { EventItem } from '@/types';
import { fmtDateTime } from '@/utils/format';
import { EnrollModal } from '../academics/AcademicsPages';

type Lecturer = {
  id: string; firstName: string; lastName: string; title: string | null; email: string; staffNumber: string | null; phone: string | null; status: string;
  departmentId: string | null; department: { name: string } | null; membership: { id: string; status: string } | null; classes: { class: { id: string; code: string } }[];
};

export function LecturersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const invite = useMutation({
    mutationFn: (id: string) => post(`/lecturers/${id}/invite`),
    onSuccess: () => { toast.success('Invitation sent'); qc.invalidateQueries({ queryKey: ['lecturers'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Lecturers" description="Teaching staff. Invite them to give them an NTS account with the Lecturer role." />
      <ResourceManager<Lecturer>
        title="Lecturer" url="/lecturers" queryKey="lecturers" managePermission="lecturers.manage" deleteLabel="Archive"
        columns={[
          { key: 'n', header: 'Name', render: (l) => <div><p className="font-medium">{`${l.title ?? ''} ${l.firstName} ${l.lastName}`.trim()}</p><p className="text-xs text-slate-500">{l.email}</p></div> },
          { key: 'd', header: 'Department', render: (l) => l.department?.name ?? '—' },
          { key: 'c', header: 'Classes', render: (l) => l.classes.map((c) => c.class.code).join(', ') || '—' },
          { key: 'a', header: 'Account', render: (l) => (l.membership ? <Badge tone="ACTIVE">Linked</Badge> : can('members.manage') && can('lecturers.manage') ? <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); invite.mutate(l.id); }}>Invite</Button> : <Badge tone="PENDING">No account</Badge>) },
          { key: 's', header: 'Status', render: (l) => statusBadge(l.status) },
        ]}
        fields={[
          { name: 'title', label: 'Title', type: 'text', max: 30, hint: 'For example Dr, Prof, Mr, Ms' }, { name: 'staffNumber', label: 'Staff number', type: 'text', max: 40 },
          { name: 'firstName', label: 'First name', type: 'text', required: true, max: 80 }, { name: 'lastName', label: 'Last name', type: 'text', required: true, max: 80 },
          { name: 'email', label: 'Email address', type: 'email', required: true }, { name: 'phone', label: 'Phone number', type: 'text', max: 30, pattern: { value: /^\+?[0-9 ()-]{6,30}$/, message: 'Enter a valid phone number' } },
          { name: 'departmentId', label: 'Department', type: 'ref', url: '/departments', optionLabel: (d) => d.name },
        ]}
      />
    </div>
  );
}

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function EventsPage() {
  const nav = useNavigate();
  const { org } = useAuth();
  return (
    <div>
      <PageHeader title="Events" description="Conferences, orientations, workshops — anything that needs attendance without a class structure." />
      <ResourceManager<EventItem>
        title="Event" url="/events" queryKey="events" managePermission="events.manage" deleteLabel="Archive"
        onRowClick={(r) => nav(`/app/events/${r.id}`)}
        toForm={(r) => ({ ...r, startsAt: toLocal(r.startsAt), endsAt: toLocal(r.endsAt) })}
        columns={[
          { key: 'n', header: 'Event', render: (e) => <div><p className="font-medium">{e.name}</p><p className="text-xs text-slate-500">{e.venue ?? ''}</p></div> },
          { key: 's', header: 'Starts', render: (e) => fmtDateTime(e.startsAt, org?.timezone) },
          { key: 'p', header: 'Participants', render: (e) => e._count?.participants ?? 0 },
          { key: 'r', header: 'Registration', render: (e) => (e.requireRegistration ? 'Registered only' : 'Open') },
          { key: 'st', header: 'Status', render: (e) => statusBadge(e.status) },
        ]}
        fields={[
          { name: 'name', label: 'Event name', type: 'text', required: true, max: 150 }, { name: 'venue', label: 'Venue', type: 'text', max: 200 },
          { name: 'startsAt', label: 'Starts', type: 'datetime-local', required: true }, { name: 'endsAt', label: 'Ends', type: 'datetime-local', required: true, after: 'startsAt' },
          { name: 'venueLocation', label: 'Venue location', type: 'location', latitude: 'defaultLatitude', longitude: 'defaultLongitude' },
          { name: 'requireRegistration', label: 'Only registered participants can check in', type: 'boolean' },
          { name: 'description', label: 'Description', type: 'textarea', max: 2000 },
        ]}
      />
    </div>
  );
}

type Participant = { id: string; student: { id: string; studentNumber: string; fullName: string; email: string | null } };

export function EventDetailPage() {
  const { id = '' } = useParams();
  const { can, org } = useAuth();
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: ['event', id], queryFn: () => get<EventItem & { managers: { lecturer: { id: string; firstName: string; lastName: string } }[] }>(`/events/${id}`) });
  const parts = usePaged<Participant>(`participants-${id}`, `/events/${id}/participants`);
  const [enroll, setEnroll] = useState(false);
  const [mgrOpen, setMgrOpen] = useState(false);
  const [lecturerId, setLecturerId] = useState('');
  const lecturers = useOptions<{ id: string; firstName: string; lastName: string }>('/lecturers', (l) => `${l.firstName} ${l.lastName}`, {}, can('lecturers.read'));
  const remove = useMutation({
    mutationFn: (sid: string) => del(`/events/${id}/participants/${sid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`participants-${id}`] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addMgr = useMutation({
    mutationFn: () => post(`/events/${id}/managers`, { lecturerId }),
    onSuccess: () => { setMgrOpen(false); qc.invalidateQueries({ queryKey: ['event', id] }); toast.success('Staff assigned'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (ev.isLoading) return <Spinner />;
  if (ev.error || !ev.data) return <ErrorState message={errorMessage(ev.error)} />;
  const e = ev.data;
  return (
    <div>
      <PageHeader
        title={e.name}
        description={e.description ?? undefined}
        back={<BackButton to="/app/events" label="Back to events" />}
        actions={(can('attendance.sessions.create') || can('attendance.sessions.manage_all')) && <Link to={`/app/attendance/new?eventId=${e.id}`}><Button icon={<QrCode className="h-4 w-4" />}>Start attendance</Button></Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-2"><CalendarDays className="h-4 w-4 text-slate-400" /> {fmtDateTime(e.startsAt, org?.timezone)} – {fmtDateTime(e.endsAt, org?.timezone)}</li>
            <li className="flex gap-2"><MapPin className="h-4 w-4 text-slate-400" /> {e.venue ?? 'No venue set'}</li>
            <li>{e.requireRegistration ? 'Only registered participants can check in.' : 'Anyone in your student database can check in.'}</li>
          </ul>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Attendance staff</h3>{can('events.manage') && <Button size="sm" variant="ghost" onClick={() => setMgrOpen(true)}>Assign</Button>}</div>
            {e.managers.length ? e.managers.map((m) => <p key={m.lecturer.id} className="text-sm">{m.lecturer.firstName} {m.lecturer.lastName}</p>) : <p className="text-sm text-slate-500">None assigned</p>}
          </div>
        </Card>
        <Card title="Participants" className="lg:col-span-2" padded={false} actions={can('events.manage') && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEnroll(true)}>Register participants</Button>}>
          <div className="border-b border-slate-100 p-3"><SearchInput value={parts.search} onChange={parts.setSearch} /></div>
          <DataTable
            rows={parts.rows}
            loading={parts.isFetching}
            error={parts.errorText}
            empty={<EmptyState title="No participants registered" />}
            columns={[
              { key: 'i', header: 'ID', render: (p) => <span className="font-mono text-xs">{p.student.studentNumber}</span> },
              { key: 'n', header: 'Name', render: (p) => p.student.fullName },
              { key: 'e', header: 'Email', render: (p) => p.student.email ?? '—' },
              ...(can('events.manage') ? [{ key: 'x', header: '', render: (p: Participant) => <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => remove.mutate(p.student.id)} /> }] : []),
            ]}
          />
          {parts.meta && <Pagination page={parts.meta.page} totalPages={parts.meta.totalPages} total={parts.meta.total} onPage={parts.setPage} />}
        </Card>
      </div>
      <EnrollModal open={enroll} onClose={() => setEnroll(false)} title="Register participants" url={`/events/${id}/participants`} body={(ids) => ({ studentIds: ids })} onDone={() => qc.invalidateQueries({ queryKey: [`participants-${id}`] })} />
      <Modal open={mgrOpen} onClose={() => setMgrOpen(false)} title="Assign attendance staff" size="sm" footer={<Button disabled={!lecturerId} loading={addMgr.isPending} onClick={() => addMgr.mutate()}>Assign</Button>}>
        <Select label="Lecturer / staff" options={lecturers.options} placeholder="Select your lecturer / staff" value={lecturerId} onChange={(ev2) => setLecturerId(ev2.target.value)} />
      </Modal>
    </div>
  );
}
