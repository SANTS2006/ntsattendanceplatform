import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, RefreshCw, SlidersHorizontal, UploadCloud } from 'lucide-react';
import { errorMessage, get, http, post, type ApiSuccess } from '@/api/client';
import { LogoSpinner } from '@/components/brand';
import { Badge, Button, Select } from '@/components/ui';
import { humanize } from '@/utils/format';

type FieldInfo = { key: string; label: string; required: boolean };
type UploadResult = { id: string; fileName: string; totalRows: number; headers: string[]; suggestedMapping: Record<string, string>; fields: (string | FieldInfo)[] };
type Row = { line: number; status: 'new' | 'existing' | 'error'; values: Record<string, string>; errors: string[] };
type Preview = {
  totalRows: number; validRows: number; invalidRows: number; newRecords: number; existingRecords: number;
  columns: { key: string; label: string }[]; table: Row[]; tableTruncated: boolean;
};
type ImportStatus = { status: string; successCount: number; failureCount: number; errorReportUrl: string | null };

export type UploadTemplate = { fileName: string; headers: string[]; rows: string[][] };

const clean = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v));
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function downloadCsv(t: UploadTemplate) {
  const csv = [t.headers, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: t.fileName });
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_BADGE: Record<Row['status'], { tone: string; label: string }> = {
  new: { tone: 'green', label: 'New' },
  existing: { tone: 'blue', label: 'Exists' },
  error: { tone: 'rose', label: 'Error' },
};

/**
 * Upload → review (column matching, per-row validation table) → background import → result.
 * Works with both `/students/import` and the generic `/imports/<resource>` endpoints.
 */
