# NTSAttend — project progress

_Last updated: 2026-11-17_

## Architecture (summary)

React 19 SPA ⇄ Express 5 API (stateless) ⇄ PostgreSQL (Neon) with RLS · Redis/BullMQ workers ·
Socket.IO · Cloudinary (all files) · Brevo (email) · Cloudflare R2 (backups) · Google Identity Services.
Hosted free on Render (one web service, background jobs in-process) with Redis Cloud. Native install, no Docker, no local data.
Details: [documentation/ARCHITECTURE.md](documentation/ARCHITECTURE.md).

## Completed phases

| Phase | Status |
|---|---|
| 1 Repository & architecture (monorepo, Prisma, env validation) | ✅ |
| 2 Authentication & tenant foundation (JWT + rotating refresh, RBAC, invitations, tenant client, RLS, triggers) | ✅ |
| 3 Organization management (onboarding, profile, logo, student-ID rules, attendance & location settings, users, custom roles) | ✅ |
| 4 Students & academics (CRUD, search, CSV/Excel import with preview table, faculties → classes, enrollments, lecturer assignment, events) | ✅ |
| 5 QR engine (hashed 256-bit tokens, expiry, rotation, revocation, replace) | ✅ |
| 6 Public student flow (validate, location, auto ID verification, selfie, idempotent submit, confirmation) | ✅ |
| 7 Lecturer dashboard (live Socket.IO feed, stats, records, absentees, corrections, manual entry) | ✅ |
| 8 Reports (analytics, class summary, CSV/XLSX/PDF background exports) | ✅ |
| 9 Platform Super Admin (dashboard, organizations, users, analytics, security, audit, health, settings) | ✅ |
| 10 Frontend completion + NTSAttend redesign (brand theme, logo loaders, sign-out animation, new shells, modern auth pages) | ✅ |
| 11 Hardening (rate limits, headers, CSRF, enumeration caps, load test) | ✅ |
| 12 Verification (tests, builds, E2E) | ✅ |
| Integrations: Neon, Cloudinary, Brevo, Google sign-in, email-code sign-up | ✅ code complete; needs real credentials |
| 13 UX round: "Enter your …" placeholders, form validation everywhere, light/dark themes, profile & notification dropdowns, notification details, avatar upload, email change with code, responsive tables (phone cards) and modals | ✅ |
| 14 Bulk upload for faculties, departments, programs, levels, academic years, semesters, courses, classes, lecturers and events | ✅ |
| 15 QR creation uses the device's current location (manual lat/lng removed); venue location capture on classes/events | ✅ |
| 16 Owner ↔ Super Admin support conversations and feedback | ✅ |
| 17 Cloudflare R2 backup & restore (Super Admin console) | ✅ needs R2 credentials |
| 18 Terms/Privacy pages + required consent at sign-up | ✅ (legal review recommended) |
| 19 Render Blueprint, Neon-only database, local database and local files removed | ✅ |
| 21 Full-width pages for every role (app and platform consoles) | ✅ |
| 22 Lecturer accounts created automatically (setup email, resend, import) and one account across many organizations (own organization + lecturer roles, grouped switcher) | ✅ code + 5 integration tests |
| 23 Public website redesign: three.js 3D hero (lazy-loaded), scroll-driven check-in story, reveal/tilt/parallax animations, new How it works page, rebuilt Features/Pricing/About/Contact/404, full footer | ✅ checked in the browser (desktop, phone, light/dark) |
| 24 Requested changes (2026-11-16): full student email on the attendance pages, responsive full-width live session page, student form (email/department/program/level required, programs filtered by department, server check), no scroll bar on the website, full-width FAQ, editable permissions on existing roles (migration `role_permissions_customized`), navbar name with middle initial, organization logo card matching the profile card, full-screen image viewer with change/remove | ✅ type checks, 32 frontend tests, 6 new integration tests (`roles-students.test.ts`, incl. role changes staying in their own organization); logged-in pages not checked in a browser |
| 25 Lecturer-generated QR proximity verification (replaces classroom geofencing): the lecturer's GPS position when the QR is generated is the session's fixed reference point; students must be within 20 m (accept if distance + accuracy ≤ 20, reject if distance − accuracy > 20, otherwise uncertain/retry); location is the first student step; audited reference correction; structured outcomes | ✅ code + automated tests (see below); **not yet validated on real smartphones** |
| 20 GPS geofencing accuracy fix (superseded by 25 for the reference point): venue capture gated by accuracy, manual map placement (Leaflet/OSM), multi-reading acquisition (best fresh reading, no averaging), server freshness → accuracy → distance checks, verified location carried to submit, configurable location policy with warnings, venue audit | ✅ code + automated tests; **not yet validated on real devices in a classroom** |

