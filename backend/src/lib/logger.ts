import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logger. Sensitive fields are redacted at the serializer level so that
 * passwords, JWTs, refresh tokens, QR tokens and cookies never reach log sinks.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-attempt-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.attemptToken',
      '*.mfaSecret',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'nts-api' },
});

/** Replace raw QR / confirmation / invitation tokens embedded in URLs before logging. */
export function redactUrl(url: string): string {
  return url
    .replace(/(\/public\/attendance\/)[^/?#]+/g, '$1[REDACTED]')
    .replace(/([?&](token|sig|confirmation)=)[^&#]+/gi, '$1[REDACTED]');
}
