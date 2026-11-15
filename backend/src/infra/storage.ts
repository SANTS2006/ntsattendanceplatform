import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { hmac, safeEqual } from '../lib/crypto.js';

/**
 * Private file storage on Cloudinary (images AND documents).
 * Keys are tenant- or user-prefixed and contain random UUIDs:
 *   tenants/<orgId>/<area>/YYYY/MM/<uuid>.<ext>     (selfies, logos, imports, reports)
 *   users/<userId>/avatars/YYYY/MM/<uuid>.jpg        (profile pictures)
 * Nothing is publicly readable: assets use Cloudinary's "authenticated" delivery type and are
 * only reachable through short-lived signed download URLs issued after an authorization check.
 *
 * Automated tests use an in-memory driver so they never touch a real Cloudinary account.
 */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number, downloadName?: string): Promise<string>;
  healthy(): Promise<boolean>;
}

const SAFE_KEY = /^(tenants|users)\/[0-9a-f-]{36}\/[a-z-]+\/[A-Za-z0-9/_.-]+$/;
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

const ym = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export type TenantArea = 'selfies' | 'logos' | 'imports' | 'reports';
export function tenantKey(organizationId: string, area: TenantArea, ext: string) {
  return `tenants/${organizationId}/${area}/${ym()}/${crypto.randomUUID()}.${ext}`;
}
export function userKey(userId: string, area: 'avatars', ext: string) {
  return `users/${userId}/${area}/${ym()}/${crypto.randomUUID()}.${ext}`;
}

export const keyBelongsToTenant = (key: string, organizationId: string) => key.startsWith(`tenants/${organizationId}/`);

function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Unsafe storage key');
}
const extOf = (key: string) => (key.split('.').pop() ?? '').toLowerCase();

class CloudinaryStorage implements StorageDriver {
  private ready = false;
  private configure() {
    if (this.ready) return;
    cloudinary.config({ cloud_name: env.CLOUDINARY_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
    this.ready = true;
  }
  /** Images are stored without extension (Cloudinary tracks format); raw files keep it. */
  private asset(key: string) {
    assertSafeKey(key);
    const ext = extOf(key);
    return IMAGE_EXT.has(ext)
      ? { publicId: key.replace(/\.[a-z0-9]+$/i, ''), resourceType: 'image' as const, format: ext === 'jpeg' ? 'jpg' : ext }
      : { publicId: key, resourceType: 'raw' as const, format: '' };
  }
  async put(key: string, body: Buffer) {
    this.configure();
    const a = this.asset(key);
    await new Promise<void>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: a.publicId, type: 'authenticated', resource_type: a.resourceType, overwrite: false, invalidate: true, ...(a.format ? { format: a.format } : {}) },
        (err) => (err ? reject(new Error(`Cloudinary upload failed: ${err.message}`)) : resolve()),
      );
      stream.end(body);
    });
  }
  async get(key: string) {
    const res = await fetch(await this.signedUrl(key, 60), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string) {
    this.configure();
    const a = this.asset(key);
    await cloudinary.uploader.destroy(a.publicId, { type: 'authenticated', resource_type: a.resourceType, invalidate: true });
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName?: string) {
    this.configure();
    const a = this.asset(key);
    return cloudinary.utils.private_download_url(a.publicId, a.format, {
      type: 'authenticated',
      resource_type: a.resourceType,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
      ...(downloadName ? { attachment: true } : {}),
    });
  }
  async healthy() {
    this.configure();
    await cloudinary.api.ping();
    return true;
  }
}

/** Test-only driver: files live in process memory and are served by the test-only /files route. */
class MemoryStorage implements StorageDriver {
  private files = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    this.files.set(key, { body, contentType });
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('Not found');
    return f.body;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName?: string) {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const name = downloadName ?? '';
    const qs = new URLSearchParams({ key, exp: String(exp), sig: signMemory(key, exp, name), ...(name ? { name } : {}) });
    return `${env.API_URL}/api/v1/files?${qs.toString()}`;
  }
  async healthy() {
    return true;
  }
  entry(key: string) {
    return this.files.get(key);
  }
}

const signMemory = (key: string, exp: number, name: string) => hmac(`${key}|${exp}|${name}`, env.FILE_URL_SECRET);
export function verifyMemorySignature(key: string, exp: number, name: string, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signMemory(key, exp, name), sig);
}

export const memoryStorage = env.isTest ? new MemoryStorage() : null;

/** All files (documents and images). */
export const storage: StorageDriver = memoryStorage ?? new CloudinaryStorage();
/** Alias kept for readability at image call sites. */
export const imageStorage = storage;
