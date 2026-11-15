import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, http, post, refreshAccessToken, tokenStore } from '@/api/client';
import type { CurrentOrg, Me } from '@/types';
import { SignOutOverlay } from '@/components/brand';

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired: false };

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  me: Me | null;
  org: CurrentOrg | null;
  /** UI hint only — the backend enforces every permission. */
  can: (permission: string) => boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  /** Sign in or sign up with a Google Identity Services ID token. */
  loginWithGoogle: (credential: string) => Promise<LoginResult & { created?: boolean }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  acceptSession: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrg] = useState<CurrentOrg | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const reload = useCallback(async () => {
    const m = await get<Me>('/auth/me');
    setMe(m);
    setOrg(m.activeOrganizationId ? await get<CurrentOrg>('/organizations/current').catch(() => null) : null);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    tokenStore.set(null);
    setMe(null);
    setOrg(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    tokenStore.onExpired(clear);
    // Anonymous student attendance pages never use a staff session.
    if (window.location.pathname.startsWith('/attend/')) {
      setStatus('anonymous');
      return;
    }
    // Restore the session from the HttpOnly refresh cookie on first load.
    refreshAccessToken().then((t) => (t ? reload().catch(clear) : clear()));
  }, [clear, reload]);

  const acceptSession = useCallback(
    async (accessToken: string) => {
      tokenStore.set(accessToken);
      qc.clear();
      await reload();
    },
    [qc, reload],
  );

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      org,
      can: (p) => !!org && (org.myPermissions === 'ALL' || org.myPermissions.includes(p)),
      login: async (email, password) => {
        const r = await post<{ mfaRequired: boolean; mfaToken?: string; accessToken?: string }>('/auth/login', { email, password });
        if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken! };
        await acceptSession(r.accessToken!);
        return { mfaRequired: false };
      },
      loginWithGoogle: async (credential) => {
        const r = await post<{ mfaRequired: boolean; mfaToken?: string; accessToken?: string; created?: boolean }>('/auth/google', { credential });
        if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken! };
        await acceptSession(r.accessToken!);
        return { mfaRequired: false, created: r.created };
      },
      completeMfa: async (mfaToken, code) => {
        const r = await post<{ accessToken: string }>('/auth/mfa/verify', { mfaToken, code });
        await acceptSession(r.accessToken);
      },
      acceptSession,
      logout: async () => {
        setSigningOut(true);
        // Revoke server-side, and keep the animation up long enough to read (min ~1.2s).
        await Promise.all([
          http.post('/auth/logout', null, { headers: { 'X-NTS-CSRF': '1' } }).catch(() => undefined),
          new Promise((r) => setTimeout(r, 1200)),
        ]);
        clear();
        setSigningOut(false);
      },
      switchOrganization: async (organizationId) => {
        const r = await post<{ accessToken: string }>('/auth/switch-organization', { organizationId });
        await acceptSession(r.accessToken);
      },
      reload,
    }),
    [status, me, org, acceptSession, clear, reload],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {signingOut && <SignOutOverlay />}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
