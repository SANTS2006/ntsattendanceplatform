import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Redis is required in production (queues, rate limits, socket fan-out, cache).
 * In development/test it is optional: when REDIS_URL is unset the app degrades to
 * in-process equivalents (documented in documentation/ARCHITECTURE.md).
 */
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
    client.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
  }
  return client;
}

/** Separate connection factory (BullMQ workers and the socket.io adapter need dedicated connections). */
export function newRedisConnection(): Redis {
  if (!env.REDIS_URL) throw new Error('REDIS_URL not configured');
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => undefined);
  client = null;
}
