import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MapPin, MapPinOff, Pencil, TriangleAlert } from 'lucide-react';
import { errorMessage, patch } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Modal, Pagination, Select, Textarea, type Column } from '@/components/ui';
import type { PageMeta } from '@/api/client';
import type { AttendanceRecord } from '@/types';

export function RecordsTable({
  rows, meta, loading, error, onRetry, onPage, sort, onSort, showContext = true, queryKey,
}: {
  rows: AttendanceRecord[] | undefined;
  meta?: PageMeta;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onPage?: (p: number) => void;
  sort?: string;
  onSort?: (s: string) => void;
  showContext?: boolean;
  queryKey: string;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [photo, setPhoto] = useState<AttendanceRecord | null>(null);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [status, setStatus] = useState('PRESENT');
  const [reason, setReason] = useState('');
  const correct = useMutation({
    mutationFn: () => patch(`/attendance/records/${editing!.id}`, { status, reason }),
    onSuccess: () => {
      toast.success('Record updated');
      setEditing(null);
      qc.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<AttendanceRecord>[] = [
    {
      key: 'selfie',
      header: 'Photo',
      render: (r) =>
        r.selfieUrl ? (
          <button onClick={() => setPhoto(r)} aria-label={`View photo of ${r.studentNameSnapshot}`}>
            <img src={r.selfieUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />
          </button>
        ) : (
          <div className="h-10 w-10 rounded-lg bg-slate-100" />
        ),
    },
    { key: 'name', header: 'Student', sortKey: 'studentNameSnapshot', render: (r) => <div><p className="font-medium text-slate-900">{r.studentNameSnapshot}</p><p className="text-xs text-slate-500">{r.studentEmailSnapshot ?? ''}</p></div> },
    { key: 'id', header: 'Student ID', sortKey: 'studentNumberSnapshot', render: (r) => <span className="font-mono text-xs">{r.studentNumberSnapshot}</span> },
    { key: 'program', header: 'Program / level', render: (r) => <span className="text-xs">{[r.programSnapshot, r.levelSnapshot].filter(Boolean).join(' · ') || '—'}</span> },
    ...(showContext ? [{ key: 'ctx', header: 'Course / event', render: (r: AttendanceRecord) => <span className="text-xs">{r.contextSnapshot}</span> }] : []),
    { key: 'when', header: 'Date / time', sortKey: 'submittedAt', render: (r) => <span className="text-xs tabular-nums">{r.attendanceDate} {r.attendanceTime}</span> },
    {
      key: 'verify',
      header: 'Verification',
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-xs">
          {r.locationVerified === true && <MapPin className="h-3.5 w-3.5 text-emerald-600" aria-label="Location verified" />}
          {r.locationVerified === false && <MapPinOff className="h-3.5 w-3.5 text-amber-600" aria-label="Location not verified" />}
          {r.verificationMeta?.manual ? 'Manual' : r.distanceM != null ? `${Math.round(r.distanceM)} m` : '—'}
          {!!r.verificationMeta?.flags?.length && <TriangleAlert className="h-3.5 w-3.5 text-amber-500" aria-label={`Flags: ${r.verificationMeta.flags.join(', ')}`} />}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <Badge>{r.status}</Badge> },
  ];
  if (can('attendance.correct')) {
    columns.push({
      key: 'act',
      header: '',
      render: (r) => (
        <Button size="sm" variant="ghost" aria-label="Correct record" icon={<Pencil className="h-4 w-4" />} onClick={() => { setEditing(r); setStatus(r.status); setReason(''); }} />
      ),
    });
  }

  return (
    <>
      <DataTable rows={rows} columns={columns} loading={loading} error={error} onRetry={onRetry} sort={sort} onSort={onSort} empty={<EmptyState title="No attendance records" description="Check-ins will appear here as students submit." />} />
      {meta && onPage && <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onPage={onPage} />}
      <Modal open={!!photo} onClose={() => setPhoto(null)} title={photo?.studentNameSnapshot ?? ''} size="sm">
        {photo?.selfieUrl && <img src={photo.selfieUrl} alt={`Selfie of ${photo.studentNameSnapshot}`} className="w-full rounded-xl" />}
        <p className="mt-3 text-xs text-slate-500">Photo captured at check-in. It is not a biometric identity verification.</p>
      </Modal>
      <ConfirmDialog open={!!editing} onClose={() => setEditing(null)} onConfirm={() => correct.mutate()} loading={correct.isPending} title="Correct attendance record" confirmLabel="Save correction" message={`${editing?.studentNameSnapshot} · ${editing?.referenceNumber}`}>
        <div className="mt-4 space-y-3">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={['PRESENT', 'LATE', 'EXCUSED', 'INVALIDATED'].map((s) => ({ value: s, label: s }))} />
          <Textarea label="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </ConfirmDialog>
    </>
  );
}
