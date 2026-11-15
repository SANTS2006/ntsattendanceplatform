import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CloudUpload, DatabaseBackup, Download, HardDrive, History, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { del, errorMessage, get, getPaged, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, PageHeader, Pagination, StatCard } from '@/components/ui';
import { fmtBytes, fmtDateTime, humanize } from '@/utils/format';

type Backup = {
  id: string; kind: 'MANUAL' | 'SCHEDULED' | 'PRE_RESTORE'; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; sizeBytes: number | null;
  rowCounts: Record<string, number> | null; error: string | null; createdAt: string; completedAt: string | null;
  restoredAt: string | null; restoreStatus: string | null; createdBy: string | null; restoredBy: string | null;
};
type Config = { enabled: boolean; destination: string | null; retentionDays: number; intervalHours: number; lastBackupAt: string | null };

const STATUS_TONE = { RUNNING: 'amber', COMPLETED: 'green', FAILED: 'rose' } as const;

export function BackupsPage() {
  const { me } = useAuth();
  const isSuper = me?.platformRole === 'SUPER_ADMIN';
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState<Backup | null>(null);
  const list = useQuery({
    queryKey: ['backups', page],
    queryFn: () => getPaged<Backup>('/platform/backups', { page, pageSize: 20 }),
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'RUNNING' || b.restoreStatus === 'RUNNING') ? 3000 : 30_000),
  });
  const config = (list.data?.meta as unknown as { config?: Config })?.config;
  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] });

  const start = useMutation({ mutationFn: () => post('/platform/backups'), onSuccess: () => { toast.success('Backup started'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({
    mutationFn: () => post(`/platform/backups/${restoring!.id}/restore`, { confirm: confirmText }),
    onSuccess: () => { toast.success('Restore started. A safety backup is taken first.'); setRestoring(null); setConfirmText(''); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (b: Backup) => del(`/platform/backups/${b.id}`), onSuccess: () => { toast.success('Backup deleted'); setDeleting(null); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const download = async (b: Backup) => {
    try {
      const r = await get<{ url: string }>(`/platform/backups/${b.id}/download`);
      window.location.assign(r.url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const running = list.data?.items.some((b) => b.status === 'RUNNING');
  return (
    <div>
      <PageHeader
        title="Backup & recovery"
        description="Full database backups stored in Cloudflare R2. Restores replace all data with the selected backup."
        actions={<Button icon={<CloudUpload className="h-4 w-4" />} loading={start.isPending} disabled={!config?.enabled || running} onClick={() => start.mutate()}>Back up now</Button>}
      />
      {config && !config.enabled && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>Backups are not configured. Set <code className="font-mono">R2_ACCOUNT_ID</code>, <code className="font-mono">R2_ACCESS_KEY_ID</code>, <code className="font-mono">R2_SECRET_ACCESS_KEY</code> and <code className="font-mono">R2_BUCKET</code> on the server, then redeploy.</p>
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Last successful backup" value={<span className="text-base">{config?.lastBackupAt ? fmtDateTime(config.lastBackupAt) : 'Never'}</span>} icon={<History />} />
        <StatCard label="Schedule" value={config ? `Every ${config.intervalHours} h` : '—'} icon={<DatabaseBackup />} tone="slate" />
        <StatCard label="Retention" value={config ? `${config.retentionDays} days` : '—'} icon={<HardDrive />} tone="amber" hint="The 3 newest are always kept" />
        <StatCard label="Destination" value={<span className="text-base break-words">{config?.destination ?? 'Not configured'}</span>} icon={<CloudUpload />} tone="green" />
      </div>
      <Card padded={false} title="Backups">
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={<EmptyState icon={<DatabaseBackup />} title="No backups yet" description="Run the first backup now — scheduled backups follow automatically." />}
          columns={[
            { key: 'c', header: 'Created', render: (b) => <div><p className="font-semibold">{fmtDateTime(b.createdAt)}</p><p className="text-xs text-slate-500">{b.createdBy ?? 'Scheduler'}</p></div> },
            { key: 'k', header: 'Type', render: (b) => humanize(b.kind) },
            { key: 's', header: 'Status', render: (b) => <span title={b.error ?? undefined}><Badge tone={STATUS_TONE[b.status]}>{humanize(b.status)}</Badge></span> },
            { key: 'z', header: 'Size', render: (b) => (b.sizeBytes ? fmtBytes(b.sizeBytes) : '—') },
            { key: 'r', header: 'Rows', render: (b) => (b.rowCounts ? Object.values(b.rowCounts).reduce((a, n) => a + n, 0).toLocaleString() : '—') },
            {
              key: 'rs', header: 'Restore', render: (b) =>
                b.restoreStatus ? <span className="text-xs"><Badge tone={b.restoreStatus === 'COMPLETED' ? 'green' : b.restoreStatus === 'FAILED' ? 'rose' : 'amber'}>{humanize(b.restoreStatus)}</Badge>{b.restoredAt && <span className="ml-1 text-slate-500">{fmtDateTime(b.restoredAt)}</span>}</span> : '—',
            },
            {
              key: 'a', header: '', className: 'text-right', render: (b) => b.status === 'COMPLETED' && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" aria-label="Download" icon={<Download className="h-4 w-4" />} onClick={() => download(b)} />
                  {isSuper && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setRestoring(b); setConfirmText(''); }}>Restore</Button>}
                  {isSuper && <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => setDeleting(b)} />}
                </div>
              ),
            },
          ]}
        />
        {list.data && list.data.meta.totalPages > 1 && <Pagination page={page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      </Card>
      {!isSuper && <p className="mt-3 text-xs text-slate-500">Only Super Admins can restore or delete backups.</p>}

      <Modal
        open={!!restoring}
        onClose={() => setRestoring(null)}
        title="Restore the database"
        footer={<><Button variant="secondary" onClick={() => setRestoring(null)}>Cancel</Button><Button variant="danger" loading={restore.isPending} disabled={confirmText !== 'RESTORE'} onClick={() => restore.mutate()}>Restore now</Button></>}
      >
        {restoring && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-bold">This replaces ALL data in every organization with the backup from {fmtDateTime(restoring.createdAt)}.</p>
                <p className="mt-1">Anything created after that time is lost (a safety backup is taken first, so this can be undone by restoring it). Users may be signed out.</p>
              </div>
            </div>
            <Input label="Type RESTORE to confirm" placeholder="Enter RESTORE" value={confirmText} error={confirmText && confirmText !== 'RESTORE' ? 'Type RESTORE in capital letters' : undefined} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        danger
        title="Delete this backup?"
        confirmLabel="Delete"
        message="The backup file is permanently removed from R2. This cannot be undone."
      />
    </div>
  );
}
