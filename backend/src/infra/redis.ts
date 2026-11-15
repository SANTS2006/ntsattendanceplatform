import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Redis is required in production (queues, rate limits, socket fan-out, cache).
 * In development/test it is optional: when REDIS_URL is unset the app degrades to
 * in-process equivalents (documented in documentation/ARCHITECTURE.md).
 */
let client: Redis | null = null;

/** Where we connect, for logs — never includes the password. */
export function redisTarget() {
  if (!env.REDIS_URL) return null;
  try {
    const u = new URL(env.REDIS_URL);
    return { host: u.hostname, port: Number(u.port || 6379), tls: u.protocol === 'rediss:' };
  } catch {
    return { host: 'unparseable REDIS_URL', port: 0, tls: false };
  }
}

// Many connections (cache, queues, workers, socket adapter) fail together when Redis is
// unreachable; log one clear line per minute instead of a stack trace per connection.
let lastErrorLog = 0;
let suppressed = 0;
export function logRedisError(err: Error & { code?: string }) {
  const now = Date.now();
  if (now - lastErrorLog < 60_000) {
    suppressed++;
    return;
  }
  const t = redisTarget();
  logger.error(
    { err: err.code ?? err.message, host: t?.host, port: t?.port, tls: t?.tls, suppressedSinceLast: suppressed },
    err.code === 'ETIMEDOUT'
      ? 'Redis connection timed out — check REDIS_URL (plain redis://… URL from Redis Cloud) and that the database accepts connections from this server'
      : 'Redis connection error',
  );
  lastErrorLog = now;
  suppressed = 0;
}

const base: RedisOptions = {
  connectTimeout: 15_000,
  // Back off up to 10 s between reconnect attempts instead of hammering an unreachable host.
  retryStrategy: (times) => Math.min(times * 500, 10_000),
};

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    // Commands fail (after 3 retries) rather than hang forever, so rate limits and health checks
    // return an error instead of stalling requests when Redis is down.
    client = new Redis(env.REDIS_URL, { ...base, maxRetriesPerRequest: 3, enableReadyCheck: true });
    client.on('error', logRedisError);
  }
  return client;
}

/** Separate connection factory (BullMQ workers and the socket.io adapter need dedicated connections). */
export function newRedisConnection(): Redis {
  if (!env.REDIS_URL) throw new Error('REDIS_URL not configured');
  const c = new Redis(env.REDIS_URL, { ...base, maxRetriesPerRequest: null });
  c.on('error', logRedisError);
  return c;
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => undefined);
  client = null;
}
