import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Plus, Upload } from 'lucide-react';
import { ApiError, errorMessage, get, patch, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Tabs, BackButton } from '@/components/ui';
import { UploadStudents } from './UploadStudents';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import type { OrgSettings, Ref, Student } from '@/types';
import { fmtDate } from '@/utils/format';
import { RecordHistory } from '@/components/History';
import { StudentStatusButton } from './StudentStatus';

const STATUSES = ['ACTIVE', 'INACTIVE', 'GRADUATED', 'SUSPENDED'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }));

function useLookups() {
  return {
    programs: useOptions<Ref & { code: string; departmentId: string | null }>('/programs', (p) => `${p.code} · ${p.name}`),
    departments: useOptions<Ref>('/departments', (d) => d.name),
    levels: useOptions<Ref>('/levels', (l) => l.name),
    years: useOptions<Ref & { isCurrent: boolean }>('/academic-years', (y) => `${y.name}${y.isCurrent ? ' (current)' : ''}`),
  };
}

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

export function StudentForm({ open, onClose, student }: { open: boolean; onClose: () => void; student?: Student | null }) {
  const qc = useQueryClient();
  const { programs, departments, levels, years } = useLookups();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings') });
  const { can } = useAuth();
  const [tab, setTab] = useState<'single' | 'upload'>('single');
  const uploading = !student && tab === 'upload';
  const form = useForm<Record<string, string>>({ values: student ? {
    studentNumber: student.studentNumber, firstName: student.firstName, lastName: student.lastName, email: student.email ?? '', phone: student.phone ?? '',
    programId: student.programId ?? '', departmentId: student.departmentId ?? '', levelId: student.levelId ?? '', academicYear: student.academicYear ?? '', status: student.status,
  } : { status: 'ACTIVE' } });
  // New students default to the organization's current academic year.
  const currentYear = years.rows.find((y) => y.isCurrent)?.name ?? '';
  useEffect(() => {
    if (open && !student && currentYear && !form.getValues('academicYear')) form.setValue('academicYear', currentYear);
  }, [open, student, currentYear, form]);
  const yearOptions = [
    ...years.rows.map((y) => ({ value: y.name, label: `${y.name}${y.isCurrent ? ' (current)' : ''}` })),
    ...(student?.academicYear && !years.rows.some((y) => y.name === student.academicYear) ? [{ value: student.academicYear, label: student.academicYear }] : []),
  ];
  const s = settings.data;
  const idHint = s ? `${s.studentIdExactLength ? `Exactly ${s.studentIdExactLength}` : `${s.studentIdMinLength}–${s.studentIdMaxLength}`} characters, ${s.studentIdCharset.toLowerCase()}${s.studentIdPrefix ? `, starts with ${s.studentIdPrefix}` : ''}` : undefined;
  /** Mirrors the server's student-ID rules so mistakes show before saving. */
  const checkId = (raw: string) => {
    const v = (raw ?? '').trim();
    if (!v) return 'Enter your student ID';
    if (!s) return true;
    if (s.studentIdExactLength && v.length !== s.studentIdExactLength) return `Student ID must be exactly ${s.studentIdExactLength} characters`;
    if (!s.studentIdExactLength && (v.length < s.studentIdMinLength || v.length > s.studentIdMaxLength)) return `Student ID must be ${s.studentIdMinLength}–${s.studentIdMaxLength} characters`;
    if (s.studentIdPrefix && !v.startsWith(s.studentIdPrefix)) return `Student ID must start with ${s.studentIdPrefix}`;
    if (s.studentIdSuffix && !v.endsWith(s.studentIdSuffix)) return `Student ID must end with ${s.studentIdSuffix}`;
    const core = v.slice(s.studentIdPrefix?.length ?? 0, v.length - (s.studentIdSuffix?.length ?? 0));
    if (s.studentIdCharset === 'NUMERIC' && !/^\d+$/.test(core)) return 'Student ID may only contain digits';
    if (s.studentIdCharset === 'ALPHA' && !/^[A-Za-z]+$/.test(core)) return 'Student ID may only contain letters';
    if (s.studentIdCharset === 'ALPHANUMERIC' && !/^[A-Za-z0-9]+$/.test(core)) return 'Student ID may only contain letters and digits';
    return true;
  };
  const save = useMutation({
    mutationFn: (v: Record<string, string>) => {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val === '' ? null : val]));
      return student ? patch(`/students/${student.id}`, body) : post('/students', body);
    },
    onSuccess: () => {
      toast.success(student ? 'Student updated' : 'Student added');
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student'] });
      onClose();
      form.reset();
    },
    onError: (e) => {
      if (e instanceof ApiError) for (const [k, v] of Object.entries(e.errors)) form.setError(k, { message: Array.isArray(v) ? String(v[0]) : String(v) });
      toast.error(errorMessage(e));
    },
  });
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;
  // Programs are chosen after the department and only those under it are offered.
  const departmentId = form.watch('departmentId') ?? '';
  const programOptions = programs.rows
    .filter((p) => p.departmentId === departmentId)
    .map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
  const departmentField = form.register('departmentId', { required: 'Select a department' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={student ? 'Edit student' : 'Add students'}
      size={uploading ? 'xl' : 'lg'}
      footer={uploading ? undefined : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Save student</Button></>}
    >
      {!student && can('students.import') && (
        <Tabs tabs={[{ key: 'single', label: 'Enter details' }, { key: 'upload', label: 'Upload a file' }]} active={tab} onChange={(k) => setTab(k as 'single' | 'upload')} />
      )}
      {uploading ? (
        <UploadStudents onDone={() => { setTab('single'); onClose(); }} />
      ) : (
      <form noValidate className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Input label="Student ID *" hint={idHint} error={err('studentNumber')} {...form.register('studentNumber', { setValueAs: trim, validate: checkId })} />
        <Select label="Status" options={STATUSES} {...form.register('status')} />
        <Input label="First name *" autoComplete="off" error={err('firstName')} {...form.register('firstName', { setValueAs: trim, required: 'Enter your first name', maxLength: { value: 80, message: 'First name must be at most 80 characters' } })} />
        <Input label="Last name *" autoComplete="off" error={err('lastName')} {...form.register('lastName', { setValueAs: trim, required: 'Enter your last name', maxLength: { value: 80, message: 'Last name must be at most 80 characters' } })} />
        <Input label="Email address *" type="email" error={err('email')} {...form.register('email', { setValueAs: trim, required: 'Enter the student email address', pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, message: 'Enter a valid email address' }, maxLength: { value: 254, message: 'Email is too long' } })} />
        <Input label="Phone number" type="tel" error={err('phone')} {...form.register('phone', { setValueAs: trim, pattern: { value: /^\+?[0-9 ()-]{6,30}$/, message: 'Enter a valid phone number' } })} />
        <Select
          label="Department *"
          options={departments.options}
          placeholder="Select your department"
          error={err('departmentId')}
          {...departmentField}
          onChange={(e) => {
            void departmentField.onChange(e);
            // A program from the previous department no longer applies.
            const keep = programs.rows.some((p) => p.id === form.getValues('programId') && p.departmentId === e.target.value);
            if (!keep) form.setValue('programId', '');
          }}
        />
        <Select
          label="Program *"
          options={programOptions}
          placeholder={!departmentId ? 'Select a department first' : programOptions.length ? 'Select your program' : 'No programs in this department'}
          disabled={!departmentId || programOptions.length === 0}
          hint={departmentId && !programs.loading && programOptions.length === 0 ? 'Add programs to this department under Academic structure.' : undefined}
          error={err('programId')}
          {...form.register('programId', { required: 'Select a program' })}
        />
        <Select label="Academic level *" options={levels.options} placeholder="Select your academic level" error={err('levelId')} {...form.register('levelId', { required: 'Select an academic level' })} />
        {yearOptions.length ? (
          <Select label="Academic year" options={yearOptions} placeholder="Select your academic year" error={err('academicYear')} {...form.register('academicYear')} />
        ) : (
          <Input label="Academic year" hint="For example 2026/2027 — add academic years under Academic structure" error={err('academicYear')} {...form.register('academicYear', { setValueAs: trim, maxLength: { value: 30, message: 'Academic year must be at most 30 characters' } })} />
        )}
        <button type="submit" hidden />
      </form>
      )}
    </Modal>
  );
}

