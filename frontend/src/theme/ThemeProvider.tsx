import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'ntsattend-theme';

type ThemeState = { choice: ThemeChoice; resolved: 'light' | 'dark'; setChoice: (c: ThemeChoice) => void; toggle: () => void };
const Ctx = createContext<ThemeState | null>(null);
const FALLBACK: ThemeState = { choice: 'light', resolved: 'light', setChoice: () => undefined, toggle: () => undefined };

const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const read = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
};

/** Light / dark / system theme. Persisted per device (a viewer convenience). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(read);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  const resolved: 'light' | 'dark' = choice === 'system' ? (sysDark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#070d1a' : '#0b1f4d');
  }, [resolved]);
  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* storage unavailable — theme still applies for this visit */
    }
  }, []);
  const value = useMemo<ThemeState>(() => ({ choice, resolved, setChoice, toggle: () => setChoice(resolved === 'dark' ? 'light' : 'dark') }), [choice, resolved, setChoice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  // Outside a provider (isolated component tests, embeds) behave as a static light theme.
  return useContext(Ctx) ?? FALLBACK;
}

/** Single icon button: switches between light and dark. */
export function ThemeToggle({ className, light }: { className?: string; light?: boolean }) {
  const { resolved, toggle } = useTheme();
  const label = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={clsx(
        'relative rounded-xl p-2.5 transition',
        light ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-slate-500 hover:bg-brand-50 hover:text-brand-700',
        className,
      )}
    >
      <Sun className={clsx('h-5 w-5 transition-all duration-300', resolved === 'dark' ? 'scale-0 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100')} />
      <Moon className={clsx('absolute inset-0 m-auto h-5 w-5 transition-all duration-300', resolved === 'dark' ? 'scale-100 rotate-0 opacity-100' : 'scale-0 -rotate-90 opacity-0')} />
    </button>
  );
}

/** Three-way segmented control (light / dark / system) for menus and settings. */
export function ThemeSegmented() {
  const { choice, setChoice } = useTheme();
  const opts: { v: ThemeChoice; icon: ReactNode; label: string }[] = [
    { v: 'light', icon: <Sun className="h-4 w-4" />, label: 'Light' },
    { v: 'dark', icon: <Moon className="h-4 w-4" />, label: 'Dark' },
    { v: 'system', icon: <Monitor className="h-4 w-4" />, label: 'System' },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={choice === o.v}
          onClick={() => setChoice(o.v)}
          className={clsx(
            'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition',
            choice === o.v ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500 hover:text-navy-800',
          )}
        >
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}
