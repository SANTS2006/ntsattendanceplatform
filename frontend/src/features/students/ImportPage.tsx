import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { errorMessage, get, http, post, type ApiSuccess } from '@/api/client';
import { Badge, Button, Card, DataTable, PageHeader, Select, StatCard } from '@/components/ui';
import { humanize } from '@/utils/format';

type Upload = { id: string; fileName: string; totalRows: number; headers: string[]; suggestedMapping: Record<string, string>; sample: Record<string, string>[]; fields: string[] };
type Preview = { totalRows: number; validRows: number; invalidRows: number; existingStudents: number; newStudents: number; errors: { line: number; studentNumber: string; errors: string[] }[] };
type Status = { id: string; status: string; totalRows: number; successCount: number; failureCount: number; errorReportUrl: string | null };

const REQUIRED = ['studentNumber'];

export function ImportPage() {
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'running'>('upload');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'create_only' | 'upsert'>('create_only');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const status = useQuery({
    queryKey: ['import', upload?.id],
    queryFn: () => get<Status>(`/students/import/${upload!.id}`),
    enabled: step === 'running' && !!upload,
    refetchInterval: (q) => (q.state.data && ['COMPLETED', 'FAILED'].includes(q.state.data.status) ? false : 1500),
  });
  useEffect(() => {
    if (status.data?.status === 'COMPLETED') toast.success('Import completed');
  }, [status.data?.status]);

  const onFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast.error('Files must be 10 MB or smaller');
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const r = (await http.post<ApiSuccess<Upload>>('/students/import', fd)).data.data;
      setUpload(r);
      setMapping(r.suggestedMapping);
      setStep('map');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await post<Preview>(`/students/import/${upload!.id}/preview`, { mapping: clean(mapping) }));
      setStep('preview');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      await post(`/students/import/${upload!.id}/commit`, { mapping: clean(mapping), mode });
      setStep('running');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <PageHeader title="Import students" description="Upload a CSV or Excel (.xlsx) file, map its columns, review, then import." back={<Link to="/app/students" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Students</Link>} />

      {step === 'upload' && (
        <Card>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition ${dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-slate-400'}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void onFile(f); }}
          >
            {busy ? <Loader2 className="h-10 w-10 animate-spin text-brand-500" /> : <UploadCloud className="h-10 w-10 text-slate-400" />}
            <p className="mt-3 font-medium text-slate-800">Drop a file here or click to browse</p>
            <p className="mt-1 text-sm text-slate-500">CSV or XLSX, up to 10 MB / 50,000 rows. The first row must contain column headings.</p>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </Card>
      )}

      {step === 'map' && upload && (
        <Card title={<span className="inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> {upload.fileName} · {upload.totalRows} rows</span>}>
          <p className="mb-4 text-sm text-slate-500">Match each NTS field to a column in your file. We guessed what we could. Programs, departments and levels are matched by code or name.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {upload.fields.map((field) => (
              <Select
                key={field}
                label={`${humanize(field.replace(/([A-Z])/g, '_$1'))}${REQUIRED.includes(field) ? ' *' : ''}`}
                options={upload.headers.map((h) => ({ value: h, label: h }))}
                placeholder="— Not in file —"
                value={mapping[field] ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
              />
            ))}
          </div>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-slate-700">Sample rows</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50"><tr>{upload.headers.map((h) => <th key={h} className="px-3 py-2 text-left font-medium text-slate-600">{h}</th>)}</tr></thead>
              <tbody>{upload.sample.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-slate-100">{upload.headers.map((h) => <td key={h} className="px-3 py-2 whitespace-nowrap text-slate-700">{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="secondary" onClick={() => setStep('upload')}>Choose another file</Button>
            <Button loading={busy} disabled={!mapping.studentNumber} onClick={runPreview}>Validate</Button>
          </div>
        </Card>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label="Rows" value={preview.totalRows} tone="slate" />
            <StatCard label="Valid" value={preview.validRows} tone="green" />
            <StatCard label="Invalid" value={preview.invalidRows} tone="rose" />
            <StatCard label="Already exist" value={preview.existingStudents} tone="amber" />
          </div>
          {preview.errors.length > 0 && (
            <Card title="Rows with problems (first 100)" padded={false}>
              <DataTable
                rows={preview.errors.map((e) => ({ ...e, id: String(e.line) }))}
                columns={[
                  { key: 'line', header: 'Line', render: (r) => r.line },
                  { key: 'id', header: 'Student ID', render: (r) => <span className="font-mono text-xs">{r.studentNumber || '—'}</span> },
                  { key: 'err', header: 'Problems', render: (r) => <span className="text-rose-600 whitespace-normal">{r.errors.join('; ')}</span> },
                ]}
              />
            </Card>
          )}
          <Card title="Import options">
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === 'create_only'} onChange={() => setMode('create_only')} /> Only add new students (existing IDs are reported as errors)</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === 'upsert'} onChange={() => setMode('upsert')} /> Add new students and update existing ones</label>
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="secondary" onClick={() => setStep('map')}>Back to mapping</Button>
              <Button loading={busy} disabled={preview.validRows === 0} onClick={commit}>Import {preview.validRows} students</Button>
            </div>
          </Card>
        </div>
      )}

      {step === 'running' && (
        <Card>
          {!status.data || ['PENDING', 'PROCESSING'].includes(status.data.status) ? (
            <div className="flex flex-col items-center py-10 text-slate-600"><Loader2 className="mb-3 h-8 w-8 animate-spin text-brand-500" /> Importing in the background… you can leave this page.</div>
          ) : (
            <div className="flex flex-col items-center py-8 text-center">
              <CheckCircle2 className={`mb-3 h-12 w-12 ${status.data.status === 'COMPLETED' ? 'text-emerald-500' : 'text-rose-500'}`} />
              <Badge>{status.data.status}</Badge>
              <p className="mt-3 text-slate-700">{status.data.successCount} imported · {status.data.failureCount} failed</p>
              <div className="mt-5 flex gap-2">
                {status.data.errorReportUrl && <a href={status.data.errorReportUrl}><Button variant="secondary" icon={<Download className="h-4 w-4" />}>Download error report</Button></a>}
                <Link to="/app/students"><Button>View students</Button></Link>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

const clean = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v));
