import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Chromium's install prompt event (not yet in the DOM typings). */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type PwaState = {
  /** Running as an installed app (home-screen / desktop window). */
  standalone: boolean;
  /** iPhone / iPad Safari: no install prompt — show "Add to Home Screen" steps instead. */
  ios: boolean;
  /** The browser offered an install prompt we can trigger. */
  canPrompt: boolean;
  /** Show an install entry point (prompt available, or iOS instructions). */
  installable: boolean;
  online: boolean;
  install: () => Promise<'accepted' | 'dismissed' | 'ios' | 'unavailable'>;
  iosGuideOpen: boolean;
  setIosGuideOpen: (open: boolean) => void;
};

const FALLBACK: PwaState = {
  standalone: false, ios: false, canPrompt: false, installable: false, online: true,
  install: async () => 'unavailable', iosGuideOpen: false, setIosGuideOpen: () => undefined,
};
const Ctx = createContext<PwaState | null>(null);

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

const isIos = () =>
  typeof navigator !== 'undefined' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); // iPadOS reports as Mac

export function PwaProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(isStandalone);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [iosGuideOpen, setIosGuideOpen] = useState(false);
  const ios = useMemo(isIos, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own "Install app" button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMode = () => setStandalone(isStandalone());
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    mq?.addEventListener?.('change', onMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      mq?.removeEventListener?.('change', onMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      setDeferred(null); // a prompt can only be used once
      return outcome;
    }
    if (ios && !standalone) {
      setIosGuideOpen(true);
      return 'ios' as const;
    }
    return 'unavailable' as const;
  }, [deferred, ios, standalone]);

  const value = useMemo<PwaState>(
    () => ({
      standalone, ios, canPrompt: !!deferred, installable: !standalone && (!!deferred || ios), online,
      install, iosGuideOpen, setIosGuideOpen,
    }),
    [standalone, ios, deferred, online, install, iosGuideOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Works outside the provider too (isolated component tests): returns a "not installable" state. */
export function usePwa() {
  return useContext(Ctx) ?? FALLBACK;
}
