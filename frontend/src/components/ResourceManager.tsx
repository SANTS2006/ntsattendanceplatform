import { useState, type ReactNode } from 'react';
import { useForm, type FieldErrors, type RegisterOptions, type UseFormReturn } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { FileSpreadsheet, PencilLine, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, del, errorMessage, patch, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { usePaged } from '@/hooks/usePaged';
import { useOptions } from '@/hooks/useOptions';
import { IMPORT_TEMPLATES, UploadRecords } from './UploadRecords';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, Input, Modal, Pagination, SearchInput, Select, Textarea, Toggle, type Column } from './ui';

type Base = { name: string; label: string; hint?: string; wide?: boolean };
export type FieldDef =
  | (Base & { type: 'text' | 'email'; required?: boolean; max?: number; min?: number; pattern?: { value: RegExp; message: string } })
  | (Base & { type: 'number'; required?: boolean; minValue?: number; maxValue?: number; integer?: boolean; step?: string })
  | (Base & { type: 'date' | 'datetime-local'; required?: boolean; /** must be later than this field */ after?: string })
  | (Base & { type: 'textarea'; required?: boolean; max?: number })
  | (Base & { type: 'boolean'; description?: string })
  | (Base & { type: 'select'; options: { value: string; label: string }[]; required?: boolean })
  | (Base & { type: 'ref'; url: string; optionLabel: (r: any) => string; required?: boolean }); // eslint-disable-line @typescript-eslint/no-explicit-any

type Form = UseFormReturn<Record<string, unknown>>;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_LIKE = /^[A-Za-z0-9._\-/ ]+$/;

/** Validation rules derived from the field definition (the API re-validates). */
function rules(f: FieldDef): RegisterOptions {
  const req = 'required' in f && f.required ? (f.type === 'select' || f.type === 'ref' ? `Select your ${lower(f.label)}` : `Enter your ${lower(f.label)}`) : false;
  switch (f.type) {
    case 'text':
    case 'email': {
      const max = f.max ?? (f.type === 'email' ? 254 : 150);
      return {
        required: req,
        setValueAs: (v) => (typeof v === 'string' ? v.trim() : v),
        maxLength: { value: max, message: `${f.label} must be at most ${max} characters` },
        ...(f.min ? { minLength: { value: f.min, message: `${f.label} must be at least ${f.min} characters` } } : {}),
        pattern: f.type === 'email' ? { value: EMAIL, message: 'Enter a valid email address' } : f.pattern ?? (f.name === 'code' ? { value: CODE_LIKE, message: 'Use letters, numbers, spaces and . _ - / only' } : undefined),
      };
    }
    case 'textarea':
      return { required: req, maxLength: { value: f.max ?? 2000, message: `${f.label} must be at most ${f.max ?? 2000} characters` } };
    case 'number':
      return {
        required: req,
        validate: (v) => {
          if (v === '' || v == null) return true;
          const n = Number(v);
          if (!Number.isFinite(n)) return `${f.label} must be a number`;
          if (f.integer && !Number.isInteger(n)) return `${f.label} must be a whole number`;
          if (f.minValue != null && n < f.minValue) return `${f.label} must be at least ${f.minValue}`;
          if (f.maxValue != null && n > f.maxValue) return `${f.label} must be at most ${f.maxValue}`;
          return true;
        },
      };
    case 'date':
    case 'datetime-local':
      return {
        required: req,
        validate: (v, all) => {
          if (!v || !f.after) return true;
          const other = all[f.after];
          return !other || new Date(String(v)) > new Date(String(other)) ? true : `${f.label} must be after the ${lower(f.after === 'startDate' || f.after === 'startsAt' ? 'start' : f.after)}`;
        },
      };
    case 'select':
    case 'ref':
      return { required: req };
    default:
      return {};
  }
}

function RefSelect({ field, form, error }: { field: Extract<FieldDef, { type: 'ref' }>; form: Form; error?: string }) {
  const { options } = useOptions(field.url, field.optionLabel, { status: undefined });
  return <Select label={`${field.label}${field.required ? ' *' : ''}`} options={options} placeholder={`Select your ${lower(field.label)}`} hint={field.hint} error={error} {...form.register(field.name, rules(field))} />;
}

