import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken, type AccessClaims } from '../lib/jwt.js';
import { buildTenantContext } from '../middleware/auth.js';
import { loadSession } from '../modules/attendance/access.js';
import { newRedisConnection } from './redis.js';

/**
 * Real-time attendance monitoring.
 * - Connections authenticate with the same short-lived access token as the REST API.
 * - Rooms are tenant-scoped: `t:<orgId>:session:<sessionId>`. A socket joins only after the
 *   server re-checks membership and object-level access to that session.
 * - Nothing is ever broadcast globally.
 * - With Redis, the redis adapter fans events out across API instances.
 */
let io: Server | null = null;

export const sessionRoom = (organizationId: string, sessionId: string) => `t:${organizationId}:session:${sessionId}`;
export const orgRoom = (organizationId: string) => `t:${organizationId}:org`;

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: [...env.corsOrigins, new URL(env.APP_URL).origin], credentials: true },
    serveClient: false,
    maxHttpBufferSize: 10_000,
  });
  if (env.REDIS_URL) io.adapter(createAdapter(newRedisConnection(), newRedisConnection()));

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('UNAUTHORIZED'));
      const claims = verifyAccessToken(token);
      if (!claims.org) return next(new Error('NO_ORGANIZATION'));
      socket.data.auth = claims;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as AccessClaims;
    socket.on('session:subscribe', async (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        const sessionId = (payload as { sessionId?: unknown })?.sessionId;
        if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('INVALID');
        const ctx = await buildTenantContext(auth.sub, auth.org!);
        await loadSession(ctx, sessionId, 'read');
        await socket.join(sessionRoom(ctx.organizationId, sessionId));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, code: 'FORBIDDEN' });
      }
    });
    socket.on('session:unsubscribe', async (payload: unknown) => {
      const sessionId = (payload as { sessionId?: unknown })?.sessionId;
      if (typeof sessionId === 'string') await socket.leave(sessionRoom(auth.org!, sessionId));
    });
    socket.on('org:subscribe', async (_p: unknown, ack?: (r: unknown) => void) => {
      try {
        const ctx = await buildTenantContext(auth.sub, auth.org!);
        if (ctx.scope('attendance.read_all') !== 'all') throw new Error('FORBIDDEN');
        await socket.join(orgRoom(ctx.organizationId));
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, code: 'FORBIDDEN' });
      }
    });
  });
  logger.info({ redisAdapter: !!env.REDIS_URL }, 'realtime initialised');
  return io;
}

export function emitToSession(organizationId: string, sessionId: string, event: string, payload: unknown) {
  if (!io) return;
  io.to(sessionRoom(organizationId, sessionId)).emit(event, payload);
  io.to(orgRoom(organizationId)).emit(event, payload);
}

export async function closeRealtime() {
  await io?.close();
  io = null;
}