## Project structure

```
backend/   Express API (src/{config,db,infra,lib,middleware,modules,jobs}), prisma/, tests/, scripts/
frontend/  React app (src/{api,auth,components,features,hooks,layouts,routes,types,utils}), e2e/
documentation/  Architecture, API, security, database, tenant isolation, deployment, roles, workflow, testing
```

## Database

45 models (see [DATABASE.md](documentation/DATABASE.md)). Migrations:
`init`, `tenant_integrity` (RLS, triggers, CHECKs, append-only audit), `tenant_error_codes`,
`email_code_and_google` (PendingRegistration, nullable password, googleId, avatarUrl),
`support_feedback_backups_imports` (EmailChangeRequest, SupportTicket/Message, Feedback, Backup, import resource, avatarKey; RLS for tickets/feedback),
`terms_acceptance`, `location_policy` (venue source/accuracy/captured-at on classes and events; session location snapshot; venue-capture, reading-age, timeout and sample-count settings), `role_permissions_customized` (flag on roles whose permissions were edited),
`session_reference_point` (session columns renamed in place to `referenceLatitude`/`referenceLongitude`/`referenceAccuracyMeters`/`maximumDistanceMeters`/`studentMaxAccuracyM`/`locationVerificationEnabled`, new `referenceCapturedAt`; settings `studentMaxAccuracyM`/`lecturerMaxAccuracyM`, fixed-radius setting removed).

## API

139 documented paths under `/api/v1` (OpenAPI generated from route definitions).

## Frontend pages

Landing, features, pricing, about, contact · sign in (password, Google, MFA), register (details →
6-character code), forgot/reset password, invitations, email-link verification (legacy) ·
onboarding · dashboard · sessions, new session, live session (QR, live feed), records · students
(list, detail, **Add students window with file upload + review table**), import page · classes,
class detail, academic structure, lecturers, events, event detail · reports · settings (profile,
student ID, attendance & location, users, roles, audit) · account (profile with photo and email change, password, MFA, devices) · notifications page +
header dropdown + detail modal · help & support, feedback · platform (dashboard, organizations,
organization detail, users, analytics, security, support inbox, feedback, audit, backup & recovery,
settings) · privacy policy, terms of service · public student attendance + confirmation.

## Security implementation

See [SECURITY.md](documentation/SECURITY.md) and [TENANT_ISOLATION.md](documentation/TENANT_ISOLATION.md).

## Tests executed (2026-11-15)

| Suite | Result |
|---|---|
| Backend (Vitest + Supertest, real PostgreSQL) | 115 / 115 passed |
| Frontend unit (Vitest + Testing Library) | 12 / 12 passed |
| E2E (Playwright, Microsoft Edge) | 6 / 6 passed |
| Production builds (API `tsc`, web `vite build`) | passed |
| Load burst (1,000 flows, 200 concurrency, one laptop) | 0 failures, submit p95 1.03 s; duplicate storm → 1 record |

## GPS geofencing fix (2026-11-16)

Root causes: (1) the lecturer's venue anchor was saved whatever its accuracy (laptops report Wi-Fi/IP
fixes of ±1–20 km), so students in the room measured as "outside"; (2) the student page took a second
reading at submit which the server re-checked and could contradict the verified one; (3) no freshness
check (cached positions accepted); (4) acquisition stopped after 20 s and aborted on transient errors,
and the server's policy was not shared with the device; (5) a 20 m radius was combined with 100 m
allowed uncertainty, with no warnings. Haversine, coordinate order and units were checked and correct.
Details: [ATTENDANCE_WORKFLOW.md → Location verification](documentation/ATTENDANCE_WORKFLOW.md).

