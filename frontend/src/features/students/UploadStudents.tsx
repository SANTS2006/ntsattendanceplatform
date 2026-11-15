import { useQuery } from '@tanstack/react-query';
import { get } from '@/api/client';
import { UploadRecords, type UploadTemplate } from '@/components/UploadRecords';
import type { OrgSettings } from '@/types';

/** CSV template whose example IDs follow the organization's configured student-ID format. */
function studentTemplate(s?: OrgSettings): UploadTemplate {
  const len = s?.studentIdExactLength ?? Math.max(s?.studentIdMinLength ?? 8, 8);
  const pre = s?.studentIdPrefix ?? '';
  const suf = s?.studentIdSuffix ?? '';
  const sample = (n: number) => (s?.studentIdExample && n === 1 ? s.studentIdExample : `${pre}${String(20240000 + n).slice(-Math.max(1, len - pre.length - suf.length))}${suf}`);
  return {
    fileName: 'ntsattend-students-template.csv',
    headers: ['Student ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Program', 'Department', 'Level', 'Academic Year'],
    rows: [
      [sample(1), 'Aminata', 'Sesay', 'aminata.sesay@example.edu', '+23276000001', 'BSCCS', 'CS', 'Year 2', '2026/2027'],
      [sample(2), 'Ibrahim', 'Kamara', 'ibrahim.kamara@example.edu', '', 'BSCCS', 'CS', 'Year 2', '2026/2027'],
    ],
  };
}

export function UploadStudents({ onDone }: { onDone: () => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => get<OrgSettings>('/organizations/settings') });
  return (
    <UploadRecords
      base="/students/import"
      singular="student"
      plural="students"
      template={studentTemplate(settings.data)}
      invalidateKeys={['students']}
      onDone={onDone}
      requiredHint="Student ID and a name are required; First/Last or Full Name both work."
    />
  );
}
