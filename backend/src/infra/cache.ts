import { getRedis } from './redis.js';

/**
 * Tenant-aware cache. Every key is namespaced by tenant (`t:<orgId>:...`) or explicitly global
 * (`g:...`) so cached values can never be served to another organization.
 * Without Redis (dev/test) caching is disabled rather than kept in process memory, so multiple
 * instances can never disagree about tenant-sensitive state.
 */
export const cacheKeys = {
  tenant: (organizationId: string, ...parts: string[]) => `nts:t:${organizationId}:${parts.join(':')}`,
  global: (...parts: string[]) => `nts:g:${parts.join(':')}`,
};

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  const v = await r.get(key).catch(() => null);
  return v ? (JSON.parse(v) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const r = getRedis();
  if (!r) return;
  await r.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
}

export async function cacheDel(...keys: string[]) {
  const r = getRedis();
  if (!r || keys.length === 0) return;
  await r.del(...keys).catch(() => undefined);
}

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  if (value !== null && value !== undefined) await cacheSet(key, value, ttlSeconds);
  return value;
}