type Props<T> = {
  title: string;
  url: string;
  queryKey: string;
  columns: Column<T>[];
  fields: FieldDef[];
  managePermission: string | string[];
  /** Convert a row into form defaults. */
  toForm?: (row: T) => Record<string, unknown>;
  /** Convert form values into the API payload. */
  toPayload?: (values: Record<string, unknown>) => Record<string, unknown>;
  filters?: Record<string, unknown>;
  filterBar?: ReactNode;
  deleteLabel?: string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  /** Bulk import resource (defaults to the URL, when a template exists). `false` disables uploads. */
  importResource?: string | false;
};

const blank = (v: unknown) => (v === '' || v === undefined ? null : v);

/**
 * Generic, permission-aware CRUD manager backed by the standard REST endpoints:
 * GET list (server pagination/search), POST create, PATCH update, DELETE archive/delete —
 * plus bulk creation from a CSV/Excel file through `/imports/<resource>`.
 */
export function ResourceManager<T extends { id: string }>(p: Props<T>) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = usePaged<T>(p.queryKey, p.url, p.filters);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [mode, setMode] = useState<'form' | 'upload'>('form');
  const [deleting, setDeleting] = useState<T | null>(null);
  const canManage = (Array.isArray(p.managePermission) ? p.managePermission : [p.managePermission]).some(can);
  const form = useForm<Record<string, unknown>>({ mode: 'onTouched' });
  const noun = lower(p.title);
  const importKey = p.importResource === false ? null : (p.importResource ?? p.url.replace(/^\//, ''));
  const template = importKey ? IMPORT_TEMPLATES[importKey] : undefined;

  const open = (row: T | 'new', as: 'form' | 'upload' = 'form') => {
    const defaults: Record<string, unknown> = {};
    for (const f of p.fields) {
      defaults[f.name] = f.type === 'boolean' ? false : '';
    }
    const values = row === 'new' ? defaults : { ...defaults, ...(p.toForm ? p.toForm(row) : (row as Record<string, unknown>)) };
    for (const k of Object.keys(values)) if (values[k] === null) values[k] = defaults[k] ?? '';
    form.reset(values);
    setMode(as);
    setEditing(row);
  };
  const close = () => setEditing(null);

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload: Record<string, unknown> = {};
      for (const f of p.fields) {
        const v = values[f.name];
        if (f.type === 'number') payload[f.name] = v === '' || v == null ? null : Number(v);
        else if (f.type === 'boolean') payload[f.name] = !!v;
        else if (f.type === 'datetime-local') payload[f.name] = v ? new Date(String(v)).toISOString() : null;
        else payload[f.name] = blank(typeof v === 'string' ? v.trim() : v);
      }
      const body = p.toPayload ? p.toPayload(payload) : payload;
      return editing === 'new' ? post(p.url, body) : patch(`${p.url}/${(editing as T).id}`, body);
    },
    onSuccess: () => {
      toast.success(editing === 'new' ? `${p.title} created` : `${p.title} updated`);
      close();
      qc.invalidateQueries({ queryKey: [p.queryKey] });
      qc.invalidateQueries({ queryKey: ['options', p.url] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') {
        for (const [k, v] of Object.entries(e.errors)) form.setError(k, { message: Array.isArray(v) ? String(v[0]) : String(v) });
      }
      toast.error(errorMessage(e));
    },
  });

  const remove = useMutation({
    mutationFn: (row: T) => del(`${p.url}/${row.id}`),
    onSuccess: () => {
      toast.success(`${p.title} ${p.deleteLabel === 'Archive' ? 'archived' : 'deleted'}`);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: [p.queryKey] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<T>[] = canManage
    ? [
        ...p.columns,
        {
          key: '_actions',
          header: '',
          className: 'text-right',
          render: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" aria-label="Edit" icon={<Pencil className="h-4 w-4" />} onClick={() => open(r)} />
              <Button size="sm" variant="ghost" aria-label={p.deleteLabel ?? 'Delete'} icon={<Trash2 className="h-4 w-4 text-rose-500" />} onClick={() => setDeleting(r)} />
            </div>
          ),
        },
      ]
    : p.columns;

  const errs: FieldErrors = form.formState.errors;
  const submit = form.handleSubmit((v) => save.mutate(v));
  const isNew = editing === 'new';
  const showTabs = isNew && !!template;

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={list.search} onChange={list.setSearch} placeholder={`Search ${noun}s…`} />
          {p.filterBar}
        </div>
        {canManage && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {template && (
              <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => open('new', 'upload')}>
                Upload file
              </Button>
            )}
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>
              New {noun}
            </Button>
          </div>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={list.rows}
        loading={list.isFetching}
        error={list.errorText}
        onRetry={() => list.refetch()}
        onRowClick={p.onRowClick}
        empty={
          <EmptyState
            title={list.search ? 'No matches' : `No ${noun}s yet`}
            description={list.search ? 'Try a different search.' : p.emptyText}
            action={
              canManage && !list.search ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => open('new')}>Create the first one</Button>
                  {template && <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => open('new', 'upload')}>Upload a file</Button>}
                </div>
              ) : undefined
            }
          />
        }
      />
      {list.meta && <Pagination page={list.meta.page} totalPages={list.meta.totalPages} total={list.meta.total} onPage={list.setPage} />}

      <Modal
        open={editing !== null}
        onClose={close}
        size={mode === 'upload' ? 'xl' : 'lg'}
        title={isNew ? (mode === 'upload' ? `Import ${template?.plural ?? `${noun}s`}` : `New ${noun}`) : `Edit ${noun}`}
        footer={
          mode === 'form' ? (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button loading={save.isPending} onClick={submit}>{isNew ? `Create ${noun}` : 'Save changes'}</Button>
            </>
          ) : undefined
        }
      >
        {showTabs && (
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
            {([
              ['form', 'Enter details', <PencilLine key="i" className="h-4 w-4" />],
              ['upload', 'Upload a file', <FileSpreadsheet key="i" className="h-4 w-4" />],
            ] as const).map(([k, label, icon]) => (
              <button
                key={k}
                role="tab"
                aria-selected={mode === k}
                onClick={() => setMode(k)}
                className={clsx('flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition', mode === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        )}
        {mode === 'upload' && template && importKey ? (
          <UploadRecords base={`/imports/${importKey}`} singular={template.singular} plural={template.plural} template={template} invalidateKeys={[p.queryKey]} onDone={close} />
        ) : (
          <form noValidate className="grid gap-x-4 gap-y-4 sm:grid-cols-2" onSubmit={submit}>
            {p.fields.map((f) => {
              const err = errs[f.name]?.message as string | undefined;
              const wide = f.wide || f.type === 'textarea' || f.type === 'boolean' ? 'sm:col-span-2' : '';
              const label = `${f.label}${'required' in f && f.required ? ' *' : ''}`;
              return (
                <div key={f.name} className={wide}>
                  {f.type === 'textarea' ? (
                    <Textarea label={label} rows={3} error={err} maxLength={f.max ?? 2000} {...form.register(f.name, rules(f))} />
                  ) : f.type === 'boolean' ? (
                    <div className="rounded-2xl border border-slate-200 px-4">
                      <Toggle label={f.label} description={f.description} checked={!!form.watch(f.name)} onChange={(v) => form.setValue(f.name, v, { shouldDirty: true })} />
                    </div>
                  ) : f.type === 'select' ? (
                    <Select label={label} options={f.options} placeholder={`Select your ${lower(f.label)}`} hint={f.hint} error={err} {...form.register(f.name, rules(f))} />
                  ) : f.type === 'ref' ? (
                    <RefSelect field={f} form={form} error={err} />
                  ) : (
                    <Input
                      label={label}
                      type={f.type}
                      step={f.type === 'number' ? f.step ?? (f.integer ? '1' : 'any') : undefined}
                      min={f.type === 'number' ? f.minValue : undefined}
                      max={f.type === 'number' ? f.maxValue : undefined}
                      maxLength={f.type === 'text' || f.type === 'email' ? f.max ?? (f.type === 'email' ? 254 : 150) : undefined}
                      hint={f.hint}
                      error={err}
                      {...form.register(f.name, rules(f))}
                    />
                  )}
                </div>
              );
            })}
            <button type="submit" hidden />
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        danger
        title={`${p.deleteLabel ?? 'Delete'} ${noun}?`}
        confirmLabel={p.deleteLabel ?? 'Delete'}
        message={p.deleteLabel === 'Archive' ? 'Archived records are hidden from new activity but kept for history and reports.' : 'This cannot be undone.'}
      />
    </Card>
  );
}

export const statusBadge = (s: string) => <Badge>{s}</Badge>;
