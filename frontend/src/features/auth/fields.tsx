import { forwardRef, useRef, useState, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from '@/components/ui';

/** Password input with lock icon and show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(
  function PasswordInput(props, ref) {
    const [show, setShow] = useState(false);
    return (
      <Input
        ref={ref}
        {...props}
        type={show ? 'text' : 'password'}
        icon={<Lock />}
        rightSlot={
          <button type="button" onClick={() => setShow((s) => !s)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-brand-600" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        }
      />
    );
  },
);

export function passwordScore(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 12) s++;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s++;
  return s;
}

/** Four-segment strength meter with actionable hints (server enforces the actual rule). */
export function StrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password);
  const labels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'];
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-brand-500', 'bg-check'];
  const hints = [
    password.length < 10 && 'at least 10 characters',
    !(/[A-Za-z]/.test(password) && /\d/.test(password)) && 'letters and a number',
    password.length < 12 && '12+ characters is stronger',
  ].filter(Boolean);
  return (
    <div className="-mt-2 space-y-1.5" aria-live="polite">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={clsx('h-1.5 flex-1 rounded-full transition-colors duration-300', i < score ? colors[score] : 'bg-slate-200')} />
        ))}
      </div>
      <p className="text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{labels[score]}</span>
        {hints.length > 0 && <> · add {hints.join(', ')}</>}
      </p>
    </div>
  );
}

/** Six-box verification code input: auto-advance, paste support, backspace to previous box. */
export function CodeInput({ value, onChange, length = 6, invalid, disabled }: { value: string; onChange: (v: string) => void; length?: number; invalid?: boolean; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(length, ' ').slice(0, length).split('');
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const setAt = (i: number, ch: string) => {
    const next = chars.slice();
    next[i] = ch || ' ';
    onChange(next.join('').replace(/\s+$/, ''));
  };
  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="Verification code">
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={c.trim()}
          disabled={disabled}
          inputMode="text"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoCapitalize="characters"
          maxLength={length}
          aria-label={`Character ${i + 1}`}
          className={clsx(
            'h-14 w-full min-w-0 rounded-2xl border-2 bg-white text-center font-mono text-2xl font-extrabold text-navy-900 shadow-sm transition outline-none sm:h-16',
            invalid ? 'animate-[pop_0.25s] border-rose-400 bg-rose-50' : c.trim() ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200',
            'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15',
          )}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = clean(e.target.value);
            if (v.length > 1) {
              // Pasted or autofilled the whole code
              onChange(v.slice(0, length));
              refs.current[Math.min(v.length, length) - 1]?.focus();
              return;
            }
            setAt(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !c.trim() && i > 0) {
              setAt(i - 1, '');
              refs.current[i - 1]?.focus();
              e.preventDefault();
            }
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const v = clean(e.clipboardData.getData('text'));
            if (!v) return;
            e.preventDefault();
            onChange(v.slice(0, length));
            refs.current[Math.min(v.length, length) - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
