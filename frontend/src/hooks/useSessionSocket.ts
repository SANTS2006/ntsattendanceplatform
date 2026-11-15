import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken, tokenStore } from '@/api/client';

/**
 * Subscribes to tenant-scoped real-time events for one attendance session. The server re-checks
 * membership and session access before joining the room.
 */
export function useSessionSocket(sessionId: string | undefined, handlers: Record<string, (payload: unknown) => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let socket: Socket | null = null;
    let cancelled = false;
    (async () => {
      const token = tokenStore.get() ?? (await refreshAccessToken());
      if (!token || cancelled) return;
      socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: (cb) => cb({ token: tokenStore.get() ?? token }) });
      socket.on('connect', () => {
        setConnected(true);
        socket?.emit('session:subscribe', { sessionId }, () => undefined);
      });
      socket.on('disconnect', () => setConnected(false));
      socket.on('connect_error', async () => {
        setConnected(false);
        await refreshAccessToken(); // access token may have expired; auth callback picks up the new one
      });
      for (const ev of ['attendance:recorded', 'attendance:corrected', 'session:updated']) {
        socket.on(ev, (p: unknown) => ref.current[ev]?.(p));
      }
    })();
    return () => {
      cancelled = true;
      socket?.emit('session:unsubscribe', { sessionId });
      socket?.disconnect();
    };
  }, [sessionId]);

  return { connected };
}
