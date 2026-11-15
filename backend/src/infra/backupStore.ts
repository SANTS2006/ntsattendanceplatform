import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

/**
 * Cloudflare R2 bucket used exclusively for database backups (S3-compatible API).
 * Tests use an in-memory store so they never touch a real bucket.
 */
export interface BackupStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number, downloadName: string): Promise<string>;
  healthy(): Promise<boolean>;
  readonly description: string;
}

const SAFE = /^backups\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.json\.gz$/;
const assertKey = (k: string) => {
  if (!SAFE.test(k)) throw new Error('Unsafe backup key');
};

class R2Store implements BackupStore {
  private client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  private bucket = env.R2_BUCKET!;
  readonly description = `Cloudflare R2 · ${env.R2_BUCKET}`;
  async put(key: string, body: Buffer) {
    assertKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/gzip' }));
  }
  async get(key: string) {
    assertKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
  async delete(key: string) {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName: string) {
    assertKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${downloadName}"` }),
      { expiresIn: ttlSeconds },
    );
  }
  async healthy() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }
}

class MemoryStore implements BackupStore {
  files = new Map<string, Buffer>();
  readonly description = 'in-memory (tests)';
  async put(key: string, body: Buffer) {
    assertKey(key);
    this.files.set(key, body);
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('Not found');
    return f;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  async signedUrl(key: string) {
    return `memory://${key}`;
  }
  async healthy() {
    return true;
  }
}

export const backupStore: BackupStore | null = env.isTest ? new MemoryStore() : env.backupsEnabled ? new R2Store() : null;
