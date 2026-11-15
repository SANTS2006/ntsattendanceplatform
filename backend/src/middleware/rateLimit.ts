import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { getRedis } from '../infra/redis.js';

/**
 * Rate limiters. Redis-backed (shared across instances) when REDIS_URL is set;
 * in-memory only in development/test.
 */
function store(prefix: string) {
  const r = getRedis();
  if (!r) return undefined;
  return new RedisStore({
    prefix: `nts:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) => r.call(command, ...args) as Promise<RedisReply>,
  });
}

/** IPv6 addresses are grouped by /64 so one host cannot rotate through its subnet. */
const ipKey = (req: Request) => {
  const ip = req.ip ?? 'unknown';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
};

export function limiter(
  name: string,
  opts: { windowMs: number; limit: number; key?: (req: Request) => string; skipSuccessful?: boolean },
): RequestHandler {
  if (env.RATE_LIMIT_DISABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: store(name),
    skipSuccessfulRequests: opts.skipSuccessful ?? false,
    keyGenerator: opts.key ?? ipKey,
    handler: (_req, res) => {
      res.status(429).json({ success: false, message: 'Too many requests. Please try again later.', errors: {}, code: 'RATE_LIMITED' });
    },
  });
}

const body = (req: Request, field: string) => {
  const v = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof v === 'string' ? v.toLowerCase().slice(0, 200) : '';
};

export const limits = {
  api: () => limiter('api', { windowMs: 60_000, limit: 600 }),
  login: () => limiter('login', { windowMs: 15 * 60_000, limit: 10, key: (r) => `${ipKey(r)}|${body(r, 'email')}`, skipSuccessful: true }),
  loginIp: () => limiter('login-ip', { windowMs: 15 * 60_000, limit: 50 }),
  register: () => limiter('register', { windowMs: 60 * 60_000, limit: 10 }),
  passwordReset: () => limiter('pwreset', { windowMs: 60 * 60_000, limit: 5, key: (r) => `${ipKey(r)}|${body(r, 'email')}` }),
  emailVerify: () => limiter('verify', { windowMs: 15 * 60_000, limit: 20 }),
  refresh: () => limiter('refresh', { windowMs: 60_000, limit: 30 }),
  /** Public attendance: per client per QR token path. */
  publicValidate: () => limiter('pub-validate', { windowMs: 60_000, limit: 30 }),
  publicVerifyStudent: () =>
    limiter('pub-student', { windowMs: 60_000, limit: 12, key: (r) => `${ipKey(r)}|${String(r.params.token ?? '').slice(0, 16)}` }),
  publicLocation: () => limiter('pub-location', { windowMs: 60_000, limit: 20 }),
  publicUpload: () => limiter('pub-upload', { windowMs: 60_000, limit: 6 }),
  publicSubmit: () => limiter('pub-submit', { windowMs: 60_000, limit: 10 }),
  publicConfirmation: () => limiter('pub-confirm', { windowMs: 60_000, limit: 20 }),
};
