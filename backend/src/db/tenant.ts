import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Tenant-scoped data access.
 *
 * Layer 1 (application): a Prisma query extension injects `organizationId = <tenant>` into the
 * WHERE clause of every read/update/delete and forces it onto every create, for all
 * tenant-owned models. Callers cannot widen the scope: an `organizationId` in caller input is
 * overwritten.
 *
 * Layer 2 (database): each operation runs in a transaction that sets the transaction-local
 * `app.tenant_id`, so PostgreSQL Row-Level Security rejects rows of any other tenant even if
 * the application filter were bypassed (e.g. a nested include or a coding mistake).
 *
 * Layer 3 (database): triggers reject any row referencing another tenant's row.
 */
export const TENANT_MODELS = new Set<string>([
  'OrganizationMembership', 'Role', 'MembershipRole', 'Invitation', 'Faculty', 'Department', 'Program',
  'AcademicLevel', 'AcademicYear', 'Semester', 'Course', 'Class', 'Student', 'Lecturer', 'ClassLecturer',
  'Enrollment', 'Event', 'EventParticipant', 'EventManager', 'AttendanceSession', 'QRToken',
  'AttendanceRecord', 'AttendanceSelfie', 'AttendanceVerification', 'StudentImport', 'ReportExport',
  'OrganizationSettings', 'SupportTicket', 'Feedback',
]);

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = Record<string, any>;

export function scopeArgs(model: string, operation: string, args: AnyArgs | undefined, organizationId: string): AnyArgs {
  if (!TENANT_MODELS.has(model)) return args ?? {};
  const a: AnyArgs = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) a.where = { ...(a.where ?? {}), organizationId };
  if (operation === 'create') a.data = { ...(a.data ?? {}), organizationId };
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    a.data = (Array.isArray(a.data) ? a.data : [a.data]).map((d: AnyArgs) => ({ ...d, organizationId }));
  }
  if (operation === 'upsert') {
    a.create = { ...(a.create ?? {}), organizationId };
    if (a.update) {
      const { organizationId: _ignored, ...rest } = a.update;
      a.update = rest;
    }
  }
  if ((operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') && a.data) {
    const { organizationId: _ignored, ...rest } = a.data;
    a.data = rest;
  }
  return a;
}

function assertTenantId(organizationId: string) {
  if (!UUID_RE.test(organizationId)) throw new Error('Invalid tenant id');
}

const setTenantSql = (organizationId: string) => prisma.$executeRaw`SELECT set_config('app.tenant_id', ${organizationId}, true)`;

/** Application-level scoping only (used inside an interactive tenant transaction). */
function scopedExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as AnyArgs, organizationId) as never);
        },
      },
    },
  });
}

/** Scoping + RLS: every top-level operation runs in its own tenant-bound transaction. */
function scopedRlsExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: 'tenant-scope-rls',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeArgs(model, operation, args as AnyArgs, organizationId);
          if (!TENANT_MODELS.has(model)) return query(scoped as never);
          const [, result] = await prisma.$transaction([setTenantSql(organizationId), query(scoped as never)]);
          return result;
        },
      },
    },
  });
}

export function tenantDb(organizationId: string) {
  assertTenantId(organizationId);
  return prisma.$extends(scopedRlsExtension(organizationId));
}
export type TenantDb = ReturnType<typeof tenantDb>;

const txClients = new Map<string, ReturnType<typeof makeTxClient>>();
function makeTxClient(organizationId: string) {
  return prisma.$extends(scopedExtension(organizationId));
}

export type TenantTx = Parameters<Parameters<ReturnType<typeof makeTxClient>['$transaction']>[0]>[0];

/**
 * Run `fn` in one interactive transaction bound to the tenant (both scoping layers active).
 * Use for multi-step writes that must be atomic (attendance submission, imports, ...).
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
): Promise<T> {
  assertTenantId(organizationId);
  let client = txClients.get(organizationId);
  if (!client) {
    client = makeTxClient(organizationId);
    if (txClients.size > 5000) txClients.clear();
    txClients.set(organizationId, client);
  }
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${organizationId}, true)`;
    return fn(tx);
  }, { timeout: options?.timeout ?? 15_000, isolationLevel: options?.isolationLevel });
}
