import type { PermissionKey } from '../config/permissions.js';
import type { TenantDb } from '../db/tenant.js';
import { forbidden } from '../lib/errors.js';
import type { AccessClaims } from '../lib/jwt.js';

/** 'all' = organization-wide; string[] = limited to these department ids. */
export type PermissionScope = 'all' | string[];

export class TenantContext {
  constructor(
    readonly userId: string,
    readonly organizationId: string,
    readonly membershipId: string,
    readonly isOwner: boolean,
    readonly permissions: Map<PermissionKey, PermissionScope>,
    readonly lecturerId: string | null,
    readonly timezone: string,
    readonly db: TenantDb,
  ) {}

  has(p: PermissionKey): boolean {
    return this.isOwner || this.permissions.has(p);
  }

  /** Returns the scope for a permission, or null when not granted. */
  scope(p: PermissionKey): PermissionScope | null {
    if (this.isOwner) return 'all';
    return this.permissions.get(p) ?? null;
  }

  require(p: PermissionKey) {
    if (!this.has(p)) throw forbidden();
  }

  /** Prisma `departmentId` filter for a department-scopable permission (undefined = no filter). */
  departmentFilter(p: PermissionKey): { in: string[] } | undefined {
    const s = this.scope(p);
    if (s === null) throw forbidden();
    return s === 'all' ? undefined : { in: s };
  }

  permissionList(): string[] {
    return [...this.permissions.keys()];
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims;
      ctx?: TenantContext;
      platformRole?: 'SUPER_ADMIN' | 'PLATFORM_ADMIN';
      valid: { body: any; query: any; params: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  }
}

export function tenantCtx(req: Express.Request): TenantContext {
  if (!req.ctx) throw forbidden('Organization context required', 'NO_ORGANIZATION');
  return req.ctx;
}
