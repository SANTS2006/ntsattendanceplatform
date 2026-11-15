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
 * Reports whether PostgreSQL Row-Level Security policies are active for the connected role.
 * Neon's default (owner) role bypasses RLS, so the policies are dormant there; tenant isolation is
 * then enforced by the tenant-scoped Prisma client and the cross-tenant/immutability triggers.
 */
export async function reportRlsStatus(log: { info: (o: object, m: string) => void }) {
  const [role] = await prisma.$queryRaw<{ u: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const active = !!role && !role.rolsuper && !role.rolbypassrls;
  log.info({ role: role?.u, rlsPoliciesActive: active }, active ? 'Row-Level Security policies active' : 'Row-Level Security policies dormant for this role; app-level tenant scoping and triggers enforce isolation');
}
