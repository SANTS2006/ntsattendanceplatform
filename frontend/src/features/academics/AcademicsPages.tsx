import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { QrCode, Trash2, UserPlus, Users } from 'lucide-react';
import { del, errorMessage, get, getPaged, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ResourceManager, statusBadge } from '@/components/ResourceManager';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Tabs, BackButton } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { RecordHistory } from '@/components/History';
import { useOptions } from '@/hooks/useOptions';
import type { ClassItem, Ref } from '@/types';
import { fmtDate } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = [
  { key: 'faculties', label: 'Faculties' },
  { key: 'departments', label: 'Departments' },
  { key: 'programs', label: 'Programs' },
  { key: 'levels', label: 'Levels' },
  { key: 'years', label: 'Academic years' },
  { key: 'semesters', label: 'Semesters' },
  { key: 'courses', label: 'Courses' },
];
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : '');

export function AcademicsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'departments';
  const common = { managePermission: 'academics.manage', deleteLabel: 'Archive' as const };
  return (
    <div>
      <PageHeader title="Academic structure" description="Configure your own faculties, departments, programs, levels, terms and courses. Event organizers can skip this." />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setSp({ tab: k })} />
      {tab === 'faculties' && (
        <ResourceManager<any> {...common} title="Faculty" url="/faculties" queryKey="faculties"
          columns={[{ key: 'code', header: 'Code', render: (r) => r.code }, { key: 'name', header: 'Name', render: (r) => r.name }, { key: 'st', header: 'Status', render: (r) => statusBadge(r.status) }]}
          fields={[{ name: 'name', label: 'Faculty name', type: 'text', required: true, max: 150 }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }]} />
      )}
      {tab === 'departments' && (
        <ResourceManager<any> {...common} title="Department" url="/departments" queryKey="departments"
          columns={[{ key: 'code', header: 'Code', render: (r) => r.code }, { key: 'name', header: 'Name', render: (r) => r.name }, { key: 'fac', header: 'Faculty', render: (r) => r.faculty?.name ?? '—' }, { key: 'st', header: 'Status', render: (r) => statusBadge(r.status) }]}
          fields={[{ name: 'name', label: 'Department name', type: 'text', required: true, max: 150 }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'facultyId', label: 'Faculty', type: 'ref', url: '/faculties', optionLabel: (f) => f.name }]} />
      )}
      {tab === 'programs' && (
        <ResourceManager<any> {...common} title="Program" url="/programs" queryKey="programs"
          columns={[{ key: 'code', header: 'Code', render: (r) => r.code }, { key: 'name', header: 'Name', render: (r) => r.name }, { key: 'd', header: 'Department', render: (r) => r.department?.name ?? '—' }, { key: 'y', header: 'Years', render: (r) => r.durationYears ?? '—' }, { key: 'st', header: 'Status', render: (r) => statusBadge(r.status) }]}
          fields={[{ name: 'name', label: 'Program name', type: 'text', required: true, max: 150 }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'departmentId', label: 'Department', type: 'ref', url: '/departments', optionLabel: (d) => d.name }, { name: 'durationYears', label: 'Duration (years)', type: 'number', integer: true, minValue: 1, maxValue: 10 }]} />
      )}
      {tab === 'levels' && (
        <ResourceManager<any> managePermission="academics.manage" title="Level" url="/levels" queryKey="levels"
          columns={[{ key: 'name', header: 'Name', render: (r) => r.name }, { key: 'rank', header: 'Order', render: (r) => r.rank }]}
          fields={[{ name: 'name', label: 'Level name', type: 'text', required: true, max: 60 }, { name: 'rank', label: 'Order', type: 'number', integer: true, minValue: 0, maxValue: 100, hint: 'Lower numbers are listed first' }]} />
      )}
      {tab === 'years' && (
        <ResourceManager<any> managePermission="academics.manage" title="Academic year" url="/academic-years" queryKey="years"
          toForm={(r) => ({ ...r, startDate: dateOnly(r.startDate), endDate: dateOnly(r.endDate) })}
          columns={[{ key: 'name', header: 'Name', render: (r) => r.name }, { key: 's', header: 'Starts', render: (r) => fmtDate(r.startDate) }, { key: 'e', header: 'Ends', render: (r) => fmtDate(r.endDate) }, { key: 'c', header: '', render: (r) => (r.isCurrent ? <Badge tone="ACTIVE">Current</Badge> : null) }]}
          fields={[{ name: 'name', label: 'Academic year', type: 'text', required: true, max: 30, wide: true, hint: 'For example 2026/2027' }, { name: 'startDate', label: 'Start date', type: 'date', required: true }, { name: 'endDate', label: 'End date', type: 'date', required: true, after: 'startDate' }, { name: 'isCurrent', label: 'Current academic year', type: 'boolean' }]} />
      )}
      {tab === 'semesters' && (
        <ResourceManager<any> managePermission="academics.manage" title="Semester" url="/semesters" queryKey="semesters"
          toForm={(r) => ({ ...r, startDate: dateOnly(r.startDate), endDate: dateOnly(r.endDate) })}
          columns={[{ key: 'name', header: 'Name', render: (r) => r.name }, { key: 'y', header: 'Year', render: (r) => r.academicYear?.name }, { key: 's', header: 'Starts', render: (r) => fmtDate(r.startDate) }, { key: 'e', header: 'Ends', render: (r) => fmtDate(r.endDate) }]}
          fields={[{ name: 'academicYearId', label: 'Academic year', type: 'ref', url: '/academic-years', optionLabel: (y) => y.name, required: true }, { name: 'name', label: 'Semester name', type: 'text', required: true, max: 60 }, { name: 'startDate', label: 'Start date', type: 'date', required: true }, { name: 'endDate', label: 'End date', type: 'date', required: true, after: 'startDate' }, { name: 'isCurrent', label: 'Current semester', type: 'boolean' }]} />
      )}
      {tab === 'courses' && (
        <ResourceManager<any> {...common} title="Course" url="/courses" queryKey="courses"
          columns={[{ key: 'code', header: 'Code', render: (r) => <span className="font-medium">{r.code}</span> }, { key: 't', header: 'Title', render: (r) => r.title }, { key: 'd', header: 'Department', render: (r) => r.department?.name ?? '—' }, { key: 'l', header: 'Level', render: (r) => r.level?.name ?? '—' }, { key: 'st', header: 'Status', render: (r) => statusBadge(r.status) }]}
          fields={[
            { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'title', label: 'Course title', type: 'text', required: true, max: 150 },
            { name: 'departmentId', label: 'Department', type: 'ref', url: '/departments', optionLabel: (d) => d.name },
            { name: 'programId', label: 'Program', type: 'ref', url: '/programs', optionLabel: (p) => p.name },
            { name: 'levelId', label: 'Level', type: 'ref', url: '/levels', optionLabel: (l) => l.name },
            { name: 'credits', label: 'Credits', type: 'number', integer: true, minValue: 0, maxValue: 100 }, { name: 'description', label: 'Description', type: 'textarea', max: 2000 },
          ]} />
      )}
    </div>
  );
}

