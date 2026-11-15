import { Download, MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui';
import { usePwa } from './pwa';

/** "Install app" button — renders nothing when installing isn't possible or it's already installed. */
export function InstallAppButton({ className, variant = 'secondary', size = 'sm', label = 'Install app' }: { className?: string; variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const { installable, install } = usePwa();
  if (!installable) return null;
  return (
    <Button variant={variant} size={size} className={className} icon={<Download className="h-4 w-4" />} onClick={() => void install()}>
      {label}
    </Button>
  );
}

/** Menu-style row for dropdowns (profile menu). */
export function InstallAppMenuItem({ onDone }: { onDone?: () => void }) {
  const { installable, install } = usePwa();
  if (!installable) return null;
  return (
    <button
      role="menuitem"
      onClick={() => { onDone?.(); void install(); }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700"
    >
      <MonitorSmartphone className="h-[18px] w-[18px]" /> Install the app
    </button>
  );
}
