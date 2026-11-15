import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { errorMessage, get } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { LogoSpinner } from '@/components/brand';

type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window {
    google?: GoogleId;
  }
}

let scriptPromise: Promise<void> | null = null;
/** Loads Google Identity Services once per page. */
function loadGis(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Google sign-in could not load'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => get<{ googleClientId: string | null; emailCodeLength: number }>('/auth/config'), staleTime: Infinity });

/**
 * "Continue with Google" via Google Identity Services. Google returns a signed ID token
 * (credential); the API verifies its signature, audience and expiry before signing the user in.
 * Hidden entirely when GOOGLE_CLIENT_ID is not configured on the server.
 */
export function GoogleButton({ mode, onMfa, onSuccess }: { mode: 'signin' | 'signup'; onMfa: (mfaToken: string) => void; onSuccess: (created?: boolean) => void }) {
  const { loginWithGoogle } = useAuth();
  const cfg = useAuthConfig();
  const holder = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef({ onMfa, onSuccess, loginWithGoogle });
  cb.current = { onMfa, onSuccess, loginWithGoogle };
  const clientId = cfg.data?.googleClientId;

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: async ({ credential }: { credential: string }) => {
            setBusy(true);
            try {
              const r = await cb.current.loginWithGoogle(credential);
              if (r.mfaRequired) cb.current.onMfa(r.mfaToken);
              else cb.current.onSuccess(r.created);
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          },
        });
        holder.current.innerHTML = '';
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: mode === 'signup' ? 'signup_with' : 'continue_with',
          logo_alignment: 'center',
          width: Math.min(400, holder.current.clientWidth || 360),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, mode]);

  if (!clientId) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-200" />
        or
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-200" />
      </div>
      <div className="relative flex min-h-11 items-center justify-center">
        <div ref={holder} className="flex w-full justify-center" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full bg-white/90 text-sm font-semibold text-navy-800">
            <LogoSpinner size="xs" /> Signing in with Google…
          </div>
        )}
      </div>
      {failed && <p className="text-center text-xs text-rose-600">Google sign-in couldn’t load. Check your connection or use email instead.</p>}
    </div>
  );
}