export function ClassesPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Classes" description={can('academics.manage') ? 'Teaching groups for courses. Assign lecturers and enroll students.' : 'Classes you are assigned to.'} />
      <ResourceManager<ClassItem>
        title="Class" url="/classes" queryKey="classes" managePermission={["academics.manage", "classes.manage_assigned"]} importResource={can('academics.manage') ? undefined : false} deleteLabel="Archive"
        onRowClick={(r) => nav(`/app/classes/${r.id}`)}
        columns={[
          { key: 'code', header: 'Code', render: (r) => <span className="font-medium">{r.code}</span> },
          { key: 'name', header: 'Class', render: (r) => <div><p>{r.name}</p><p className="text-xs text-slate-500">{r.course ? `${r.course.code} · ${r.course.title}` : ''}</p></div> },
          { key: 'lect', header: 'Lecturers', render: (r) => r.lecturers.map((l) => `${l.lecturer.title ?? ''} ${l.lecturer.lastName}`.trim()).join(', ') || '—' },
          { key: 'n', header: 'Students', render: (r) => r._count.enrollments },
          { key: 'st', header: 'Status', render: (r) => statusBadge(r.status) },
        ]}
        fields={[
          { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Class name', type: 'text', required: true, max: 150 },
          { name: 'courseId', label: 'Course', type: 'ref', url: '/courses', optionLabel: (c) => `${c.code} · ${c.title}` },
          { name: 'semesterId', label: 'Semester', type: 'ref', url: '/semesters', optionLabel: (s) => `${s.academicYear?.name ?? ''} ${s.name}` },
          { name: 'room', label: 'Room / venue', type: 'text', max: 80, wide: true },
          { name: 'venueLocation', label: 'Venue location', type: 'location', latitude: 'defaultLatitude', longitude: 'defaultLongitude' },
        ]}
      />
    </div>
  );
}

