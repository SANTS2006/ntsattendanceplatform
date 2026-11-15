import argon2 from 'argon2';
import { z } from 'zod';

/** Argon2id, OWASP-recommended parameters (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, OPTIONS);

export async function verifyPassword(hash: string | null, pw: string) {
  if (!hash) return dummyVerify(pw); // Google-only account: no password set
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

/** Used for unknown accounts so response timing does not reveal whether an email exists. */
let dummy: Promise<string> | null = null;
export const dummyVerify = async (pw: string) => {
  dummy ??= hashPassword('nts-timing-equalizer-password');
  await verifyPassword(await dummy, pw);
  return false;
};

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');
