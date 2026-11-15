import { createPortal } from 'react-dom';
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { LOGO_SRC, LogoSpinner, ModuleLoader, TableSkeleton } from './brand';

/* ── Buttons ─────────────────────────────────────────────────────────────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'relative inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-all duration-150 select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2.5 text-sm',
        size === 'lg' && 'px-6 py-3.5 text-base',
        variant === 'primary' && 'bg-gradient-to-r from-brand-700 via-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)] hover:brightness-110',
        variant === 'success' && 'bg-gradient-to-r from-emerald-600 to-check text-white shadow-[0_10px_30px_-10px_rgb(34_197_94/0.6)] hover:brightness-110',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-brand-200 hover:bg-brand-50/50 hover:text-brand-700',
        variant === 'danger' && 'bg-gradient-to-r from-rose-600 to-rose-500 text-white shadow-[0_10px_30px_-12px_rgb(225_29_72/0.6)] hover:brightness-110',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        className,
      )}
      {...rest}
    >
      {loading ? <LogoSpinner size="xs" light={variant !== 'secondary' && variant !== 'ghost'} /> : icon}
      {children}
    </button>
  );
});

/* ── Form fields ─────────────────────────────────────────────────────────── */
/** "Enter your <field>" placeholder derived from the label (system-wide convention). */
export function autoPlaceholder(label?: string, verb = 'Enter') {
  if (!label) return undefined;
  // "Phone (optional)" → "phone"; "Student ID *" → "student ID"
  const clean = label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
  return clean ? `${verb} your ${clean.charAt(0).toLowerCase()}${clean.slice(1)}` : undefined;
}
const NO_PLACEHOLDER = new Set(['date', 'datetime-local', 'time', 'checkbox', 'radio', 'file', 'color', 'range']);

export function Field({ label, error, hint, children, htmlFor }: { label?: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="animate-fade-up mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-600" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string; icon?: ReactNode; rightSlot?: ReactNode };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, id, className, icon, rightSlot, placeholder, ...rest }, ref) {
  const auto = useId();
  const ph = placeholder ?? (NO_PLACEHOLDER.has(String(rest.type ?? 'text')) ? undefined : autoPlaceholder(label ?? (rest['aria-label'] as string | undefined)));
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid}>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
        <input
          ref={ref}
          id={fid}
          aria-invalid={!!error}
          placeholder={ph}
          className={clsx('input', icon && 'pl-10', rightSlot && 'pr-11', error && 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/15', className)}
          {...rest}
        />
        {rightSlot && <span className="absolute top-1/2 right-2 -translate-y-1/2">{rightSlot}</span>}
      </div>
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string; options: { value: string; label: string }[]; placeholder?: string };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, options, placeholder, id, className, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid}>
      <div className="relative">
        <select ref={ref} id={fid} className={clsx('input appearance-none pr-10', className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, id, className, placeholder, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} htmlFor={fid}>
      <textarea ref={ref} id={fid} placeholder={placeholder ?? autoPlaceholder(label)} className={clsx('input min-h-24', className)} {...rest} />
    </Field>
  );
});

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl py-2.5">
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-gradient-to-r from-brand-600 to-cyan-brand' : 'bg-slate-300')}
      >
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input className="input rounded-full bg-slate-50/80 pl-10" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" onClick={() => onChange('')} aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ── Layout primitives ───────────────────────────────────────────────────── */

