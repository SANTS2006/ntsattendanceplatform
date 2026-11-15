import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { ArrowRightLeft, BadgeCheck, GraduationCap, PauseCircle, PowerOff } from 'lucide-react';
import { errorMessage, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Modal, Textarea } from '@/components/ui';

type Status = 'ACTIVE' | 'INACTIVE' | 'GRADUATED' | 'SUSPENDED';

const OPTIONS: { value: Status; label: string; description: string; icon: typeof BadgeCheck; tone: string }[] = [
  { value: 'ACTIVE', label: 'Active', description: 'Can check in to sessions (reactivates the student).', icon: BadgeCheck, tone: 'emerald' },
  { value: 'SUSPENDED', label: 'Suspended', description: 'Temporarily blocked from checking in.', icon: PauseCircle, tone: 'amber' },
  { value: 'GRADUATED', label: 'Graduated', description: 'Completed their studies; kept for records.', icon: GraduationCap, tone: 'brand' },
  { value: 'INACTIVE', label: 'Inactive', description: 'Deactivated; history is kept.', icon: PowerOff, tone: 'slate' },
];

const TONES: Record<string, string> = {
  emerald: 'text-emerald-700 bg-emerald-50', amber: 'text-amber-700 bg-amber-50', brand: 'text-brand-700 bg-brand-50', slate: 'text-slate-600 bg-slate-100',
};

/** "Change status" button + dialog (reactivate, suspend, graduate, deactivate) with an optional reason. */
export function StudentStatusButton({ student, size = 'md' }: { student: { id: string; status: string; fullName: string }; size?: 'sm' | 'md' }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<Status | null>(null);
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: () => post(`/students/${student.id}/status`, { status: next, reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success(`${student.fullName} is now ${next!.toLowerCase()}`);
      setOpen(false);
      setReason('');
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student', student.id] });
      qc.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can('students.update') && !can('students.delete')) return null;
  const allowed = OPTIONS.filter((o) => o.value !== student.status && (o.value === 'INACTIVE' ? can('students.delete') : can('students.update')));
  if (!allowed.length) return null;
  return (
    <>
      <Button size={size} variant="secondary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => { setNext(allowed[0].value); setOpen(true); }}>
        {student.status === 'ACTIVE' ? 'Change status' : 'Change status / reactivate'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Change status — ${student.fullName}`}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={change.isPending} disabled={!next} onClick={() => change.mutate()}>Save status</Button></>}
      >
        <p className="mb-3 text-sm text-slate-600">Current status: <strong className="text-navy-900">{student.status.charAt(0) + student.status.slice(1).toLowerCase()}</strong></p>
        <div className="grid gap-2" role="radiogroup" aria-label="New status">
          {allowed.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={next === o.value}
              onClick={() => setNext(o.value)}
              className={clsx('flex items-start gap-3 rounded-2xl border p-3 text-left transition', next === o.value ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-slate-200 hover:border-slate-300')}
            >
              <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONES[o.tone])}><o.icon className="h-5 w-5" /></span>
              <span>
                <span className="block text-sm font-bold text-navy-900">{o.value === 'ACTIVE' ? 'Reactivate (Active)' : o.label}</span>
                <span className="block text-xs text-slate-600">{o.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Textarea label="Reason (optional)" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Saved in the student’s history.</p>
        </div>
      </Modal>
    </>
  );
}