Action required after deploying: existing class/event venues have no source and must be re-captured
by GPS (with a phone at the venue) or placed on the map before sessions can use them; the
`location_policy` migration runs on the next Render deploy (`db:migrate`). Consider lowering the
maximum student GPS uncertainty from 50 m to 25–30 m after testing in your classrooms.

### Tests executed for the GPS fix (2026-11-16)

| Suite | Result |
|---|---|
| Backend unit (`tests/unit`, incl. 6 new geo tests: accuracy matrix, boundary, freshness, venue capture, lat/lng order) | 46 / 46 passed |
| Backend GPS integration (`tests/attendance/geofence.test.ts`, real PostgreSQL test DB) | 21 / 21 passed (over three runs: the first 15, then 6 re-run after fixing test-side issues — access-token expiry on the slow link, selfie default, expected error code) |
| Frontend (Vitest: `geo.test.ts` 18 tests + student page) | 32 / 32 passed |
| Type checks (backend `tsc`, frontend `tsc -b`) | passed |
| Full backend suite (other 115 tests) | **not re-run** — ~1.6 s per query from this machine to Neon makes it take hours; run it in CI |
| Playwright E2E (8 specs, 2 new for venue capture) | **not run** — would write to the production database (see above) |

## Lecturer-generated QR proximity verification (2026-11-17)

Replaces the permanent classroom geofence. Root causes addressed: (1) a classroom anchor saved once
(sometimes from an imprecise or manual map position) was reused for every session, so a wrong anchor
failed every student; now each session's reference point is the lecturer's own fresh GPS reading at
QR generation, refused when less precise than the lecturer threshold; (2) a 14–20 m geofence was
compared with the raw distance only, so uncertain readings were reported as "outside"; now the
server applies distance ± reported accuracy (accept / outside / uncertain-retry) without ever
widening the 20 m limit; (3) student-ID lookups could happen before any location check; location is
now the first, server-enforced step. Details: [ATTENDANCE_WORKFLOW.md](documentation/ATTENDANCE_WORKFLOW.md#location-verification-lecturer-generated-qr-proximity).

- Database: migration `session_reference_point` (renames in place — existing sessions keep their
  data; adds `referenceCapturedAt`; settings `studentMaxAccuracyM`/`lecturerMaxAccuracyM`, default
  20 m; fixed-radius setting dropped). Class/event venue coordinates are kept but no longer used.
  Verified: the migrated test database has **no drift** from `schema.prisma` (`prisma migrate diff`).
- Backend: new `modules/attendance/proximity.service.ts` (Haversine, coordinate/accuracy/freshness
  validation, reference validation, session expiry, structured outcomes); `POST /attendance/sessions`
  takes `reference` (raw reading); new audited `POST /attendance/sessions/:id/reference-location`;
  `/public/attendance/:token/verify-location` returns the outcomes; `/verify-student` requires an
  accepted location; `/submit` re-checks the signed location against the current reference point.
  Removed: venue capture/map placement for classes and events, the venue audit hook.
- Frontend: Generate QR captures the lecturer's location first (progress, latitude/longitude,
  accuracy, poor readings refused, 20 m rule, map preview); live session page shows the reference
  point and an audited "Update location" dialog; student page: location first with progress,
  accepted / outside (red) / uncertain-retry (amber) states; settings show the fixed 20 m rule and
  the lecturer and student accuracy thresholds.

### Tests executed (2026-11-17)