/** Round, icon-only back button. `label` is announced to screen readers and shown as a tooltip. */
export function BackButton({ to, onClick, label = 'Go back', className }: { to?: string; onClick?: () => void; label?: string; className?: string }) {
  const cls = clsx(
    'group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm backdrop-blur transition',
    'hover:-translate-x-0.5 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 hover:shadow-[var(--shadow-glow)] focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-95',
    className,
  );
  const icon = <ArrowLeft className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5" aria-hidden />;
  return to ? (
    <Link to={to} className={cls} aria-label={label} title={label}>{icon}</Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-label={label} title={label}>{icon}</button>
  );
}
export function PageHeader({ title, description, actions, back, eyebrow }: { title: string; description?: string; actions?: ReactNode; back?: ReactNode; eyebrow?: string }) {
  return (
    <div className="animate-fade-up mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {back && <div className="pt-0.5">{back}</div>}
        <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-bold tracking-widest text-brand-600 uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{description}</p>}
        <div className="mt-3 h-1 w-14 rounded-full bg-gradient-to-r from-brand-600 via-cyan-brand to-check" />
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; icon?: ReactNode }) {
  return (
    <section className={clsx('card animate-fade-up overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy-800">
            {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className={clsx(padded && 'p-5')}>{children}</div>
    </section>
  );
}

const statTones = {
  brand: { tile: 'from-brand-600 to-cyan-brand', glow: 'bg-brand-400/20' },
  green: { tile: 'from-emerald-500 to-check', glow: 'bg-emerald-400/20' },
  amber: { tile: 'from-amber-500 to-orange-400', glow: 'bg-amber-400/20' },
  rose: { tile: 'from-rose-600 to-pink-500', glow: 'bg-rose-400/20' },
  slate: { tile: 'from-navy-700 to-brand-700', glow: 'bg-navy-600/10' },
};
export function StatCard({ label, value, icon, tone = 'brand', hint }: { label: string; value: ReactNode; icon?: ReactNode; tone?: keyof typeof statTones; hint?: string }) {
  const t = statTones[tone];
  return (
    <div className="card animate-fade-up group relative overflow-hidden p-5 transition-shadow hover:shadow-[0_12px_32px_-12px_rgb(11_31_77/0.25)]">
      <div className={clsx('absolute -top-10 -right-10 h-28 w-28 rounded-full blur-2xl transition-transform group-hover:scale-125', t.glow)} />
      <div className="relative flex items-center gap-4">
        {icon && <div className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg [&>svg]:h-5 [&>svg]:w-5', t.tile)}>{icon}</div>}
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
          <p className="text-2xl font-extrabold text-navy-900 tabular-nums">{value}</p>
          {hint && <p className="truncate text-xs text-slate-400">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 [--dot:var(--color-emerald-500)]',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20 [--dot:var(--color-amber-500)]',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20 [--dot:var(--color-brand-500)]',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20 [--dot:var(--color-slate-400)]',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 [--dot:var(--color-violet-500)]',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/20 [--dot:var(--color-rose-500)]',
};
const STATUS_TONE: Record<string, keyof typeof badgeTones> = {
  ACTIVE: 'green', PRESENT: 'green', COMPLETED: 'green',
  LATE: 'amber', EXPIRED: 'amber', MEDIUM: 'amber',
  PENDING: 'blue', PROCESSING: 'blue', EXCUSED: 'blue',
  CLOSED: 'slate', ARCHIVED: 'slate', INACTIVE: 'slate', LOW: 'slate',
  GRADUATED: 'violet',
  REVOKED: 'rose', SUSPENDED: 'rose', DEACTIVATED: 'rose', FAILED: 'rose', INVALIDATED: 'rose', HIGH: 'rose', CRITICAL: 'rose',
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const key = tone ?? (typeof children === 'string' ? children : '');
  const t = badgeTones[STATUS_TONE[key] ?? key] ?? badgeTones.slate;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', t)}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      {typeof children === 'string' ? children.replace(/_/g, ' ') : children}
    </span>
  );
}

/** Kept for existing call sites: a section loader with the logo spinner. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <ModuleLoader label={label} />;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-sky-50 text-brand-500 ring-1 ring-brand-100 [&>svg]:h-7 [&>svg]:w-7">
        {icon ?? <img src={LOGO_SRC} alt="" className="h-9 w-9 opacity-70 grayscale-[30%]" />}
      </div>
      <p className="font-bold text-navy-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center" role="alert">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-100">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <p className="font-bold text-navy-800">Something went wrong</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ── Modal & confirm ─────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([aria-label="Close"])')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  // Portal to <body>: ancestors with backdrop-filter/transform would otherwise trap position:fixed.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'animate-pop flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="h-1 w-full bg-gradient-to-r from-brand-700 via-cyan-brand to-check" />
        <header className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-extrabold text-navy-900">{title}</h2>
          <button className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, loading, children,
}: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; children?: ReactNode }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{message}</div>
      {children}
    </Modal>
  );
}

/* ── Data table ──────────────────────────────────────────────────────────── */
export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; className?: string; sortKey?: string };

export function DataTable<T extends { id: string }>({
  columns, rows, loading, error, onRetry, empty, onRowClick, sort, onSort,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  sort?: string;
  onSort?: (s: string) => void;
}) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading && !rows) return <TableSkeleton columns={Math.min(columns.length, 6)} />;
  if (!rows || rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  const [sf, sd] = (sort ?? '').split(':');
  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand-100" role="progressbar" aria-label="Refreshing">
          <div className="animate-indeterminate h-full w-2/5 bg-gradient-to-r from-brand-600 via-cyan-brand to-check" />
        </div>
      )}
      {/* Phones: one card per row (headers become labels). */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((r) => {
          const [first, ...rest] = columns;
          const labelled = rest.filter((c) => c.header);
          const actions = rest.filter((c) => !c.header);
          return (
            <li
              key={r.id}
              className={clsx('px-4 py-3.5 transition-colors', onRowClick && 'cursor-pointer active:bg-brand-50/60')}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              <div className="text-sm font-semibold text-navy-900">{first.render(r)}</div>
              {labelled.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  {labelled.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{c.header}</dt>
                      <dd className="mt-0.5 text-sm break-words text-slate-700">{c.render(r)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {actions.length > 0 && <div className="mt-2 flex justify-end gap-1">{actions.map((c) => <div key={c.key}>{c.render(r)}</div>)}</div>}
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full">
          <thead className="sticky top-0 z-[1] bg-gradient-to-b from-slate-50 to-slate-50/70 backdrop-blur">
            <tr className="border-b border-slate-200/80">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx('table-th', c.className)}>
                  {c.sortKey && onSort ? (
                    <button
                      className={clsx('inline-flex items-center gap-1 uppercase transition hover:text-brand-700', sf === c.sortKey && 'text-brand-700')}
                      onClick={() => onSort(`${c.sortKey}:${sf === c.sortKey && sd === 'asc' ? 'desc' : 'asc'}`)}
                    >
                      {c.header}
                      <span className="text-[9px]">{sf === c.sortKey ? (sd === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={clsx('transition-colors hover:bg-brand-50/40', onRowClick && 'cursor-pointer')}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('table-td', c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pageList(page: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row">
      <span>
        <span className="font-bold text-navy-800">{total.toLocaleString()}</span> result{total === 1 ? '' : 's'}
      </span>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button className="rounded-lg p-2 transition hover:bg-slate-100 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pageList(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={clsx(
                'h-8 min-w-8 rounded-lg px-2 text-xs font-bold tabular-nums transition',
                p === page ? 'bg-gradient-to-r from-brand-600 to-cyan-brand text-white shadow-[var(--shadow-glow)]' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button className="rounded-lg p-2 transition hover:bg-slate-100 disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="no-scrollbar mb-6 overflow-x-auto">
      <div className="inline-flex gap-1 rounded-2xl border border-slate-200/70 bg-white/70 p-1 shadow-sm backdrop-blur" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all',
              active === t.key ? 'bg-gradient-to-r from-navy-800 to-brand-700 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-navy-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
