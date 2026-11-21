import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Crosshair, Loader2, MapPinOff } from 'lucide-react';
import { errorMessage, post } from '@/api/client';
import { Button } from '@/components/ui';
import { GeoError, GEO_MESSAGES, getCurrentLocation } from '@/lib/geo';
import type { AttendanceSession } from '@/types';

/**
 * Asks for the lecturer's location as soon as the session and QR code exist, and saves it as the
 * point students are compared with. Students cannot check in until this has succeeded.
 */
export function LecturerLocation({ session, active }: { session: AttendanceSession; active: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);
  const saved = session.referenceLatitude != null && session.referenceLongitude != null;

  const share = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const point = await getCurrentLocation();
      await post(`/attendance/sessions/${session.id}/location`, point);
      await qc.invalidateQueries({ queryKey: ['session', session.id] });
    } catch (e) {
      setError(e instanceof GeoError ? e.message : errorMessage(e) || GEO_MESSAGES.UNAVAILABLE);
    } finally {
      setBusy(false);
    }
  }, [qc, session.id]);

  useEffect(() => {
    if (!session.canManage || !active || saved || asked.current) return;
    asked.current = true;
    void share();
  }, [session.canManage, active, saved, share]);

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300" data-testid="lecturer-location" aria-live="polite">
      {busy ? (
        <p className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
          <Loader2 className="h-4 w-4 animate-spin" /> Getting your location. Choose Allow if your browser asks.
        </p>
      ) : error ? (
        <p className="flex items-start gap-2 font-semibold text-rose-600" role="alert">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error} Students cannot check in until your location is shared.</span>
        </p>
      ) : saved ? (
        <p className="flex items-start gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>Your location is saved. Students within 20 m of it can check in.</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 font-semibold text-rose-600">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" /> <span>Your location is needed before students can check in.</span>
        </p>
      )}
      {session.canManage && active && !busy && (
        <Button size="sm" variant="secondary" className="mt-2" icon={<Crosshair className="h-4 w-4" />} onClick={share}>
          {saved ? 'Update my location' : 'Share my location'}
        </Button>
      )}
    </div>
  );
}
