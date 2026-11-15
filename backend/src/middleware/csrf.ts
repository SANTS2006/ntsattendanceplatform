import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

/**
 * CSRF protection for the only cookie-authenticated endpoints (refresh / logout).
 * 1. The refresh cookie is SameSite=Strict and scoped to /api/v1/auth.
 * 2. A custom header is required — browsers cannot send it cross-origin without a CORS
 *    preflight, which the strict CORS policy rejects.
 * 3. If an Origin header is present it must be an allowed origin.
 * All other endpoints use Bearer tokens (not ambient credentials) and are not CSRF-prone.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-nts-csrf') !== '1') throw forbidden('Missing CSRF header', 'CSRF_FAILED');
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([...env.corsOrigins, new URL(env.APP_URL).origin, new URL(env.API_URL).origin]);
    if (!allowed.has(origin)) throw forbidden('Origin not allowed', 'CSRF_FAILED');
  }
  next();
}
