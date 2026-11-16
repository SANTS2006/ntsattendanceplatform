import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RotateCw, Trash2, X } from 'lucide-react';

/**
 * Full-screen view of a profile picture or logo, with the same "change" and "remove" actions as the
 * card it was opened from. Closes with Escape, the close button or a click on the backdrop.
 */
export function ImageViewer({
  open,
  onClose,
  src,
  alt,
  title,
  subtitle,
  rounded = false,
  onChange,
  onRemove,
  busy,
  changeLabel = 'Change image',
}: {
  open: boolean;
  onClose: () => void;
  src: string | null | undefined;
  alt: string;
  title: string;
  subtitle?: string;
  /** Show the image in a circle (profile pictures) instead of a rounded square (logos). */
  rounded?: boolean;
  /** Called with the chosen file; omit to hide the change button. */
  onChange?: (file: File) => void;
  onRemove?: () => void;
  busy?: 'upload' | 'remove' | null;
  changeLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-navy-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white sm:px-6" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/60">{subtitle}</p>}
        </div>
        <button ref={closeRef} onClick={onClose} className="rounded-full p-2.5 text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="Close">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
        <div className="animate-pop relative" onClick={(e) => e.stopPropagation()}>
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            className={
              rounded
                ? 'aspect-square w-[min(80vw,62vh)] rounded-full object-cover shadow-2xl ring-4 ring-white/15'
                : 'max-h-[68vh] max-w-[88vw] rounded-2xl bg-white object-contain p-3 shadow-2xl sm:p-5'
            }
          />
          {busy === 'upload' && (
            <span className={`absolute inset-0 flex flex-col items-center justify-center bg-navy-950/55 text-white ${rounded ? 'rounded-full' : 'rounded-2xl'}`} role="status" aria-live="polite">
              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
              <span className="mt-2 text-xs font-bold tracking-wider uppercase">Uploading</span>
            </span>
          )}
        </div>
      </div>

      {(onChange || onRemove) && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 pt-2 pb-6 sm:pb-8" onClick={(e) => e.stopPropagation()}>
          {onChange && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-600 to-cyan-brand px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-60"
              >
                {busy === 'upload' ? <RotateCw className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {changeLabel}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onChange(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              disabled={!!busy}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-bold text-white/90 transition hover:bg-white/10 disabled:opacity-60"
            >
              {busy === 'remove' ? <RotateCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove
            </button>
          )}
          <p className="w-full text-center text-xs text-white/50">JPEG, PNG or WebP · up to 5 MB</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
