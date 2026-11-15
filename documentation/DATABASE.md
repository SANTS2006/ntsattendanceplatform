# Database

PostgreSQL on **Neon** for every environment (use separate Neon branches for development, tests and
production), managed with Prisma migrations (`backend/prisma/migrations`). Nothing is stored on the
developer's computer.

## Models (45)

- **Identity:** User, PlatformAdmin, UserToken, PendingRegistration, RefreshToken, LoginAttempt
- **Tenancy & RBAC:** Organization, OrganizationSettings, OrganizationMembership, Role, Permission,
  RolePermission, MembershipRole, Invitation
- **Academics:** Faculty, Department, Program, AcademicLevel, AcademicYear, Semester, Course, Class,
  ClassLecturer, Enrollment, Lecturer, Student
- **Events:** Event, EventParticipant, EventManager
- **Attendance:** AttendanceSession, QRToken, AttendanceRecord, AttendanceSelfie, AttendanceVerification
- **Operations:** StudentImport, ReportExport, Notification, AuditLog, SecurityEvent, PlatformSetting

Key constraints: student ID unique per organization (`organizationId, normalizedNumber`);
attendance unique per `(sessionId, studentId)` and per `(sessionId, idempotencyKey)`; membership
unique per `(organizationId, userId)`; composite indexes on tenant + common filters; CHECK
constraints on coordinates, radius, accuracy and student-ID length settings. Tenant triggers, RLS
and the append-only audit log live in raw-SQL migrations (Prisma ignores them, so they survive
future `migrate` runs).

## Connecting to Neon

1. Create a Neon project and database. Note the **direct** connection string (owner role, e.g.
   `neondb_owner`) and the **pooled** host (`…-pooler…`).
2. In `backend/.env` set `DIRECT_URL` to the direct owner connection (`?sslmode=require`).
3. Apply migrations:

   ```bash
   npm run db:migrate --workspace backend
   ```

4. Create the runtime role (Neon console roles have BYPASSRLS, which would skip tenant RLS):

   ```bash
   NTS_APP_PASSWORD='a-long-random-password' npm run db:neon:setup --workspace backend
   ```

5. Set `DATABASE_URL` to the **pooled** host as `nts_app`:
   `postgresql://nts_app:<password>@<endpoint>-pooler.<region>.aws.neon.tech/<db>?sslmode=require&pgbouncer=true&connect_timeout=15`
6. Start the API. It logs a warning (development) or refuses to start (production) if the role can bypass RLS.

## Development and test branches

Create two extra Neon branches from production (or from an empty main branch), e.g. `dev` and
`test`. Point `DATABASE_URL`/`DIRECT_URL` at `dev` and `TEST_DATABASE_URL`/`TEST_DIRECT_URL` at
`test`, run `db:migrate` and `db:neon:setup` against each, and the test suite migrates its branch
automatically. The tests delete and re-create data — never point them at production.

## Migrations workflow

Create a migration after changing `schema.prisma`:

```bash
npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
```

Review the SQL, then apply with `npm run db:migrate --workspace backend` (development, test and production).

## Backups and disaster recovery

- **Built-in (Cloudflare R2):** Super Admins open *Platform → Backup & recovery*. Backups run every
  `BACKUP_INTERVAL_HOURS` (default 24) and on demand; each is a gzipped JSON snapshot of every table
  stored privately in R2 under `backups/YYYY/MM/DD/<id>.json.gz`, kept for `BACKUP_RETENTION_DAYS`
  (default 30; the newest three are always kept). Downloads use five-minute signed links.
- **Restore** (Super Admin only, type `RESTORE` to confirm) first takes a `PRE_RESTORE` safety
  backup, checks the backup was taken at the same migration version, then replaces all rows in one
  transaction (tables truncated and re-inserted in foreign-key order). If anything fails, nothing
  changes. Audit logs record who restored what.
- Neon point-in-time restore remains available as a second line of defence (retention depends on
  plan). Test a restore to a branch quarterly.
- Cloudinary assets: enable backups in the Cloudinary console; selfies are disposable by design
  (retention policy) but logos should be backed up.
- Recovery objective: database restore first, then API, then workers (jobs are idempotent and safe
  to retry).
