# Testing

| Suite | Command | Count | What it covers |
|---|---|---|---|
| Backend unit + integration | `npm test --workspace backend` | 115 | Geofence math, student-ID rules, crypto, TOTP, tenant query scoping, time zones, Brevo mailer; auth (code sign-up, lockout, refresh rotation and reuse, CSRF, reset, MFA), Google sign-in, onboarding, permissions, platform separation, privilege escalation, invitations, students, imports (CSV, Excel, preview table), reports (CSV/XLSX/PDF), API conventions, OpenAPI coverage, security headers; profile pictures, email change with code, generic bulk imports, support tickets, feedback, R2 backup + restore |
| Tenant isolation | (included above) `tests/tenancy` | 17 | API, tenant client, RLS, triggers, immutability, append-only audit, file signatures |
| Attendance | (included above) `tests/attendance` | 20 | QR validity/expiry/revocation/tampering, attempt binding, student verification and enumeration caps, location, selfie validation and EXIF stripping, submission, idempotency, **15 concurrent duplicates → 1 record**, late rules |
| GPS geofencing | `npx vitest run tests/attendance/geofence.test.ts tests/unit/lib.test.ts` (backend) | 21 + 11 | Accuracy matrix 5/20/50/100/1000/20000 m, fresh vs stale, invalid coordinates, distance/boundary (radius never widened by accuracy), lecturer capture rejection (±20 km), manual map venue + audit, unverified legacy venue, policy exposed to clients, student retry, verified location reused at submit, client flags ignored, cross-tenant attempt, retry limit, duplicate attendance |
| Frontend location | `src/lib/geo.test.ts`, `src/features/attend/attend.test.tsx` (frontend) | 18 + 3 | watchPosition acquisition with a fake navigator: best reading (no averaging), stability, early stop, ±20,000 m, cached reading, denied/unavailable, sample budget; student page imprecise-reading retry and permission denial |
| Frontend unit | `npm test --workspace frontend` | 12 | Student-ID counter and auto-verify, error screens, submit with idempotency key, role-aware navigation, route guards, placeholder generation |
| End-to-end (Playwright) | `PW_CHANNEL=msedge npm run test:e2e --workspace frontend` | 8 | Lecturer venue capture (±20 km refused, ±8 m accepted) and map placement labelled manual; Sign-up (terms checkbox) with emailed code → onboarding; lecturer session → phone check-in with geolocation → live dashboard; geofence rejection; invalid QR; Add Students file upload; sign-out animation and revocation |

Backend tests run against a real PostgreSQL test database — a dedicated Neon **test** branch
(`TEST_DATABASE_URL` / `TEST_DIRECT_URL`), migrated automatically. Tests run with `NODE_ENV=test`:
files go to an in-memory store and emails to an in-memory outbox, so nothing reaches Cloudinary or
Brevo. E2E tests start the API with `npm run dev:sandbox` (same mode) and read sign-up codes from the
test-only `GET /api/v1/__test__/mail` endpoint, which is not registered outside test mode. Google token verification is replaced by a test double (it needs Google's network);
everything after verification runs for real.

**E2E safety:** `dev:sandbox` uses `DATABASE_URL` from `backend/.env`. Before running Playwright, start
the API yourself with `DATABASE_URL`/`DIRECT_URL` set to the test database (environment variables
override the `.env` file) and seed it (`npm run db:seed --workspace backend` with the same variables),
so E2E data never reaches production. Geolocation in E2E is simulated by Playwright; real-device
classroom testing is still required.

## Measured load (one developer machine)

`npm run load:burst --workspace backend -- --students 1000 --concurrency 200` — one API process,
local PostgreSQL (since replaced by Neon), no Redis, rate limits disabled for the benchmark, Windows 16-core laptop:

| Metric | Result |
|---|---|
| Full check-in flows (validate → verify ID → submit with GPS) | 1,000 in 10.5 s, **0 failures** |
| Throughput | ≈ 96 complete flows/s (≈ 287 requests/s) |
| Submit latency p50 / p95 / p99 | 760 / 1,029 / 1,088 ms |
| Whole flow p50 / p95 | 1.76 / 3.35 s |
| Duplicate storm (50 simultaneous submits, one student) | 1 × 201, 49 × 409, **1 record** |

These numbers are **not** production capacity claims. For staging, use
`backend/tests/performance/k6-attendance.js` (2,000 students, 400 virtual users, thresholds on error
rate and p95) from several load generators, with Redis enabled and multiple API instances.
