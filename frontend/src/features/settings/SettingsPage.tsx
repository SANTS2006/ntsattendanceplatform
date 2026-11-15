import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailField, opt, phoneField, req, urlField } from '@/lib/validation';
import toast from 'react-hot-toast';
import { ImageUp, Mail, Plus, Shield, Trash2 } from 'lucide-react';
import { del, errorMessage, get, http, patch, post, put } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Tabs, Textarea, Toggle } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import type { Member, OrgSettings, Permission, Ref, Role } from '@/types';
import { fmtDateTime, timeZones } from '@/utils/format';

export function SettingsPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tabs = [
    can('organization.manage') && { key: 'profile', label: 'Organization profile' },
    can('settings.manage') && { key: 'student-id', label: 'Student ID' },
    can('settings.manage') && { key: 'attendance', label: 'Attendance & location' },
    can('members.read') && { key: 'members', label: 'Users' },
    (can('roles.manage') || can('members.read')) && { key: 'roles', label: 'Roles & permissions' },
    can('audit.read') && { key: 'audit', label: 'Audit log' },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = sp.get('tab') && tabs.some((t) => t.key === sp.get('tab')) ? sp.get('tab')! : tabs[0]?.key;
  return (
    <div>
      <PageHeader title="Settings" description="Configuration applies only to your organization." />
      <Tabs tabs={tabs} active={tab ?? ''} onChange={(k) => setSp({ tab: k })} />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'student-id' && <StudentIdTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

const orgSchema = z.object({
  name: req('organization name', 150),
  officialEmail: emailField,
  contactNumber: phoneField,
  country: req('country', 80),
  address: opt('address', 300),
  timezone: z.string().min(1, 'Select your time zone'),
  website: urlField,
  description: opt('description', 2000),
});

const NUM_RANGE = (v: unknown, min: number, max: number, label: string, optional = false) => {
  if (v === null || v === undefined || v === '' || Number.isNaN(v)) return optional ? undefined : `Enter the ${label}`;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? undefined : `${label.charAt(0).toUpperCase() + label.slice(1)} must be a whole number from ${min} to ${max}`;
};
const firstError = (e: Record<string, string | undefined>) => Object.values(e).find(Boolean);

function ProfileTab() {
  const { org, reload } = useAuth();
  const form = useForm<z.infer<typeof orgSchema>>({ resolver: zodResolver(orgSchema), values: { name: org?.name ?? '', officialEmail: org?.officialEmail ?? '', contactNumber: org?.contactNumber ?? '', country: org?.country ?? '', address: org?.address ?? '', timezone: org?.timezone ?? 'UTC', website: org?.website ?? '', description: org?.description ?? '' } });
  const save = useMutation({
    mutationFn: (v: Record<string, string | undefined>) => patch('/organizations/current', v),
    onSuccess: async () => { toast.success('Profile saved'); await reload(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const fe = form.formState.errors;
  const upload = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Choose a PNG, JPEG or WebP image');
    if (file.size > 5 * 1024 * 1024) return toast.error('The logo must be 5 MB or smaller');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await http.post('/organizations/current/logo', fd);
      toast.success('Logo updated');
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Logo">
        <div className="flex flex-col items-center gap-4">
          {org?.logoUrl ? <img src={org.logoUrl} alt="Organization logo" className="h-32 w-32 rounded-xl border border-slate-200 object-contain" /> : <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-brand-50 text-4xl font-semibold text-brand-700">{org?.name[0]}</div>}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            <ImageUp className="h-4 w-4" /> Upload logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <p className="text-xs text-slate-500">PNG, JPEG or WebP up to 5 MB.</p>
        </div>
      </Card>
      <Card title="Profile" className="lg:col-span-2">
        <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x || undefined]))))}>
          <div className="sm:col-span-2"><Input label="Organization name *" error={fe.name?.message} {...form.register('name')} /></div>
          <Input label="Official email *" type="email" error={fe.officialEmail?.message} {...form.register('officialEmail')} />
          <Input label="Contact number" type="tel" error={fe.contactNumber?.message} {...form.register('contactNumber')} />
          <Input label="Country *" error={fe.country?.message} {...form.register('country')} />
          <Select label="Time zone *" options={timeZones().map((tz) => ({ value: tz, label: tz }))} error={fe.timezone?.message} {...form.register('timezone')} />
          <div className="sm:col-span-2"><Input label="Address" error={fe.address?.message} {...form.register('address')} /></div>
          <div className="sm:col-span-2"><Input label="Website" type="url" error={fe.website?.message} {...form.register('website')} /></div>
          <div className="sm:col-span-2"><Textarea label="Description" error={fe.description?.message} {...form.register('description')} /></div>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>Save changes</Button></div>
        </form>
      </Card>
    </div>
  );
}

function useSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings') });
  const save = useMutation({
    mutationFn: (v: Partial<OrgSettings>) => patch<OrgSettings>('/organizations/settings', v),
    onSuccess: (d) => { qc.setQueryData(['settings'], d); toast.success('Settings saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { q, save };
}

function StudentIdTab() {
  const { q, save } = useSettings();
  const [s, setS] = useState<OrgSettings | null>(null);
  const [mode, setMode] = useState<'exact' | 'range'>('exact');
  useEffect(() => {
    if (q.data) {
      setS(q.data);
      setMode(q.data.studentIdExactLength != null ? 'exact' : 'range');
    }
  }, [q.data]);
  const preview = useMemo(() => {
    if (!s) return '';
    const len = s.studentIdExactLength ?? s.studentIdMaxLength;
    return `0/${len}`;
  }, [s]);
  const [tried, setTried] = useState(false);
  if (!s) return <Spinner />;
  const up = (patchV: Partial<OrgSettings>) => setS({ ...s, ...patchV });
  const affix = (s.studentIdPrefix?.length ?? 0) + (s.studentIdSuffix?.length ?? 0);
  const idErr: Record<string, string | undefined> = {
    exact: mode === 'exact' ? NUM_RANGE(s.studentIdExactLength, 1, 64, 'exact length') ?? (s.studentIdExactLength! <= affix ? 'Length must be longer than the prefix and suffix combined' : undefined) : undefined,
    min: mode === 'range' ? NUM_RANGE(s.studentIdMinLength, 1, 64, 'minimum length') : undefined,
    max: mode === 'range' ? NUM_RANGE(s.studentIdMaxLength, 1, 64, 'maximum length') ?? (s.studentIdMaxLength < s.studentIdMinLength ? 'Maximum must be at least the minimum length' : undefined) : undefined,
    custom: s.studentIdCharset === 'CUSTOM' && !s.studentIdCustomPattern?.trim() ? 'Enter your custom character set' : s.studentIdCustomPattern && !/^[A-Za-z0-9\-_/. ]+$/.test(s.studentIdCustomPattern) ? 'Use only letters, digits, ranges and - _ / .' : undefined,
    prefix: s.studentIdPrefix && s.studentIdPrefix.length > 20 ? 'Prefix must be at most 20 characters' : undefined,
    suffix: s.studentIdSuffix && s.studentIdSuffix.length > 20 ? 'Suffix must be at most 20 characters' : undefined,
    example: s.studentIdExample && s.studentIdExample.length > 64 ? 'Example must be at most 64 characters' : undefined,
  };
  const ie = (k: string) => (tried ? idErr[k] : undefined);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Student ID format" className="lg:col-span-2">
        <div className="space-y-4">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'exact'} onChange={() => { setMode('exact'); up({ studentIdExactLength: s.studentIdExactLength ?? 8 }); }} /> Exact length</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'range'} onChange={() => { setMode('range'); up({ studentIdExactLength: null }); }} /> Length range</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {mode === 'exact' ? (
              <Input label="Exact length *" type="number" min={1} max={64} error={ie('exact')} value={s.studentIdExactLength ?? ''} onChange={(e) => up({ studentIdExactLength: Number(e.target.value) || null })} />
            ) : (
              <>
                <Input label="Minimum length *" type="number" min={1} max={64} error={ie('min')} value={s.studentIdMinLength} onChange={(e) => up({ studentIdMinLength: Number(e.target.value) })} />
                <Input label="Maximum length *" type="number" min={1} max={64} error={ie('max')} value={s.studentIdMaxLength} onChange={(e) => up({ studentIdMaxLength: Number(e.target.value) })} />
              </>
            )}
            <Select label="Allowed characters" value={s.studentIdCharset} onChange={(e) => up({ studentIdCharset: e.target.value as OrgSettings['studentIdCharset'] })} options={[{ value: 'NUMERIC', label: 'Digits only' }, { value: 'ALPHA', label: 'Letters only' }, { value: 'ALPHANUMERIC', label: 'Letters and digits' }, { value: 'CUSTOM', label: 'Custom set' }]} />
          </div>
          {s.studentIdCharset === 'CUSTOM' && <Input label="Custom character set *" error={ie('custom')} hint="Letters, digits, ranges and - _ / . e.g. A-Z0-9/-" value={s.studentIdCustomPattern ?? ''} onChange={(e) => up({ studentIdCustomPattern: e.target.value || null })} />}
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Prefix" maxLength={20} error={ie('prefix')} value={s.studentIdPrefix ?? ''} onChange={(e) => up({ studentIdPrefix: e.target.value || null })} />
            <Input label="Suffix" maxLength={20} error={ie('suffix')} value={s.studentIdSuffix ?? ''} onChange={(e) => up({ studentIdSuffix: e.target.value || null })} />
            <Input label="Example (shown to students)" maxLength={64} error={ie('example')} value={s.studentIdExample ?? ''} onChange={(e) => up({ studentIdExample: e.target.value || null })} />
          </div>
          <Toggle label="Case sensitive" description="When off, ab123 and AB123 are the same ID." checked={s.studentIdCaseSensitive} onChange={(v) => up({ studentIdCaseSensitive: v })} />
          <Toggle label="Allow spaces" checked={s.studentIdAllowSpaces} onChange={(v) => up({ studentIdAllowSpaces: v })} />
          <div className="flex justify-end">
            <Button loading={save.isPending} onClick={() => { setTried(true); const e = firstError(idErr); if (e) return toast.error(e); save.mutate({
              studentIdExactLength: mode === 'exact' ? s.studentIdExactLength : null, studentIdMinLength: s.studentIdMinLength, studentIdMaxLength: s.studentIdMaxLength,
              studentIdCharset: s.studentIdCharset, studentIdCustomPattern: s.studentIdCustomPattern, studentIdPrefix: s.studentIdPrefix, studentIdSuffix: s.studentIdSuffix,
              studentIdCaseSensitive: s.studentIdCaseSensitive, studentIdAllowSpaces: s.studentIdAllowSpaces, studentIdExample: s.studentIdExample,
            }); }}>Save student ID rules</Button>
          </div>
        </div>
      </Card>
      <Card title="Student view preview">
        <p className="mb-2 text-sm text-slate-500">Students see a live counter and verification starts automatically once the ID is complete.</p>
        <div className="relative"><input className="input font-mono" placeholder={s.studentIdExample ?? ''} readOnly aria-label="Preview" /><span className="absolute top-1/2 right-3 -translate-y-1/2 font-mono text-sm text-slate-400">{preview}</span></div>
      </Card>
    </div>
  );
}

