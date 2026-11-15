# Tenant isolation

Every organization-owned row carries `organizationId`. Isolation is enforced in layers so a bug in
one layer does not expose another tenant's data.

## 1. Tenant resolution

| Caller | How the tenant is determined |
|---|---|
| Staff (REST) | `org` claim of the signed access token. It is set only by login/refresh (from the user's own memberships) or `POST /auth/switch-organization` (membership checked). On every request `requireTenant` re-loads the membership and rejects suspended members, inactive users and suspended organizations. |
| Staff (Socket.IO) | Same access token; room joins re-check membership and object-level access to the session. Rooms are named `t:<orgId>:session:<sessionId>`. |
| Students (public) | The raw QR token is SHA-256 hashed and looked up; the session row fixes the tenant. Subsequent steps carry a signed attempt token bound to that QR token, session and tenant. |
| Background jobs | The payload names the tenant; handlers re-load the target row through the tenant-scoped client, and exports re-evaluate the requester's permissions at run time. |

A tenant id supplied in a request body or query is **never** used. Mass-assigned
`organizationId` values are overwritten (covered by tests).

## 2. Application layer: tenant-scoped Prisma client (`db/tenant.ts`)

- A query extension adds `organizationId = <tenant>` to every read, update and delete and forces it
  onto every create for all tenant models.
- `tenantDb(orgId)` runs each top-level query in a transaction that first sets
  `app.tenant_id`, so Row-Level Security applies.
- `withTenant(orgId, fn)` gives multi-step operations one transaction with both protections.

## 3. Database layer (migration `tenant_integrity` and `tenant_error_codes`)

- **Cross-tenant reference triggers**: inserting or updating a row that points at another tenant's
  row (e.g. enrolling org B's student into org A's class) raises `NTS_CROSS_TENANT_REFERENCE`
  (SQLSTATE `NTS01`). The API reports it as 404.
- **Immutable tenant id**: `organizationId` cannot change (`NTS02`).
- **Row-Level Security** on all tenant tables with `FORCE ROW LEVEL SECURITY`. Inside a tenant
  transaction only that tenant's rows are visible or writable.
- **Append-only audit log**: UPDATE and DELETE on `audit_logs` are rejected.

RLS is ignored for superusers and BYPASSRLS roles — including Neon's default owner role, which this
deployment uses. The policies therefore stay defined but dormant, and isolation rests on the
tenant-scoped Prisma client (every query filtered by `organizationId`), the cross-tenant foreign-key
and immutability triggers (which apply to every role), and the API isolation tests. The start-up log
reports `rlsPoliciesActive`. To re-activate RLS later, connect the app as a role created without
BYPASSRLS that has only data privileges; no code change is needed.

## 4. Files and caches

- Storage keys are `tenants/<orgId>/<area>/YYYY/MM/<uuid>.<ext>`; Cloudinary public ids mirror them.
- Selfies and reports are only reachable through short-lived signed URLs issued after authorization.
- Cache keys are namespaced `nts:t:<orgId>:…`; no tenant data is cached in process memory.

## 5. Verification (automated)

`backend/tests/tenancy/isolation.test.ts` proves that organization A cannot read, update, delete or
reference organization B's students, academic records, sessions, records, selfies, reports,
settings or background jobs, and that RLS, the triggers, immutability and the append-only audit log
hold even for raw SQL.
