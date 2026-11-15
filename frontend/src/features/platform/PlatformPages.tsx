import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Building2, ClipboardCheck, Database, GraduationCap, HardDrive, ShieldAlert, UserCog, Users } from 'lucide-react';
import { errorMessage, get, patch, post, put } from '@/api/client';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, PageHeader, Pagination, SearchInput, Select, Spinner, StatCard, Textarea, BackButton } from '@/components/ui';
import { usePaged } from '@/hooks/usePaged';
import { ORG_TYPES, fmtBytes, fmtDateTime, fmtNumber } from '@/utils/format';

type Dashboard = {
  organizations: { total: number; active: number; suspended: number; deactivated: number };
  users: number; students: number; lecturers: number; attendanceSessions: number; attendanceSubmissions: number; submissionsLast24h: number;
  storage: { selfieBytes: number }; security: { openIncidents: number; highSeverityOpen: number };
};
type Health = Record<string, { ok?: boolean; latencyMs?: number; mode?: string; error?: string } | Record<string, unknown>>;

export function PlatformDashboardPage() {
  const q = useQuery({ queryKey: ['platform', 'dashboard'], queryFn: () => get<Dashboard>('/platform/dashboard') });
  const health = useQuery({ queryKey: ['platform', 'health'], queryFn: () => get<Health>('/platform/system-health'), refetchInterval: 30_000 });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Platform overview" description="All organizations on NTS." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organizations" value={fmtNumber(d.organizations.total)} hint={`${d.organizations.active} active · ${d.organizations.suspended} suspended`} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Users" value={fmtNumber(d.users)} icon={<Users className="h-5 w-5" />} tone="slate" />
        <StatCard label="Students" value={fmtNumber(d.students)} icon={<GraduationCap className="h-5 w-5" />} tone="slate" />
        <StatCard label="Lecturers" value={fmtNumber(d.lecturers)} icon={<UserCog className="h-5 w-5" />} tone="slate" />
        <StatCard label="Attendance sessions" value={fmtNumber(d.attendanceSessions)} icon={<Activity className="h-5 w-5" />} tone="green" />
        <StatCard label="Submissions" value={fmtNumber(d.attendanceSubmissions)} hint={`${fmtNumber(d.submissionsLast24h)} in last 24 h`} icon={<ClipboardCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="Selfie storage" value={fmtBytes(d.storage.selfieBytes)} icon={<HardDrive className="h-5 w-5" />} tone="amber" />
        <StatCard label="Open security incidents" value={d.security.openIncidents} hint={`${d.security.highSeverityOpen} high severity`} icon={<ShieldAlert className="h-5 w-5" />} tone={d.security.highSeverityOpen ? 'rose' : 'slate'} />
      </div>
      <Card title="System health" className="mt-6">
        {health.isLoading ? <Spinner /> : health.data ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {(['database', 'redis', 'storage'] as const).map((k) => {
              const h = health.data[k] as { ok?: boolean; latencyMs?: number; mode?: string; error?: string };
              return (
                <div key={k} className="rounded-lg border border-slate-200 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium capitalize"><Database className="h-4 w-4 text-slate-400" /> {k}</p>
                  <p className="mt-2"><Badge tone={h?.ok ? 'ACTIVE' : 'FAILED'}>{h?.ok ? 'Healthy' : 'Unhealthy'}</Badge></p>
                  <p className="mt-1 text-xs text-slate-500">{h?.mode ?? (h?.latencyMs != null ? `${h.latencyMs} ms` : '')}{h?.error ? ` · ${h.error}` : ''}</p>
                </div>
              );
            })}
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:col-span-3">{JSON.stringify({ jobs: health.data.jobs, process: health.data.process }, null, 2)}</pre>
          </div>
        ) : <ErrorState message="Health check unavailable" />}
      </Card>
    </div>
  );
}

type Org = { id: string; name: string; slug: string; type: string; status: string; officialEmail: string; country: string; createdAt: string; _count: { memberships: number; students: number } };

