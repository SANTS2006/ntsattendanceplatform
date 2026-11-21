# Architecture

## Overview

```
 Phones (students, anonymous)          Staff browsers (lecturers, admins, Super Admin)
            │  HTTPS                                   │ HTTPS + WebSocket
            ▼                                          ▼
   ┌───────────────────────── React SPA (Vite build, static hosting/CDN) ─────────────────────────┐
   └───────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                   │ /api/v1 (REST, JSON envelope) · /socket.io
                     ┌─────────────────────────────▼─────────────────────────────┐
                     │  API instances (Express 5, stateless, horizontally scaled) │
                     │  auth → tenant context → permission → validation → service │
                     └──────┬───────────────┬───────────────┬───────────────┬─────┘
                            │               │               │               │
                  PostgreSQL (Neon)     Redis          Cloudinary        Brevo
                  + RLS, triggers   queues · rate      selfies/logos     email
                                    limits · cache ·   (private, signed
                                    socket fan-out     expiring URLs)
                            ▲               │
                            └──── BullMQ workers (imports, reports, email, selfie retention)
```

## Backend layout (`backend/src`)

| Path | Responsibility |
|---|---|
| `config/` | Zod-validated environment (`env.ts`; refuses to boot when misconfigured), permission catalogue and system roles |
| `db/prisma.ts` | Base Prisma client (system paths only) + `reportRlsStatus` boot log |
| `db/tenant.ts` | **Tenant-scoped data access**: query extension injecting `organizationId`, RLS-bound transactions (`tenantDb`, `withTenant`) |
| `middleware/` | Authentication, tenant context, permission checks, rate limits, CSRF guard, error mapping |
| `lib/route.ts` | `defineRoute`: one declaration registers the Express chain *and* its OpenAPI operation |
| `lib/` | Crypto (tokens, AES-GCM, HMAC), JWT, TOTP, Haversine distance and reading freshness, student-ID rules, time zones |
| `infra/` | Redis, BullMQ queue (inline fallback in dev), Cloudinary storage, Brevo mailer, Cloudflare R2 backup store, Socket.IO |
| `modules/*` | Feature modules: `auth`, `organizations`, `members`, `students` (+ import), `academics`, `lecturers`, `events`, `attendance`, `public-attendance`, `reports`, `platform`, `notifications`, `audit`, `media`, `health` |
| `jobs/` | Background job handlers |
| `server.ts` / `worker.ts` | API process / worker process entry points |

Services contain the business logic; routes only validate and delegate. The tenant-scoped Prisma
client plays the role of the repository layer: every tenant-owned query goes through it.

## Frontend layout (`frontend/src`)

| Path | Responsibility |
|---|---|
| `api/client.ts` | Axios client: in-memory access token, single-flight refresh, CSRF header, typed envelope helpers |
| `auth/AuthProvider.tsx` | Session restore, login (password/Google/MFA), organization switching, branded sign-out |
| `components/brand.tsx` | Logo, logo spinner, page/module/table loaders, sign-out overlay |
| `components/ui.tsx` | Design-system primitives (buttons, inputs, tables, modals, tabs, badges, pagination) |
| `layouts/` | Organization shell (sidebar + user card), platform shell |
| `features/*` | Pages per domain (auth, attend, attendance, students, academics, people, reports, settings, platform, marketing) |
| `routes/guards.tsx` | Navigation guards (the API remains the authority) |

## Key decisions

1. **Shared database, tenant column, three isolation layers** (application scoping, cross-tenant
   triggers, PostgreSQL RLS). See [TENANT_ISOLATION.md](TENANT_ISOLATION.md).
2. **Tenant comes from the signed access token**, set only after a membership check, and is
   re-verified on every request. The public attendance flow resolves the tenant from the QR token.
3. **Access token in memory, refresh token in an HttpOnly SameSite=Strict cookie** with rotation,
   reuse detection and a 20 s concurrency grace window (two tabs refreshing at once).
4. **Sign-up creates no user until the emailed code is verified** (`PendingRegistration`).
5. **All files on Cloudinary as private (`authenticated`) assets** — selfies, logos, profile pictures, imports and reports — reached only through short-lived signed URLs. Database backups go to Cloudflare R2.
6. **Redis optional in development**: jobs run in-process, rate limits in memory. Production
   requires Redis (validated at startup).
7. **Server clock and server math only**: QR expiry, attendance timestamps and the distance to the lecturer's location are
   computed server-side.

## Scalability plan

- API instances are stateless; scale horizontally behind a load balancer. Socket.IO uses the Redis
  adapter so events reach lecturers connected to any instance.
- Workers scale independently (`npm run start:worker`).
- PostgreSQL connections go through Neon's pooler (PgBouncer, transaction mode); the tenant RLS
  context uses transaction-local settings, which is pooler-safe.
- The hot path (student check-in) is a handful of indexed lookups and one transaction; uniqueness
  constraints make concurrent duplicates harmless.
- Measured on one laptop process: 1,000 full check-in flows in 10.5 s with 0 failures (see
  [TESTING.md](TESTING.md)). Production capacity must be measured with k6 against staging.
- Optimizations available if measurements require them: cache the QR-token → session lookup in
  Redis, batch audit writes, partition `attendance_records` by month at large volume.
