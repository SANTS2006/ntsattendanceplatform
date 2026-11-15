import { z } from 'zod';

/**
 * Shared client-side validation rules (UX only — the API re-validates everything).
 * Messages are written to be shown directly under the field.
 */
export const req = (label: string, max = 200) =>
  z.string().trim().min(1, `Enter your ${label}`).max(max, `${cap(label)} must be at most ${max} characters`);

export const opt = (label: string, max = 500) =>
  z.string().trim().max(max, `${cap(label)} must be at most ${max} characters`).optional().or(z.literal(''));

export const emailField = z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address').max(254);
export const optionalEmail = z.string().trim().email('Enter a valid email address').max(254).optional().or(z.literal(''));

export const phoneField = z
  .string()
  .trim()
  .max(30, 'Phone number is too long')
  .refine((v) => !v || /^\+?[0-9 ()-]{6,30}$/.test(v), 'Enter a valid phone number')
  .optional()
  .or(z.literal(''));

export const passwordField = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const codeField = z.string().regex(/^[A-Za-z0-9]{6}$/, 'Enter the 6-character code');
export const totpField = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const urlField = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), 'Enter a valid URL starting with http:// or https://')
  .optional()
  .or(z.literal(''));

/** Code-like identifiers: letters, numbers, dot, dash, underscore, slash. */
export const codeLike = (label: string, max = 40) =>
  req(label, max).regex(/^[A-Za-z0-9._\-/ ]+$/, `${cap(label)} may only contain letters, numbers, spaces and . _ - /`);

/** Number input that may be blank. Use with `valueAsNumber` off; parses strings. */
export const optNumber = (label: string, min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === '' || v === undefined || v === null || Number.isNaN(v) ? undefined : Number(v)))
    .refine((v) => v === undefined || (Number.isFinite(v) && v >= min && v <= max), `${cap(label)} must be between ${min} and ${max}`);

export const reqNumber = (label: string, min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' || v === undefined ? NaN : Number(v)))
    .refine((v) => Number.isFinite(v), `Enter your ${label}`)
    .refine((v) => v >= min && v <= max, `${cap(label)} must be between ${min} and ${max}`);

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