export function PlatformOrganizationsPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const list = usePaged<Org>('platform-orgs', '/platform/organizations', { status: status || undefined, type: type || undefined });
  return (
    <div>
      <PageHeader title="Organizations" />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name, email or slug…" />
          <Select aria-label="Status" options={['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].map((s) => ({ value: s, label: s }))} placeholder="Any status" value={status} onChange={(e) => setStatus(e.target.value)} />
          <Select aria-label="Type" options={ORG_TYPES} placeholder="Any type" value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <DataTable rows={list.rows} loading={list.isFetching} error={list.errorText} onRowClick={(o) => nav(`/platform/organizations/${o.id}`)} columns={[
          { key: 'n', header: 'Organization', render: (o) => <div><p className="font-medium">{o.name}</p><p className="text-xs text-slate-500">{o.officialEmail}</p></div> },
          { key: 't', header: 'Type', render: (o) => ORG_TYPES.find((t) => t.value === o.type)?.label },
          { key: 'c', header: 'Country', render: (o) => o.country },
          { key: 'm', header: 'Members', render: (o) => o._count.memberships },
          { key: 's', header: 'Students', render: (o) => o._count.students },
          { key: 'd', header: 'Created', render: (o) => fmtDateTime(o.createdAt) },
          { key: 'st', header: 'Status', render: (o) => <Badge>{o.status}</Badge> },
        ]} />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
    </div>
  );
}

type OrgDetail = Org & { address: string | null; timezone: string; website: string | null; statusReason: string | null; owner: { email: string; firstName: string; lastName: string } | null; usage: Record<string, number> };

export function PlatformOrganizationDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'org', id], queryFn: () => get<OrgDetail>(`/platform/organizations/${id}`) });
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: () => patch(`/platform/organizations/${id}/status`, { status: target, reason }),
    onSuccess: () => { toast.success('Status updated'); setTarget(null); setReason(''); qc.invalidateQueries({ queryKey: ['platform'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} />;
  const o = q.data;
  return (
    <div>
      <PageHeader
        title={o.name}
        description={`${ORG_TYPES.find((t) => t.value === o.type)?.label} · ${o.country} · created ${fmtDateTime(o.createdAt)}`}
        back={<BackButton to="/platform/organizations" label="Back to organizations" />}
        actions={
          <>
            <Badge>{o.status}</Badge>
            {o.status !== 'ACTIVE' && <Button onClick={() => setTarget('ACTIVE')}>{o.status === 'SUSPENDED' ? 'Reactivate' : 'Activate'}</Button>}
            {o.status === 'ACTIVE' && <Button variant="danger" onClick={() => setTarget('SUSPENDED')}>Suspend</Button>}
            {o.status !== 'DEACTIVATED' && <Button variant="secondary" onClick={() => setTarget('DEACTIVATED')}>Deactivate</Button>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details">
          <dl className="space-y-2 text-sm">
            {[['Owner', o.owner ? `${o.owner.firstName} ${o.owner.lastName} (${o.owner.email})` : '—'], ['Official email', o.officialEmail], ['Time zone', o.timezone], ['Website', o.website], ['Address', o.address], ['Status reason', o.statusReason]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="font-medium break-words text-slate-800">{v || '—'}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Usage" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Object.entries(o.usage).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</p><p className="text-lg font-semibold tabular-nums">{k === 'selfieBytes' ? fmtBytes(v) : fmtNumber(v)}</p></div>
            ))}
          </div>
        </Card>
      </div>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} onConfirm={() => change.mutate()} loading={change.isPending} danger={target !== 'ACTIVE'} title={`Set status to ${target}?`} confirmLabel="Confirm"
        message={target === 'SUSPENDED' ? 'All members lose access immediately and its QR codes stop working. This action is audited.' : 'This action is audited.'}>
        <div className="mt-3"><Textarea label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </ConfirmDialog>
    </div>
  );
}

type PUser = { id: string; email: string; firstName: string; lastName: string; status: string; emailVerifiedAt: string | null; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string; platformAdmin: { role: string } | null; _count: { memberships: number } };

export function PlatformUsersPage() {
  const qc = useQueryClient();
  const list = usePaged<PUser>('platform-users', '/platform/users');
  const [target, setTarget] = useState<PUser | null>(null);
  const [reason, setReason] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const change = useMutation({
    mutationFn: () => patch(`/platform/users/${target!.id}/status`, { status: target!.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason }),
    onSuccess: () => { toast.success('User updated'); setTarget(null); setReason(''); qc.invalidateQueries({ queryKey: ['platform-users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const grant = useMutation({
    mutationFn: () => post('/platform/admins', { email: grantEmail, role: 'PLATFORM_ADMIN' }),
    onSuccess: () => { toast.success('Platform access granted'); setGrantEmail(''); qc.invalidateQueries({ queryKey: ['platform-users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Platform users" />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-end sm:justify-between">
          <SearchInput value={list.search} onChange={list.setSearch} />
          <div className="flex items-end gap-2">
            <Input label="Grant platform admin (Super Admin only)" type="email" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} />
            <Button variant="secondary" disabled={!grantEmail} loading={grant.isPending} onClick={() => grant.mutate()}>Grant</Button>
          </div>
        </div>
        <DataTable rows={list.rows} loading={list.isFetching} error={list.errorText} columns={[
          { key: 'n', header: 'User', render: (u) => <div><p className="font-medium">{u.firstName} {u.lastName} {u.platformAdmin && <Badge tone="GRADUATED">{u.platformAdmin.role.replace('_', ' ')}</Badge>}</p><p className="text-xs text-slate-500">{u.email}</p></div> },
          { key: 'o', header: 'Orgs', render: (u) => u._count.memberships },
          { key: 'v', header: 'Verified', render: (u) => (u.emailVerifiedAt ? 'Yes' : 'No') },
          { key: 'm', header: 'MFA', render: (u) => (u.mfaEnabled ? 'On' : 'Off') },
          { key: 'l', header: 'Last sign-in', render: (u) => fmtDateTime(u.lastLoginAt) },
          { key: 's', header: 'Status', render: (u) => <Badge>{u.status}</Badge> },
          { key: 'a', header: '', render: (u) => <Button size="sm" variant="ghost" onClick={() => setTarget(u)}>{u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button> },
        ]} />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} onConfirm={() => change.mutate()} loading={change.isPending} danger={target?.status === 'ACTIVE'} title={`${target?.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${target?.email}?`} message="Suspension signs the user out of every device. This action is audited.">
        <div className="mt-3"><Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </ConfirmDialog>
    </div>
  );
}

type Analytics = { submissions: { date: string; count: number }[]; userSignups: { date: string; count: number }[]; organizationSignups: { date: string; count: number }[]; auditedActions: { date: string; count: number }[]; topOrganizations: { organizationId: string; name: string; submissions: number }[] };

export function PlatformAnalyticsPage() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['platform', 'analytics', days], queryFn: () => get<Analytics>('/platform/analytics', { days }) });
  return (
    <div>
      <PageHeader title="Usage analytics" actions={<Select aria-label="Range" options={['7', '30', '90', '365'].map((d) => ({ value: d, label: `Last ${d} days` }))} value={days} onChange={(e) => setDays(e.target.value)} />} />
      {q.isLoading ? <Spinner /> : q.data && (
        <div className="grid gap-6 lg:grid-cols-2">
          {([['Attendance submissions', q.data.submissions], ['API activity (audited actions)', q.data.auditedActions], ['New users', q.data.userSignups], ['New organizations', q.data.organizationSignups]] as const).map(([title, data]) => (
            <Card key={title} title={title}>
              {data.length ? <div className="h-56"><ResponsiveContainer><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} /><Tooltip /><Line dataKey="count" stroke="#7c3aed" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <EmptyState title="No activity" />}
            </Card>
          ))}
          <Card title="Most active organizations" className="lg:col-span-2">
            {q.data.topOrganizations.length ? <div className="h-64"><ResponsiveContainer><BarChart data={q.data.topOrganizations}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} width={40} /><Tooltip /><Bar dataKey="submissions" fill="#7c3aed" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div> : <EmptyState title="No submissions" />}
          </Card>
        </div>
      )}
    </div>
  );
}

type SecEvent = { id: string; type: string; severity: string; description: string; organizationId: string | null; createdAt: string; resolvedAt: string | null };

export function PlatformSecurityPage() {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState('');
  const [open, setOpen] = useState('true');
  const list = usePaged<SecEvent>('platform-security', '/platform/security-events', { severity: severity || undefined, open: open || undefined });
  const resolve = useMutation({ mutationFn: (id: string) => post(`/platform/security-events/${id}/resolve`), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-security'] }) });
  return (
    <div>
      <PageHeader title="Security monitoring" description="Account lockouts, token reuse, enumeration attempts and suspicious location activity." />
      <Card padded={false}>
        <div className="flex gap-3 border-b border-slate-100 p-4">
          <Select aria-label="Severity" options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => ({ value: s, label: s }))} placeholder="Any severity" value={severity} onChange={(e) => setSeverity(e.target.value)} />
          <Select aria-label="State" options={[{ value: 'true', label: 'Open' }, { value: 'false', label: 'Resolved' }]} placeholder="All" value={open} onChange={(e) => setOpen(e.target.value)} />
        </div>
        <DataTable rows={list.rows} loading={list.isFetching} error={list.errorText} empty={<EmptyState title="No incidents" />} columns={[
          { key: 't', header: 'When', render: (e) => fmtDateTime(e.createdAt) },
          { key: 's', header: 'Severity', render: (e) => <Badge>{e.severity}</Badge> },
          { key: 'y', header: 'Type', render: (e) => <span className="font-mono text-xs">{e.type}</span> },
          { key: 'd', header: 'Description', render: (e) => <span className="text-xs whitespace-normal">{e.description}</span> },
          { key: 'a', header: '', render: (e) => (e.resolvedAt ? <Badge tone="COMPLETED">Resolved</Badge> : <Button size="sm" variant="ghost" onClick={() => resolve.mutate(e.id)}>Resolve</Button>) },
        ]} />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
    </div>
  );
}

type Audit = { id: string; action: string; actorType: string; actorUserId: string | null; organizationId: string | null; targetType: string | null; targetId: string | null; ip: string | null; createdAt: string };

export function PlatformAuditPage() {
  const [action, setAction] = useState('');
  const list = usePaged<Audit>('platform-audit', '/platform/audit-logs', { action: action || undefined }, { pageSize: 40 });
  return (
    <div>
      <PageHeader title="Audit logs" description="Append-only record of privileged and sensitive actions across the platform." />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-4"><SearchInput value={action} onChange={setAction} placeholder="Action prefix, e.g. platform." /></div>
        <DataTable rows={list.rows} loading={list.isFetching} error={list.errorText} columns={[
          { key: 't', header: 'When', render: (a) => fmtDateTime(a.createdAt) },
          { key: 'a', header: 'Action', render: (a) => <span className="font-mono text-xs">{a.action}</span> },
          { key: 'y', header: 'Actor', render: (a) => <Badge tone="slate">{a.actorType}</Badge> },
          { key: 'o', header: 'Organization', render: (a) => (a.organizationId ? <Link className="text-brand-700" to={`/platform/organizations/${a.organizationId}`}>{a.organizationId.slice(0, 8)}</Link> : '—') },
          { key: 'g', header: 'Target', render: (a) => (a.targetType ? `${a.targetType} ${a.targetId?.slice(0, 8) ?? ''}` : '—') },
          { key: 'i', header: 'IP', render: (a) => a.ip ?? '—' },
        ]} />
        {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}
      </Card>
    </div>
  );
}

type Setting = { key: string; value: unknown; updatedAt: string };

export function PlatformSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'settings'], queryFn: () => get<Setting[]>('/platform/settings') });
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => {
      let v: unknown = value;
      try { v = JSON.parse(value); } catch { /* keep as string */ }
      return put(`/platform/settings/${key}`, { value: v });
    },
    onSuccess: () => { toast.success('Setting saved'); setKey(''); setValue(''); qc.invalidateQueries({ queryKey: ['platform', 'settings'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title="Platform settings" description="Key/value configuration (e.g. maintenance banners, plan limits once billing is introduced). Changes are audited." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Set a value">
          <div className="space-y-3">
            <Input label="Key" value={key} onChange={(e) => setKey(e.target.value)} />
            <Textarea label="Value (JSON or text)" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button disabled={!/^[a-z][a-z0-9_.]{1,60}$/.test(key)} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </div>
        </Card>
        <Card title="Current settings" className="lg:col-span-2" padded={false}>
          <DataTable rows={q.data?.map((s) => ({ ...s, id: s.key }))} loading={q.isLoading} empty={<EmptyState title="No platform settings yet" />} columns={[
            { key: 'k', header: 'Key', render: (s) => <button className="font-mono text-xs text-brand-700" onClick={() => { setKey(s.key); setValue(JSON.stringify(s.value)); }}>{s.key}</button> },
            { key: 'v', header: 'Value', render: (s) => <code className="text-xs">{JSON.stringify(s.value)}</code> },
            { key: 'u', header: 'Updated', render: (s) => fmtDateTime(s.updatedAt) },
          ]} />
        </Card>
      </div>
    </div>
  );
}
