import crypto from 'node:crypto';
import { env } from '../config/env.js';

/** URL-safe high-entropy random token (default 256 bits). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** SHA-256 hex. Used for storing hashes of high-entropy tokens (QR, refresh, invitation). */
export const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

/** Keyed hash for low-entropy identifiers we must not store raw (e.g. client IPs). */
export const hmac = (value: string, key = env.HASH_PEPPER) => crypto.createHmac('sha256', key).update(value).digest('hex');

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const key = () => {
  const k = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (k.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64)');
  return k;
};

/** AES-256-GCM authenticated encryption for small secrets at rest (e.g. TOTP secrets). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Malformed ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Human-friendly, non-sequential reference: NTS-XXXX-XXXX-XXXX (Crockford base32, 60 bits). */
export function referenceNumber(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % 32];
  return `NTS-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}
