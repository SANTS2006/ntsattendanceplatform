import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import clsx from 'clsx';
import { ArrowLeft, Clock, Maximize2, Minimize2, Users } from 'lucide-react';
import { errorMessage, get, post } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { LOGO_SRC, PageLoader } from '@/components/brand';
import { Button, ErrorState } from '@/components/ui';
import { useSessionSocket } from '@/hooks/useSessionSocket';
import type { AttendanceSession, QrInfo } from '@/types';

/** Window size, kept current so the QR always fills the screen. */
function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/**
 * Projector view of a session's QR code (opened in a new tab from the live session page).
 * Shows a very large QR, the countdown and the live check-in count; rotating codes refresh here too.
 */
export function PresentQrPage() {
  const { id = '' } = useParams();
  const { org } = useAuth();
  const qc = useQueryClient();
  const { w, h } = useViewport();
  const [qr, setQr] = useState<QrInfo | null>(() => {
    try {
      const raw = sessionStorage.getItem(`nts-qr-${id}`); // copied from the opening tab
      return raw ? (JSON.parse(raw) as QrInfo) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [isFull, setIsFull] = useState(!!document.fullscreenElement);

  const session = useQuery({ queryKey: ['session', id], queryFn: () => get<AttendanceSession>(`/attendance/sessions/${id}`), refetchInterval: 20_000 });
  const s = session.data;
  const offset = s?.serverTime ? new Date(s.serverTime).getTime() - Date.now() : 0;
  const left = s ? Math.max(0, new Date(s.expiresAt).getTime() - (now + offset)) : 0;
  const active = s?.effectiveStatus === 'ACTIVE' && left > 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => { clearInterval(t); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  const mint = useCallback(async () => {
    try {
      const q = await post<QrInfo>(`/attendance/sessions/${id}/qr`);
      setQr(q);
      sessionStorage.setItem(`nts-qr-${id}`, JSON.stringify(q));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  // Fresh code when there is none (or it is about to expire), and on every rotation.
  useEffect(() => {
    if (s?.canManage && active && (!qr || new Date(qr.expiresAt).getTime() < Date.now() + 5000)) void mint();
  }, [s?.canManage, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!qr?.rotationSeconds || !active || !s?.canManage) return;
    const t = setInterval(mint, Math.max(10, qr.rotationSeconds - 5) * 1000);
    return () => clearInterval(t);
  }, [qr?.rotationSeconds, active, s?.canManage, mint]);

  useSessionSocket(id, {
    'attendance:recorded': () => qc.invalidateQueries({ queryKey: ['session', id] }),
    'session:updated': () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (session.isLoading) return <PageLoader label="Preparing the QR code…" />;
  if (session.error || !s) return <div className="p-6"><ErrorState message={errorMessage(session.error)} onRetry={() => session.refetch()} /></div>;

  const m = Math.floor(left / 60000);
  const sec = Math.floor((left % 60000) / 1000);
  const qrSize = Math.max(200, Math.min(w * 0.86, (h - 210) * 0.98));
  const title = s.class ? `${s.class.course?.code ?? ''} ${s.class.course?.title ?? s.class.name}`.trim() : s.event?.name ?? s.title;

  return (
    <div className="flex min-h-screen flex-col bg-white text-navy-900">
      <header className="flex items-center justify-between gap-4 px-5 pt-4 pb-2 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <img src={LOGO_SRC} alt="" className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-600">{org?.name}</p>
            <h1 className="truncate text-xl font-extrabold sm:text-2xl">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" icon={isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} onClick={toggleFull}>
            {isFull ? 'Exit full screen' : 'Full screen'}
          </Button>
          <Link to={`/app/attendance/${id}`} className="hidden sm:block"><Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />}>Session</Button></Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-6">
        {!active ? (
          <div className="text-center">
            <p className="text-3xl font-extrabold">This session has ended</p>
            <p className="mt-2 text-slate-600">{s.stats?.present ?? 0} students checked in.</p>
          </div>
        ) : qr ? (
          <>
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_30px_80px_-30px_rgb(11_31_77/0.35)]">
              <QRCodeSVG value={qr.url} size={qrSize} level="M" marginSize={2} bgColor="#ffffff" fgColor="#000000" aria-label="Attendance QR code" />
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              <p className={clsx('flex items-center gap-3 text-4xl font-extrabold tabular-nums sm:text-5xl', left < 60_000 ? 'text-rose-600' : 'text-navy-900')}>
                <Clock className="h-9 w-9 sm:h-11 sm:w-11" /> {m}:{String(sec).padStart(2, '0')}
              </p>
              <p className="flex items-center gap-3 text-3xl font-extrabold text-emerald-700 sm:text-4xl">
                <Users className="h-9 w-9" /> {s.stats?.present ?? 0} present
              </p>
            </div>
            <p className="mt-3 text-base text-slate-600">Scan with your phone camera to record your attendance.{qr.rotationSeconds ? ` The code changes every ${qr.rotationSeconds} seconds.` : ''}</p>
          </>
        ) : (
          <p className="text-lg text-slate-600">{error ?? 'Generating the QR code…'}</p>
        )}
      </main>
    </div>
  );
}