type Enrollment = { id: string; student: { id: string; studentNumber: string; fullName: string; email: string | null; status: string; program: { name: string } | null; level: { name: string } | null } };

export function ClassDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const cls = useQuery({ queryKey: ['class', id], queryFn: () => get<ClassItem>(`/classes/${id}`) });
  const roster = usePaged<Enrollment>(`roster-${id}`, `/classes/${id}/students`);
  const lecturers = useOptions<{ id: string; firstName: string; lastName: string; title: string | null }>('/lecturers', (l) => `${l.title ?? ''} ${l.firstName} ${l.lastName}`.trim(), { status: 'ACTIVE' }, can('lecturers.read'));
  const [assignOpen, setAssignOpen] = useState(false);
  const [lecturerId, setLecturerId] = useState('');
  const [enrollOpen, setEnrollOpen] = useState(false);

  const assign = useMutation({
    mutationFn: () => post(`/classes/${id}/lecturers`, { lecturerId, role: 'PRIMARY' }),
    onSuccess: () => { toast.success('Lecturer assigned'); setAssignOpen(false); qc.invalidateQueries({ queryKey: ['class', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unassign = useMutation({
    mutationFn: (lid: string) => del(`/classes/${id}/lecturers/${lid}`),
    onSuccess: () => { toast.success('Lecturer removed'); qc.invalidateQueries({ queryKey: ['class', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const drop = useMutation({
    mutationFn: (eid: string) => del(`/enrollments/${eid}`),
    onSuccess: () => { toast.success('Student removed from class'); qc.invalidateQueries({ queryKey: [`roster-${id}`] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (cls.isLoading) return <Spinner />;
  if (cls.error || !cls.data) return <ErrorState message={errorMessage(cls.error)} />;
  const c = cls.data;
  const canRun = can('attendance.sessions.create') || can('attendance.sessions.manage_all');
  return (
    <div>
      <PageHeader
        title={`${c.course?.code ?? c.code} · ${c.name}`}
        description={c.course?.title}
        back={<BackButton to="/app/classes" label="Back to classes" />}
        actions={
          <>
            {can('reports.read') && <Link to={`/app/reports?classId=${c.id}`}><Button variant="secondary">Attendance report</Button></Link>}
            {canRun && <Link to={`/app/attendance/new?classId=${c.id}`}><Button icon={<QrCode className="h-4 w-4" />}>Start attendance</Button></Link>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lecturers" actions={can('academics.manage') && <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>Assign</Button>}>
          {c.lecturers.length === 0 ? (
            <p className="text-sm text-slate-500">No lecturer assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {c.lecturers.map((l) => (
                <li key={l.lecturerId} className="flex items-center justify-between text-sm">
                  <span><span className="font-medium">{`${l.lecturer.title ?? ''} ${l.lecturer.firstName} ${l.lecturer.lastName}`.trim()}</span><span className="block text-xs text-slate-500">{l.lecturer.email}</span></span>
                  {can('academics.manage') && <Button size="sm" variant="ghost" aria-label="Unassign" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => unassign.mutate(l.lecturerId)} />}
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Room</dt><dd>{c.room ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Semester</dt><dd>{c.semester?.name ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Venue location</dt><dd>{c.defaultLatitude != null ? `${c.defaultLatitude.toFixed(4)}, ${c.defaultLongitude?.toFixed(4)}` : 'Not set'}</dd></div>
          </dl>
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4" /> Enrolled students</span>} className="lg:col-span-2" padded={false}
          actions={(can('students.update') || can('classes.manage_assigned')) && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEnrollOpen(true)}>Enroll students</Button>}>
          <div className="border-b border-slate-100 p-3"><SearchInput value={roster.search} onChange={roster.setSearch} placeholder="Search roster…" /></div>
          <DataTable
            rows={roster.rows}
            loading={roster.isFetching}
            error={roster.errorText}
            empty={<EmptyState title="No students enrolled" />}
            columns={[
              { key: 'id', header: 'ID', render: (e) => <span className="font-mono text-xs">{e.student.studentNumber}</span> },
              { key: 'n', header: 'Name', render: (e) => e.student.fullName },
              { key: 'p', header: 'Program', render: (e) => e.student.program?.name ?? '—' },
              { key: 's', header: 'Status', render: (e) => <Badge>{e.student.status}</Badge> },
              ...(can('students.update') || can('classes.manage_assigned') ? [{ key: 'x', header: '', render: (e: Enrollment) => <Button size="sm" variant="ghost" aria-label="Remove from class" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => drop.mutate(e.id)} /> }] : []),
            ]}
          />
          {roster.meta && <Pagination page={roster.meta.page} totalPages={roster.meta.totalPages} total={roster.meta.total} onPage={roster.setPage} />}
        </Card>
      </div>
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign lecturer" size="sm" footer={<><Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button><Button disabled={!lecturerId} loading={assign.isPending} onClick={() => assign.mutate()}>Assign</Button></>}>
        <Select label="Lecturer" options={lecturers.options} placeholder="Select your lecturer" value={lecturerId} onChange={(e) => setLecturerId(e.target.value)} />
      </Modal>
      <Card title="History" className="mt-6"><RecordHistory targetType="Class" targetId={id} /></Card>
      <EnrollModal open={enrollOpen} onClose={() => setEnrollOpen(false)} url="/enrollments" candidatesUrl={`/classes/${id}/candidates`} body={(ids) => ({ classId: id, studentIds: ids })} onDone={() => qc.invalidateQueries({ queryKey: [`roster-${id}`] })} />
    </div>
  );
}

/** Pick students (search + multi-select) and enroll/register them. Shared by classes and events. */
type Candidate = { id: string; studentNumber: string; fullName: string; email: string | null; program: Ref | null; level: Ref | null; department: Ref | null };

/** Pick students to add — filtered by program, level and search; only students not yet added are listed. */
export function EnrollModal({ open, onClose, url, candidatesUrl, body, onDone, title = 'Enroll students' }: {
  open: boolean; onClose: () => void; url: string; candidatesUrl: string; body: (ids: string[]) => unknown; onDone: () => void; title?: string;
}) {
  const [search, setSearch] = useState('');
  const [programId, setProgramId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const programs = useOptions<Ref>('/programs', (p) => p.name, {}, open);
  const levels = useOptions<Ref>('/levels', (l) => l.name, {}, open);
  const q = useQuery({
    queryKey: ['enroll-candidates', candidatesUrl, search, programId, levelId, page],
    queryFn: () => getPaged<Candidate>(candidatesUrl, { search: search || undefined, programId: programId || undefined, levelId: levelId || undefined, page, pageSize: 50 }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => post(url, body([...picked])),
    onSuccess: () => { toast.success(`${picked.size} student(s) added`); setPicked(new Set()); onDone(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = q.data?.items ?? [];
  const toggle = (sid: string) => setPicked((p) => { const n = new Set(p); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
  const allShown = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={<><span className="mr-auto self-center text-sm font-semibold text-slate-600">{picked.size} selected</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!picked.size} loading={save.isPending} onClick={() => save.mutate()}>Add selected</Button></>}>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-3"><SearchInput value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search by name or student ID…" /></div>
        <Select aria-label="Program" options={programs.options} placeholder="All programs" value={programId} onChange={(e) => reset(() => setProgramId(e.target.value))} />
        <Select aria-label="Level" options={levels.options} placeholder="All levels" value={levelId} onChange={(e) => reset(() => setLevelId(e.target.value))} />
        <Button variant="secondary" disabled={!rows.length} onClick={() => setPicked((p) => { const n = new Set(p); for (const r of rows) { if (allShown) n.delete(r.id); else n.add(r.id); } return n; })}>
          {allShown ? 'Clear shown' : `Select all shown (${rows.length})`}
        </Button>
      </div>
      {q.isLoading ? <Spinner /> : (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">
          {rows.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-slate-300 accent-brand-600" />
                <span className="font-mono text-xs text-slate-600">{s.studentNumber}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{s.fullName}</span>
                <span className="hidden text-right text-xs text-slate-500 sm:block">{[s.program?.name, s.level?.name].filter(Boolean).join(' · ')}</span>
              </label>
            </li>
          ))}
          {rows.length === 0 && <li className="p-6 text-center text-sm text-slate-500">{programId || levelId || search ? 'No students match these filters.' : 'Everyone available has already been added.'}</li>}
        </ul>
      )}
      {q.data && q.data.meta.totalPages > 1 && <Pagination page={page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} onPage={setPage} />}
    </Modal>
  );
}