export function UploadRecords({
  base, singular, plural, template, invalidateKeys, onDone, requiredHint,
}: {
  base: string;
  singular: string;
  plural: string;
  template: UploadTemplate;
  invalidateKeys: string[];
  onDone: () => void;
  requiredHint?: string;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<'pick' | 'review' | 'importing' | 'done'>('pick');
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<'all' | Row['status']>('all');
  const [showMapping, setShowMapping] = useState(false);
  const [mode, setMode] = useState<'create_only' | 'upsert'>('create_only');

  const fields: FieldInfo[] = useMemo(
    () => (upload?.fields ?? []).map((f) => (typeof f === 'string' ? { key: f, label: humanize(f.replace(/([A-Z])/g, '_$1')), required: f === 'studentNumber' } : f)),
    [upload],
  );

  const status = useQuery({
    queryKey: ['import-status', base, upload?.id],
    queryFn: () => get<ImportStatus>(`${base}/${upload!.id}`),
    enabled: stage === 'importing' && !!upload,
    refetchInterval: (q) => (q.state.data && ['COMPLETED', 'FAILED'].includes(q.state.data.status) ? false : 1200),
  });
  useEffect(() => {
    if (stage === 'importing' && status.data && ['COMPLETED', 'FAILED'].includes(status.data.status)) {
      setStage('done');
      for (const k of invalidateKeys) qc.invalidateQueries({ queryKey: [k] });
      qc.invalidateQueries({ queryKey: ['options'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (status.data.status === 'COMPLETED') toast.success(`${status.data.successCount} ${status.data.successCount === 1 ? singular : plural} imported`);
    }
  }, [stage, status.data, qc, invalidateKeys, singular, plural]);

  const runPreview = async (u: UploadResult, m: Record<string, string>) => {
    setBusy(true);
    try {
      setPreview(await post<Preview>(`${base}/${u.id}/preview`, { mapping: clean(m), table: true }));
    } catch (e) {
      setPreview(null);
      toast.error(errorMessage(e));
      setShowMapping(true);
    } finally {
      setStage('review');
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    if (!/\.(csv|xlsx)$/i.test(file.name)) return toast.error('Upload a .csv or .xlsx file');
    if (file.size > 10 * 1024 * 1024) return toast.error('Files must be 10 MB or smaller');
    if (file.size === 0) return toast.error('This file is empty');
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = (await http.post<ApiSuccess<UploadResult>>(base, fd)).data.data;
      setUpload(r);
      setMapping(r.suggestedMapping);
      const req = r.fields.map((f) => (typeof f === 'string' ? (f === 'studentNumber' ? f : null) : f.required ? f.key : null)).filter(Boolean) as string[];
      if (req.some((k) => !r.suggestedMapping[k])) setShowMapping(true);
      await runPreview(r, r.suggestedMapping);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      await post(`${base}/${upload!.id}/commit`, { mapping: clean(mapping), mode });
      setStage('importing');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => (preview?.table ?? []).filter((r) => filter === 'all' || r.status === filter), [preview, filter]);
  const willAdd = preview ? preview.newRecords + (mode === 'upsert' ? preview.existingRecords : 0) : 0;

  if (stage === 'pick') {
    return (
      <div className="space-y-4">
        <label
          className={clsx(
            'group flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-4 py-10 text-center transition sm:p-10',
            dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-gradient-to-br from-slate-50 to-brand-50/40 hover:border-brand-300',
          )}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
        >
          {busy ? (
            <LogoSpinner size="md" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)] transition group-hover:scale-105">
              <UploadCloud className="h-8 w-8" />
            </span>
          )}
          <p className="mt-4 font-bold text-navy-900">{busy ? 'Reading your file…' : `Drop your ${singular} list here, or click to browse`}</p>
          <p className="mt-1 text-sm text-slate-500">CSV or Excel (.xlsx) · up to 10 MB · first row must contain column headings</p>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center">
          <p className="text-sm text-slate-600">
            Columns: <span className="font-semibold">{template.headers.join(', ')}</span>.{requiredHint && <> {requiredHint}</>}
          </p>
          <Button size="sm" variant="secondary" className="shrink-0" icon={<Download className="h-4 w-4" />} onClick={() => downloadCsv(template)}>
            Download template
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'importing' || stage === 'done') {
    const d = status.data;
    return (
      <div className="flex flex-col items-center py-10 text-center">
        {stage === 'importing' ? (
          <>
            <LogoSpinner size="lg" />
            <p className="mt-5 font-bold text-navy-900">Importing {willAdd} {willAdd === 1 ? singular : plural}…</p>
            <p className="text-sm text-slate-500">This runs in the background — you can close this window.</p>
          </>
        ) : (
          <>
            <span className={clsx('animate-pop flex h-20 w-20 items-center justify-center rounded-full', d?.status === 'COMPLETED' ? 'bg-emerald-50' : 'bg-rose-50')}>
              {d?.status === 'COMPLETED' ? <CheckCircle2 className="h-12 w-12 text-check" /> : <AlertCircle className="h-12 w-12 text-rose-500" />}
            </span>
            <p className="mt-4 text-lg font-extrabold text-navy-900">{d?.status === 'COMPLETED' ? 'Import complete' : 'Import failed'}</p>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-emerald-700">{d?.successCount ?? 0}</span> added or updated · <span className="font-bold text-rose-600">{d?.failureCount ?? 0}</span> skipped
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {d?.errorReportUrl && (
                <a href={d.errorReportUrl}>
                  <Button variant="secondary" icon={<Download className="h-4 w-4" />}>Download error report</Button>
                </a>
              )}
              <Button onClick={onDone}>Done</Button>
            </div>
          </>
        )}
      </div>
    );
  }

  const cols = preview?.columns ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-navy-800">
          <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-600" /> <span className="truncate">{upload?.fileName}</span>
        </p>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { setStage('pick'); setPreview(null); setUpload(null); setFilter('all'); }}>
          Choose another file
        </Button>
      </div>

      {preview && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { k: 'all', label: 'Rows', value: preview.totalRows, cls: 'from-navy-700 to-brand-700' },
            { k: 'new', label: 'New', value: preview.newRecords, cls: 'from-emerald-500 to-check' },
            { k: 'existing', label: 'Already exist', value: preview.existingRecords, cls: 'from-brand-600 to-cyan-brand' },
            { k: 'error', label: 'Errors', value: preview.invalidRows, cls: 'from-rose-600 to-pink-500' },
          ].map((c) => (
            <button
              key={c.k}
              onClick={() => setFilter(c.k as typeof filter)}
              className={clsx('rounded-2xl p-3 text-left text-white shadow-sm transition', `bg-gradient-to-br ${c.cls}`, filter === c.k ? 'ring-4 ring-brand-200' : 'opacity-90 hover:opacity-100')}
              aria-pressed={filter === c.k}
            >
              <p className="text-[11px] font-bold tracking-wider uppercase opacity-80">{c.label}</p>
              <p className="text-2xl font-extrabold tabular-nums">{c.value.toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200">
        <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-navy-800" onClick={() => setShowMapping((s) => !s)} aria-expanded={showMapping}>
          <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-brand-600" /> Adjust column matching</span>
          <ChevronDown className={clsx('h-4 w-4 transition', showMapping && 'rotate-180')} />
        </button>
        {showMapping && upload && (
          <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <Select
                key={f.key}
                label={`${f.label}${f.required ? ' *' : ''}`}
                options={upload.headers.map((h) => ({ value: h, label: h }))}
                placeholder="— Not in file —"
                value={mapping[f.key] ?? ''}
                error={f.required && !mapping[f.key] ? 'Choose the column for this field' : undefined}
                onChange={(e) => {
                  const m = { ...mapping, [f.key]: e.target.value };
                  setMapping(m);
                  void runPreview(upload, m);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="relative max-h-[22rem] overflow-auto rounded-2xl border border-slate-200">
        {busy && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <LogoSpinner size="md" />
          </div>
        )}
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-slate-50">
            <tr>
              {['Line', 'Status', ...cols.map((c) => c.label), 'Notes'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.line} className={clsx(r.status === 'error' ? 'bg-rose-50/50' : 'hover:bg-brand-50/30')}>
                <td className="table-td font-mono text-xs text-slate-400">{r.line}</td>
                <td className="table-td"><Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge></td>
                {cols.map((c, i) => (
                  <td key={c.key} className={clsx('table-td', i === 0 && 'font-semibold text-navy-900')}>{r.values?.[c.key] || '—'}</td>
                ))}
                <td className="table-td max-w-xs !whitespace-normal text-xs">
                  {r.errors.length ? <span className="font-medium text-rose-600">{r.errors.join('; ')}</span> : r.status === 'existing' ? <span className="text-slate-500">{mode === 'upsert' ? 'Will be updated' : 'Will be skipped'}</span> : <span className="text-emerald-600">Ready</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 3} className="p-8 text-center text-sm text-slate-500">{preview ? 'No rows in this view.' : 'Match the required columns above to preview your data.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {preview?.tableTruncated && <p className="text-xs text-slate-500">Showing the first rows only. All {preview.totalRows.toLocaleString()} rows will be processed.</p>}

      <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" checked={mode === 'create_only'} onChange={() => setMode('create_only')} /> Skip {plural} that already exist</label>
          <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" checked={mode === 'upsert'} onChange={() => setMode('upsert')} /> Update {plural} that already exist</label>
        </div>
        <Button size="lg" loading={busy} disabled={!preview || willAdd === 0} onClick={commit} icon={<UploadCloud className="h-5 w-5" />}>
          Import {willAdd.toLocaleString()} {willAdd === 1 ? singular : plural}
        </Button>
      </div>
    </div>
  );
}

/** Ready-made CSV templates for every generic import resource. */
export const IMPORT_TEMPLATES: Record<string, UploadTemplate & { singular: string; plural: string; queryKey: string }> = {
  faculties: { singular: 'faculty', plural: 'faculties', queryKey: 'faculties', fileName: 'ntsattend-faculties.csv', headers: ['Faculty name', 'Code'], rows: [['Faculty of Engineering', 'ENG'], ['Faculty of Science', 'SCI']] },
  departments: { singular: 'department', plural: 'departments', queryKey: 'departments', fileName: 'ntsattend-departments.csv', headers: ['Department name', 'Code', 'Faculty'], rows: [['Computer Science', 'CS', 'SCI'], ['Civil Engineering', 'CE', 'ENG']] },
  programs: { singular: 'program', plural: 'programs', queryKey: 'programs', fileName: 'ntsattend-programs.csv', headers: ['Program name', 'Code', 'Department', 'Duration (years)'], rows: [['BSc Computer Science', 'BSCCS', 'CS', '4'], ['BEng Civil Engineering', 'BENGCE', 'CE', '5']] },
  levels: { singular: 'level', plural: 'levels', queryKey: 'levels', fileName: 'ntsattend-levels.csv', headers: ['Level name', 'Order'], rows: [['Year 1', '1'], ['Year 2', '2']] },
  'academic-years': { singular: 'academic year', plural: 'academic years', queryKey: 'academic-years', fileName: 'ntsattend-academic-years.csv', headers: ['Academic year', 'Start date', 'End date', 'Current'], rows: [['2026/2027', '2026-09-01', '2027-07-31', 'yes']] },
  semesters: { singular: 'semester', plural: 'semesters', queryKey: 'semesters', fileName: 'ntsattend-semesters.csv', headers: ['Academic year', 'Semester name', 'Start date', 'End date', 'Current'], rows: [['2026/2027', 'First semester', '2026-09-01', '2027-01-31', 'yes'], ['2026/2027', 'Second semester', '2027-02-15', '2027-07-31', 'no']] },
  courses: { singular: 'course', plural: 'courses', queryKey: 'courses', fileName: 'ntsattend-courses.csv', headers: ['Code', 'Course title', 'Department', 'Program', 'Level', 'Credits', 'Description'], rows: [['CS201', 'Data Structures', 'CS', 'BSCCS', 'Year 2', '3', 'Lists, trees and graphs']] },
  classes: { singular: 'class', plural: 'classes', queryKey: 'classes', fileName: 'ntsattend-classes.csv', headers: ['Code', 'Class name', 'Course', 'Room / venue'], rows: [['CS201-A', 'Data Structures — Group A', 'CS201', 'Lecture Hall 2']] },
  lecturers: { singular: 'lecturer', plural: 'lecturers', queryKey: 'lecturers', fileName: 'ntsattend-lecturers.csv', headers: ['Title', 'First name', 'Last name', 'Email', 'Staff number', 'Phone', 'Department'], rows: [['Dr', 'Fatmata', 'Conteh', 'fatmata.conteh@example.edu', 'STF-0012', '+23276000010', 'CS']] },
  events: { singular: 'event', plural: 'events', queryKey: 'events', fileName: 'ntsattend-events.csv', headers: ['Event name', 'Starts', 'Ends', 'Venue', 'Description', 'Registration required'], rows: [['Orientation Day', '2026-09-05 09:00', '2026-09-05 13:00', 'Main Auditorium', 'Welcome for new students', 'no']] },
};