| Suite | Result |
|---|---|
| Backend unit (`tests/unit`, incl. proximity: 0/5/10/15/19/20/21/50 m exact and with accuracy, boundary, poor accuracy, stale, invalid, expired, reference validation) | 65 / 65 passed |
| Backend proximity integration (`tests/attendance/proximity.test.ts`, real PostgreSQL test DB) | 28 / 28 passed (27 in the first run; the 28th passed after correcting its expected status 400 → 422) |
| Backend attendance integration (`tests/attendance/attendance.test.ts`) | 19 / 20 passed across runs (after updating the masked-email assertion and adding token refresh); **"rejects duplicates and replays idempotently" not confirmed** — every attempt failed on a dropped database connection |
| Tenant isolation, permissions, students/reports suites | **not completed** — the test database became unreachable (`P1001`, connection resets, pool timeouts) |
| Frontend (Vitest, incl. 3 new student-page location tests) | 33 / 33 passed |
| Type checks (backend `tsc`, frontend `tsc -b`), production build (`vite build`) | passed |
| Playwright (`e2e/proximity.spec.ts`: lecturer poor/precise reading, student accepted / outside / uncertain→retry, audited location update, ended session) | **written, not run** — needs a reachable, seeded test database (see TESTING.md) |
| Real smartphones in a classroom | **not done** |

## Website, accounts and layout (2026-11-16)

- Public contact details (email, phone, address) are blank in `frontend/src/features/marketing/site.ts`
  and are not shown until filled in; no testimonials or customer logos were invented.
- The 3D hero uses three.js in its own lazily loaded chunk (≈123 KB gzipped, home page only) with a
  CSS-3D fallback when WebGL is unavailable and a still frame for reduced motion.
- Lecturer accounts: see [USER_ROLES.md](documentation/USER_ROLES.md#lecturer-accounts-and-multiple-organizations).
  Creating a lecturer now needs only `lecturers.manage` (it grants the system Lecturer role).

## Known issues / limitations

- **Proximity verification is not validated on real smartphones.** Indoors, phone GPS is often
  ±10–50 m; with the 20 m rule (accept only when distance + accuracy ≤ 20 m) many indoor readings
  will be *uncertain* and need retries or a manual entry. The lecturer's own uncertainty (up to the
  lecturer threshold) is not added to the student check. Browser GPS can be spoofed — this improves
  proximity checking but does not guarantee physical presence. Lecturers must generate the QR on a
  GPS-capable phone (laptop readings are refused).
- After deploying: sessions active during the deploy keep their old anchor (migrated as the reference
  point); classroom coordinates no longer matter. The integration suites listed above as not completed
  and the Playwright specs must be run when the test database is reachable (or in CI).

- **GPS accuracy is not yet proven in the field.** The new flow is covered by unit, component and API
  tests with simulated readings only. It must be tested with real phones (Android and iOS, several
  models) in actual classrooms before relying on it. Indoor GPS is often ±10–50 m; laptops cannot
  register venues by GPS; GPS can be spoofed.
- Playwright E2E specs were updated for the new flow but not run: the sandbox server reads
  `DATABASE_URL` from `backend/.env` (production). Run them only with `DATABASE_URL` pointing at the
  test database (seeded) — see TESTING.md.
- From this development machine a single Neon query takes ~1.6 s, so the full backend suite takes
  very long locally; run it in CI or closer to the database.

- Neon, Cloudinary, Brevo, R2 and Google need real credentials (`backend/.env` locally, the Render env
  group in production); they were verified with unit tests and test doubles, not yet against the live
  services. The Render deployment itself has not been run yet.
- The Privacy Policy and Terms of Service are a sensible starting point, not legal advice — have them
  reviewed for your jurisdiction.
- After the local database was removed, the test suites need a Neon test branch (`TEST_DATABASE_URL`).
- Google sign-in UI is hidden until `GOOGLE_CLIENT_ID` is set.
- k6 has not been run (not installed); only the Node burst benchmark has measured results.
- Selfie face matching / liveness are not implemented (architecture allows adding them).
- External student information system adapters are designed for but not implemented (CSV/Excel import only).
- Accounts created before code verification keep the legacy link-based email verification path.

## Next steps

1. Fill `backend/.env` with Neon (dev + test branches), Cloudinary, Brevo, R2 and Google values; run
   `db:migrate`; register through the UI to confirm the Brevo code arrives and
   uploads land in Cloudinary; run a backup from Platform → Backup & recovery.
2. Create the Render Blueprint from `render.yaml` (see DEPLOYMENT.md) and run the k6 script against it.
3. Optional: SIS integration adapters, face-match module.
