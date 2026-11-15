import { z } from 'zod';

// Blank values (e.g. "GOOGLE_CLIENT_ID=" copied from .env.example) mean "not set".
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const bool = z.preprocess(blank, z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional());
const optional = z.preprocess(blank, z.string().optional());

/**
 * Runtime configuration. Services: Neon PostgreSQL · Cloudinary (all files) · Brevo (email) ·
 * Redis (production queues/realtime) · Cloudflare R2 (database backups) · Google sign-in.
 * Values are validated at startup; error messages list variable names only, never values.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.string().url(),
    API_URL: z.preprocess(blank, z.string().url().optional()),
    CORS_ORIGINS: z.string().default(''),
    TRUST_PROXY: z.string().default('loopback'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: optional,

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_PUBLIC_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().min(40), // base64 of 32 random bytes
    HASH_PEPPER: z.string().min(16),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),

    CLOUDINARY_NAME: optional,
    CLOUDINARY_API_KEY: optional,
    CLOUDINARY_API_SECRET: optional,

    BREVO_API_KEY: optional,
    MAIL_FROM: z.string().default('NTSAttend <no-reply@localhost>'),

    GOOGLE_CLIENT_ID: optional,

    R2_ACCOUNT_ID: optional,
    R2_ACCESS_KEY_ID: optional,
    R2_SECRET_ACCESS_KEY: optional,
    R2_BUCKET: optional,
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(0).max(24 * 7).default(24),

    WEB_DIST_DIR: optional, // built frontend served by the API (single-origin hosting on Render)
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    RATE_LIMIT_DISABLED: bool,
  })
  .superRefine((v, ctx) => {
    const need = (keys: (keyof typeof v)[], why: string) => {
      for (const k of keys) if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required (${why})` });
    };
    if (v.NODE_ENV !== 'test') {
      need(['CLOUDINARY_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'], 'Cloudinary file storage');
      need(['BREVO_API_KEY'], 'Brevo email');
    }
    if (v.NODE_ENV === 'production') {
      need(['REDIS_URL'], 'production queues and realtime');
      if (v.RATE_LIMIT_DISABLED) ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_DISABLED'], message: 'Rate limiting cannot be disabled in production' });
      if (/localhost/.test(v.MAIL_FROM)) ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'Set MAIL_FROM to a sender verified in Brevo' });
    }
    const r2 = [v.R2_ACCOUNT_ID, v.R2_ACCESS_KEY_ID, v.R2_SECRET_ACCESS_KEY, v.R2_BUCKET].filter(Boolean).length;
    if (r2 > 0 && r2 < 4) ctx.addIssue({ code: 'custom', path: ['R2_BUCKET'], message: 'Set all four R2_* variables (or none to disable backups)' });
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const d = parsed.data;
export const env = {
  ...d,
  API_URL: d.API_URL ?? d.APP_URL,
  isProd: d.NODE_ENV === 'production',
  isTest: d.NODE_ENV === 'test',
  cookieSecure: d.NODE_ENV === 'production',
  corsOrigins: [...new Set([new URL(d.APP_URL).origin, ...d.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)])],
  backupsEnabled: !!(d.R2_ACCOUNT_ID && d.R2_ACCESS_KEY_ID && d.R2_SECRET_ACCESS_KEY && d.R2_BUCKET),
  /** Secret for test-only signed file URLs. */
  FILE_URL_SECRET: d.HASH_PEPPER,
};
export type Env = typeof env;
