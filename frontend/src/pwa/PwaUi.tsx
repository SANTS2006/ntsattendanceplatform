import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { PlusSquare, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { LOGO_SRC } from '@/components/brand';
import { Button, Modal } from '@/components/ui';
import { usePwa } from './pwa';

/** Step-by-step guide for iPhone / iPad (Safari has no install prompt). */
function IosInstallGuide() {
  const { iosGuideOpen, setIosGuideOpen } = usePwa();
  const steps = [
    { icon: <Share className="h-5 w-5" />, text: <>Tap the <strong>Share</strong> button in Safari’s toolbar.</> },
    { icon: <PlusSquare className="h-5 w-5" />, text: <>Scroll down and tap <strong>Add to Home Screen</strong>.</> },
    { icon: <img src={LOGO_SRC} alt="" className="h-5 w-5" />, text: <>Tap <strong>Add</strong>. NTSAttend appears on your home screen like any other app.</> },
  ];
  return (
    <Modal open={iosGuideOpen} onClose={() => setIosGuideOpen(false)} title="Install NTSAttend" size="sm" footer={<Button onClick={() => setIosGuideOpen(false)}>Got it</Button>}>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{s.icon}</span>
            <span className="pt-1.5">{s.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-slate-500">On iPhone and iPad, installing works from Safari.</p>
    </Modal>
  );
}

const DISMISS_KEY = 'ntsattend-install-dismissed';
const readDismissed = () => {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
};

/** Small one-time banner suggesting installation (dismissal remembered for 30 days on this device). */
function InstallBanner() {
  const { installable, install, ios } = usePwa();
  const [hidden, setHidden] = useState(readDismissed);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 4000); // don't greet people with a banner instantly
    return () => clearTimeout(t);
  }, []);
  if (!installable || hidden || !ready || location.pathname.startsWith('/attend/')) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 86_400_000));
    } catch {
      /* storage unavailable — hide for this visit only */
    }
  };
  return (
    <div className="animate-fade-up fixed inset-x-3 bottom-3 z-[55] mx-auto max-w-md sm:right-4 sm:left-auto sm:mx-0" role="dialog" aria-label="Install NTSAttend">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_-15px_rgb(11_31_77/0.45)]">
        <img src="/icons/maskable-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-navy-900">Install NTSAttend</p>
          <p className="text-xs text-slate-500">{ios ? 'Add it to your home screen for one-tap access.' : 'Open it like an app — faster, full-screen, one click away.'}</p>
        </div>
        <Button size="sm" onClick={() => { void install(); dismiss(); }}>Install</Button>
        <button onClick={dismiss} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Not now">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Service worker registration with a "new version available" prompt. */
function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new deployment every hour while the app stays open.
      if (registration) setInterval(() => void registration.update().catch(() => undefined), 3600_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="animate-fade-up fixed inset-x-3 top-3 z-[70] mx-auto max-w-md" role="status">
      <div className="flex items-center gap-3 rounded-2xl bg-navy-900 p-3 text-white shadow-2xl">
        <RefreshCw className="h-5 w-5 shrink-0 text-cyan-300" />
        <p className="min-w-0 flex-1 text-sm font-semibold">A new version of NTSAttend is available.</p>
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>Update</Button>
        <button onClick={() => setNeedRefresh(false)} className="rounded-lg p-1.5 text-white/60 hover:text-white" aria-label="Later">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function OfflineBanner() {
  const { online } = usePwa();
  return (
    <div
      aria-live="polite"
      className={clsx(
        'fixed inset-x-0 top-0 z-[80] flex justify-center transition-transform duration-300',
        online ? '-translate-y-full' : 'translate-y-0',
      )}
    >
      {!online && (
        <p className="m-2 flex items-center gap-2 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg">
          <WifiOff className="h-4 w-4" /> You’re offline — changes can’t be saved until you reconnect.
        </p>
      )}
    </div>
  );
}

/** Mounted once at the root: update prompt, offline notice, install banner and the iOS guide. */
export function PwaUi() {
  return (
    <>
      <UpdatePrompt />
      <OfflineBanner />
      <InstallBanner />
      <IosInstallGuide />
    </>
  );
}