export function StudentsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { programs, departments, levels } = useLookups();
  const [f, setF] = useState({ programId: '', departmentId: '', levelId: '', status: '' });
  const list = usePaged<Student>('students', '/students', f);
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <PageHeader
        title="Students"
        description="Students and participants who can check in to your sessions."
        actions={
          <>
            {can('students.import') && <Link to="/app/students/import"><Button variant="secondary" icon={<Upload className="h-4 w-4" />}>Import</Button></Link>}
            {can('students.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add students</Button>}
          </>
        }
      />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name, ID or email…" />
          <Select aria-label="Program" options={programs.options} placeholder="All programs" value={f.programId} onChange={(e) => setF({ ...f, programId: e.target.value })} />
          <Select aria-label="Department" options={departments.options} placeholder="All departments" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} />
          <Select aria-label="Level" options={levels.options} placeholder="All levels" value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })} />
          <Select aria-label="Status" options={STATUSES} placeholder="Any status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} />
        </div>
        <DataTable
          rows={list.rows}
          loading={list.isFetching}
          error={list.errorText}
          onRetry={() => list.refetch()}
          sort={list.sort}
          onSort={list.setSort}
          onRowClick={(s) => nav(`/app/students/${s.id}`)}
          empty={<EmptyState title={list.search ? 'No matching students' : 'No students yet'} description="Add students one by one or import a CSV/Excel file." action={can('students.import') && !list.search ? <Link to="/app/students/import"><Button>Import students</Button></Link> : undefined} />}
          columns={[
            { key: 'id', header: 'Student ID', sortKey: 'studentNumber', render: (s) => <span className="font-mono text-xs">{s.studentNumber}</span> },
            { key: 'name', header: 'Name', sortKey: 'fullName', render: (s) => <span className="font-medium text-slate-900">{s.fullName}</span> },
            { key: 'email', header: 'Email', render: (s) => s.email ?? '—' },
            { key: 'program', header: 'Program', render: (s) => s.program?.name ?? '—' },
            { key: 'level', header: 'Level', render: (s) => s.level?.name ?? '—' },
            { key: 'status', header: 'Status', render: (s) => <Badge>{s.status}</Badge> },
          ]}
        />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
      <StudentForm open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