function AttendanceTab() {
  const { q, save } = useSettings();
  const [s, setS] = useState<OrgSettings | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  if (!s) return <Spinner />;
  const up = (v: Partial<OrgSettings>) => setS({ ...s, ...v });
  const attErr: Record<string, string | undefined> = {
    defaultGeofenceRadiusM: NUM_RANGE(s.defaultGeofenceRadiusM, 14, 20, 'radius'),
    minGpsAccuracyM: NUM_RANGE(s.minGpsAccuracyM, 1, 10000, 'GPS accuracy'),
    maxFailedLocationAttempts: NUM_RANGE(s.maxFailedLocationAttempts, 1, 100, 'number of attempts'),
    defaultQrExpiryMin: NUM_RANGE(s.defaultQrExpiryMin, 1, 1440, 'QR expiry'),
    defaultSessionDurationMin: NUM_RANGE(s.defaultSessionDurationMin, 1, 1440, 'session duration'),
    lateAfterMin: NUM_RANGE(s.lateAfterMin, 1, 1440, 'late threshold', true),
    imageRetentionDays: NUM_RANGE(s.imageRetentionDays, 1, 3650, 'retention period'),
  };
  const ae = (k: string) => (tried ? attErr[k] : undefined);
  const num = (k: keyof OrgSettings) => (e: { target: { value: string } }) => up({ [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<OrgSettings>);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Location verification">
        <Toggle label="Location verification is mandatory" description="Students must share a location within the session radius." checked={s.locationRequired} onChange={(v) => up({ locationRequired: v })} />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Input label="Default geofence radius (m)" hint="Between 14 and 20 metres." type="number" min={14} max={20} error={ae('defaultGeofenceRadiusM')} value={s.defaultGeofenceRadiusM} onChange={num('defaultGeofenceRadiusM')} />
          <Input label="Minimum GPS accuracy (m)" type="number" min={1} max={10000} error={ae('minGpsAccuracyM')} value={s.minGpsAccuracyM} onChange={num('minGpsAccuracyM')} />
          <Input label="Max failed location checks" type="number" min={1} max={100} error={ae('maxFailedLocationAttempts')} value={s.maxFailedLocationAttempts} onChange={num('maxFailedLocationAttempts')} hint="Per device, per session, within 15 minutes." />
        </div>
      </Card>
      <Card title="Sessions & QR codes">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Default QR expiry (minutes)" type="number" min={1} max={1440} error={ae('defaultQrExpiryMin')} value={s.defaultQrExpiryMin} onChange={num('defaultQrExpiryMin')} />
          <Input label="Default session duration (minutes)" type="number" min={1} max={1440} error={ae('defaultSessionDurationMin')} value={s.defaultSessionDurationMin} onChange={num('defaultSessionDurationMin')} />
          <Input label="Mark late after (minutes)" type="number" min={1} max={1440} error={ae('lateAfterMin')} hint="Leave empty to never mark as late." value={s.lateAfterMin ?? ''} onChange={num('lateAfterMin')} />
        </div>
        <Toggle label="Allow late attendance" checked={s.allowLateAttendance} onChange={(v) => up({ allowLateAttendance: v })} />
        <Toggle label="Only enrolled / registered students may check in" checked={s.requireEnrollment} onChange={(v) => up({ requireEnrollment: v })} />
      </Card>
      <Card title="Selfies & privacy">
        <Toggle label="Require a selfie" description="Photos are a deterrent and audit aid — not biometric verification." checked={s.selfieRequired} onChange={(v) => up({ selfieRequired: v })} />
        <Input label="Delete selfies after (days)" type="number" min={1} max={3650} error={ae('imageRetentionDays')} value={s.imageRetentionDays} onChange={num('imageRetentionDays')} />
      </Card>
      <div className="flex items-end justify-end">
        <Button loading={save.isPending} onClick={() => { setTried(true); const e = firstError(attErr); if (e) return toast.error(e); save.mutate({
          locationRequired: s.locationRequired, defaultGeofenceRadiusM: s.defaultGeofenceRadiusM, minGpsAccuracyM: s.minGpsAccuracyM, maxFailedLocationAttempts: s.maxFailedLocationAttempts,
          defaultQrExpiryMin: s.defaultQrExpiryMin, defaultSessionDurationMin: s.defaultSessionDurationMin, lateAfterMin: s.lateAfterMin, allowLateAttendance: s.allowLateAttendance,
          requireEnrollment: s.requireEnrollment, selfieRequired: s.selfieRequired, imageRetentionDays: s.imageRetentionDays,
        }); }}>Save attendance settings</Button>
      </div>
    </div>
  );
}

function MembersTab() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const list = usePaged<Member>('members', '/organizations/members');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
  const departments = useOptions<Ref>('/departments', (d) => d.name);
  const invites = useQuery({ queryKey: ['invitations'], queryFn: () => get<{ id: string; email: string; role: { name: string }; expiresAt: string; expired: boolean }[]>('/organizations/invitations') });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inv, setInv] = useState({ email: '', roleId: '', departmentId: '', createLecturer: false });
  const [editing, setEditing] = useState<Member | null>(null);
  const [roleRows, setRoleRows] = useState<{ roleId: string; departmentId: string }[]>([]);
  const manage = can('members.manage');

  const sendInvite = useMutation({
    mutationFn: () => post('/organizations/invitations', { ...inv, departmentId: inv.departmentId || null }),
    onSuccess: () => { toast.success('Invitation sent'); setInviteOpen(false); setInv({ email: '', roleId: '', departmentId: '', createLecturer: false }); qc.invalidateQueries({ queryKey: ['invitations'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/organizations/invitations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }) });
  const setStatus = useMutation({
    mutationFn: (m: Member) => patch(`/organizations/members/${m.id}`, { status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
    onSuccess: () => { toast.success('Member updated'); qc.invalidateQueries({ queryKey: ['members'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveRoles = useMutation({
    mutationFn: () => put(`/organizations/members/${editing!.id}/roles`, { roles: roleRows.filter((r) => r.roleId).map((r) => ({ roleId: r.roleId, departmentId: r.departmentId || null })) }),
    onSuccess: () => { toast.success('Roles updated'); setEditing(null); qc.invalidateQueries({ queryKey: ['members'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.id, label: r.name }));
  const [invTried, setInvTried] = useState(false);
  const invErr = {
    email: !inv.email.trim() ? 'Enter your email address' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(inv.email.trim()) ? 'Enter a valid email address' : undefined,
    roleId: !inv.roleId ? 'Select your role' : undefined,
  };
  const submitInvite = () => { setInvTried(true); if (!invErr.email && !invErr.roleId) sendInvite.mutate(); };
  const roleRowsErr = roleRows.some((r) => !r.roleId) ? 'Select a role for every row, or remove empty rows' : undefined;

  return (
    <div className="space-y-6">
      <Card padded={false} title="Members" actions={manage && <Button size="sm" icon={<Mail className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite user</Button>}>
        <div className="border-b border-slate-100 p-3"><SearchInput value={list.search} onChange={list.setSearch} /></div>
        <DataTable
          rows={list.rows}
          loading={list.isFetching}
          error={list.errorText}
          columns={[
            { key: 'n', header: 'User', render: (m) => <div><p className="font-medium">{m.user.firstName} {m.user.lastName} {m.isOwner && <Badge tone="GRADUATED">Owner</Badge>}</p><p className="text-xs text-slate-500">{m.user.email}</p></div> },
            { key: 'r', header: 'Roles', render: (m) => <div className="flex flex-wrap gap-1">{m.roles.map((r) => <Badge key={r.id} tone="slate">{r.role.name}{r.department ? ` · ${r.department.name}` : ''}</Badge>)}</div> },
            { key: 'l', header: 'Last sign-in', render: (m) => fmtDateTime(m.user.lastLoginAt) },
            { key: 's', header: 'Status', render: (m) => <Badge>{m.status}</Badge> },
            ...(manage ? [{
              key: 'a', header: '', render: (m: Member) => !m.isOwner && m.user.id !== me?.user.id && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setRoleRows(m.roles.map((r) => ({ roleId: r.roleId, departmentId: r.departmentId ?? '' }))); }}>Roles</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus.mutate(m)}>{m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button>
                </div>
              ),
            }] : []),
          ]}
        />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
      {!!invites.data?.length && (
        <Card title="Pending invitations" padded={false}>
          <DataTable rows={invites.data} columns={[
            { key: 'e', header: 'Email', render: (i) => i.email }, { key: 'r', header: 'Role', render: (i) => i.role.name },
            { key: 'x', header: 'Expires', render: (i) => (i.expired ? <Badge tone="EXPIRED">Expired</Badge> : fmtDateTime(i.expiresAt)) },
            ...(manage ? [{ key: 'd', header: '', render: (i: { id: string }) => <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button> }] : []),
          ]} />
        </Card>
      )}
      <Modal open={inviteOpen} onClose={() => { setInviteOpen(false); setInvTried(false); }} title="Invite a user" footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button><Button loading={sendInvite.isPending} onClick={submitInvite}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Input label="Email address *" type="email" maxLength={254} error={invTried ? invErr.email : undefined} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
          <Select label="Role *" options={roleOptions} placeholder="Select your role" error={invTried ? invErr.roleId : undefined} value={inv.roleId} onChange={(e) => setInv({ ...inv, roleId: e.target.value, createLecturer: roles.data?.find((r) => r.id === e.target.value)?.key === 'lecturer' })} />
          <Select label="Limit to department (optional)" options={departments.options} placeholder="Whole organization" value={inv.departmentId} onChange={(e) => setInv({ ...inv, departmentId: e.target.value })} />
          <Toggle label="Create a lecturer profile" description="Lets this user be assigned to classes and run attendance." checked={inv.createLecturer} onChange={(v) => setInv({ ...inv, createLecturer: v })} />
          <p className="text-xs text-slate-500">Invitations are single-use and expire after 7 days.</p>
        </div>
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Roles — ${editing?.user.firstName ?? ''}`} footer={<Button loading={saveRoles.isPending} onClick={() => (roleRowsErr ? toast.error(roleRowsErr) : saveRoles.mutate())}>Save roles</Button>}>
        <div className="space-y-3">
          {roleRows.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">This member will have no roles and can only see their own account.</p>}
          {roleRows.map((r, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-2xl border border-slate-100 p-3 sm:flex-row sm:items-end sm:border-0 sm:p-0">
              <div className="flex-1"><Select label="Role" options={roleOptions} placeholder="Select your role" value={r.roleId} onChange={(e) => setRoleRows(roleRows.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))} /></div>
              <div className="flex-1"><Select label="Scope" options={departments.options} placeholder="Whole organization" value={r.departmentId} onChange={(e) => setRoleRows(roleRows.map((x, j) => (j === i ? { ...x, departmentId: e.target.value } : x)))} /></div>
              <Button variant="ghost" aria-label="Remove role" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => setRoleRows(roleRows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRoleRows([...roleRows, { roleId: '', departmentId: '' }])}>Add role</Button>
        </div>
      </Modal>
    </div>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => get<Permission[]>('/permissions') });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Role | null>(null);
  const groups = useMemo(() => {
    const g = new Map<string, Permission[]>();
    for (const p of perms.data ?? []) g.set(p.group, [...(g.get(p.group) ?? []), p]);
    return [...g.entries()];
  }, [perms.data]);
  const open = (r: Role | 'new') => {
    setEditing(r);
    setName(r === 'new' ? '' : r.name);
    setDescription(r === 'new' ? '' : r.description ?? '');
    setSelected(new Set(r === 'new' ? [] : r.permissions));
  };
  const save = useMutation({
    mutationFn: () => (editing === 'new' ? post('/roles', { name, description, permissions: [...selected] }) : patch(`/roles/${(editing as Role).id}`, { name, description, permissions: [...selected] })),
    onSuccess: () => { toast.success('Role saved'); setEditing(null); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (r: Role) => del(`/roles/${r.id}`),
    onSuccess: () => { toast.success('Role deleted'); setDeleting(null); qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const readOnly = editing !== 'new' && editing !== null && editing.isSystem;
  const [roleTried, setRoleTried] = useState(false);
  const roleErr = {
    name: !name.trim() ? 'Enter your role name' : name.trim().length > 60 ? 'Role name must be at most 60 characters' : (roles.data ?? []).some((r) => r.name.toLowerCase() === name.trim().toLowerCase() && (editing === 'new' || r.id !== editing?.id)) ? 'A role with this name already exists' : undefined,
    description: description.length > 300 ? 'Description must be at most 300 characters' : undefined,
    perms: selected.size === 0 ? 'Choose at least one permission' : undefined,
  };
  const submitRole = () => { setRoleTried(true); const e = roleErr.name ?? roleErr.description ?? roleErr.perms; if (e) return toast.error(e); save.mutate(); };
  return (
    <Card padded={false} title="Roles" actions={can('roles.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>Custom role</Button>}>
      {roles.isLoading ? <Spinner /> : (
        <DataTable rows={roles.data} onRowClick={open} columns={[
          { key: 'n', header: 'Role', render: (r) => <div><p className="font-medium">{r.name} {r.isSystem && <Shield className="ml-1 inline h-3.5 w-3.5 text-slate-400" aria-label="System role" />}</p><p className="text-xs text-slate-500">{r.description}</p></div> },
          { key: 'p', header: 'Permissions', render: (r) => r.permissions.length },
          { key: 'm', header: 'Members', render: (r) => r.memberCount },
          { key: 'x', header: '', render: (r) => !r.isSystem && can('roles.manage') && <Button size="sm" variant="ghost" aria-label="Delete role" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={(e) => { e.stopPropagation(); setDeleting(r); }} /> },
        ]} />
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New custom role' : readOnly ? `${(editing as Role)?.name} (system role)` : 'Edit role'} size="lg"
        footer={!readOnly && can('roles.manage') && <Button loading={save.isPending} onClick={submitRole}>Save role</Button>}>
        <div className="space-y-4">
          {readOnly && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">System roles cannot be edited. Create a custom role to tailor permissions.</p>}
          <Input label="Role name *" maxLength={60} error={roleTried ? roleErr.name : undefined} value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
          <Input label="Description" maxLength={300} error={roleTried ? roleErr.description : undefined} value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} />
          {roleTried && roleErr.perms && !readOnly && <p className="text-sm font-medium text-rose-600">{roleErr.perms}</p>}
          {groups.map(([g, ps]) => (
            <fieldset key={g} disabled={readOnly}>
              <legend className="mb-2 text-sm font-semibold text-slate-700">{g}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ps.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                    <input type="checkbox" className="mt-0.5 rounded border-slate-300" checked={selected.has(p.key)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })} />
                    <span><span className="block font-mono text-xs text-slate-500">{p.key}</span>{p.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting)} loading={remove.isPending} danger title="Delete role?" message="Roles must be unassigned from all members first." confirmLabel="Delete" />
    </Card>
  );
}

type Audit = { id: string; action: string; targetType: string | null; targetId: string | null; createdAt: string; actorType: string; actor: { firstName: string; lastName: string; email: string } | null; metadata: unknown };

function AuditTab() {
  const { org } = useAuth();
  const [action, setAction] = useState('');
  const list = usePaged<Audit>('audit', '/organizations/audit-logs', { action: action || undefined }, { pageSize: 30 });
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 p-3"><SearchInput value={action} onChange={setAction} placeholder="Filter by action prefix, e.g. student." /></div>
      <DataTable rows={list.rows} loading={list.isFetching} error={list.errorText} empty={<EmptyState title="No audit events" />} columns={[
        { key: 't', header: 'When', render: (a) => fmtDateTime(a.createdAt, org?.timezone) },
        { key: 'a', header: 'Action', render: (a) => <span className="font-mono text-xs">{a.action}</span> },
        { key: 'u', header: 'Actor', render: (a) => (a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : a.actorType.toLowerCase()) },
        { key: 'g', header: 'Target', render: (a) => (a.targetType ? `${a.targetType}` : '—') },
      ]} />
      {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
    </Card>
  );
}
