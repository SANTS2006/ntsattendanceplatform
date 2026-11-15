import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Base (unscoped) Prisma client. Use ONLY for system paths that are not tenant-owned
 * (users, auth tokens, platform administration, resolving a tenant from a validated token).
 * Tenant-owned data must go through `tenantDb()` / `withTenant()` in ./tenant.ts.
 */
export const prisma = new PrismaClient({
  log: env.isProd ? ['error'] : ['error', 'warn'],
});

export type Db = typeof prisma;

/**
 * Row-Level Security is silently skipped for superusers and BYPASSRLS roles (e.g. Neon console
 * roles, which inherit neon_superuser). Refuse to run like that in production.
 */
export async function assertRlsEnforced(log: { warn: (o: object, m: string) => void }) {
  const [role] = await prisma.$queryRaw<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role && (role.rolsuper || role.rolbypassrls)) {
    const msg = `Database role "${role.u}" bypasses Row-Level Security (superuser/BYPASSRLS). Connect as nts_app — see documentation/DATABASE.md.`;
    if (env.isProd) throw new Error(msg);
    log.warn({ role: role.u }, msg);
  }
}