type StudentDetail = Student & {
  enrollments: { id: string; status: string; class: { id: string; name: string; code: string; course: { code: string; title: string } | null } }[];
  _count: { attendance: number };
};

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can, org } = useAuth();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['student', id], queryFn: () => get<StudentDetail>(`/students/${id}`) });
  const history = usePaged<{ id: string; referenceNumber: string; submittedAt: string; status: string; contextSnapshot: string; locationVerified: boolean | null }>(`student-att-${id}`, `/students/${id}/attendance`);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} />;
  const s = q.data;
  return (
    <div>
      <PageHeader
        title={s.fullName}
        description={`${s.studentNumber}${s.email ? ` · ${s.email}` : ''}`}
        back={<BackButton onClick={() => nav(-1)} label="Go back" />}
        actions={
          <>
            <Badge>{s.status}</Badge>
            {can('students.update') && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
            <StudentStatusButton student={s} />
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-3 text-sm">
            {[['Program', s.program?.name], ['Department', s.department?.name], ['Level', s.level?.name], ['Academic year', s.academicYear], ['Phone', s.phone], ['Added', fmtDate(s.createdAt, org?.timezone)], ['Check-ins', String(s._count.attendance)]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right font-medium text-slate-800">{v || '—'}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Enrollments" className="lg:col-span-2" padded={false}>
          {s.enrollments.length === 0 ? (
            <EmptyState title="Not enrolled in any class" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <Link className="font-medium text-slate-800 hover:text-brand-700" to={`/app/classes/${e.class.id}`}>{e.class.course ? `${e.class.course.code} — ${e.class.course.title}` : e.class.name} <span className="text-slate-400">({e.class.code})</span></Link>
                  <Badge>{e.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Attendance history" className="mt-6" padded={false}>
        <DataTable
          rows={history.rows}
          loading={history.isFetching}
          error={history.errorText}
          empty={<EmptyState title="No attendance yet" />}
          columns={[
            { key: 'ref', header: 'Reference', render: (r) => <span className="font-mono text-xs">{r.referenceNumber}</span> },
            { key: 'ctx', header: 'Course / event', render: (r) => r.contextSnapshot },
            { key: 'when', header: 'When', render: (r) => new Date(r.submittedAt).toLocaleString(undefined, { timeZone: org?.timezone }) },
            { key: 'loc', header: 'Location', render: (r) => (r.locationVerified == null ? '—' : r.locationVerified ? 'Verified' : 'Unverified') },
            { key: 'st', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
          ]}
        />
        {history.meta && <Pagination page={history.meta.page} totalPages={history.meta.totalPages} total={history.meta.total} onPage={history.setPage} />}
      </Card>
      <Card title="History" className="mt-6">
        <RecordHistory targetType="Student" targetId={s.id} perspective="student" />
      </Card>
      <StudentForm open={editing} onClose={() => setEditing(false)} student={s} />
    </div>
  );
}
