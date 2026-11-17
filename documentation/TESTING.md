# Testing

| Suite | Command | Count | What it covers |
|---|---|---|---|
| Backend unit + integration | `npm test --workspace backend` | 115 | Geofence math, student-ID rules, crypto, TOTP, tenant query scoping, time zones, Brevo mailer; auth (code sign-up, lockout, refresh rotation and reuse, CSRF, reset, MFA), Google sign-in, onboarding, permissions, platform separation, privilege escalation, invitations, students, imports (CSV, Excel, preview table), reports (CSV/XLSX/PDF), API conventions, OpenAPI coverage, security headers; profile pictures, email change with code, generic bulk imports, support tickets, feedback, R2 backup + restore |
| Tenant isolation | (included above) `tests/tenancy` | 17 | API, tenant client, RLS, triggers, immutability, append-only audit, file signatures |
| Attendance | (included above) `tests/attendance` | 20 | QR validity/expiry/revocation/tampering, attempt binding, student verification and enumeration caps, location, selfie validation and EXIF stripping, submission, idempotency, **15 concurrent duplicates → 1 record**, late rules |
| Proximity verification | `npx vitest run tests/attendance/proximity.test.ts tests/unit/lib.test.ts` (backend) | 28 + 65 | Lecturer reference saved (accuracy, time, audit), refused at ±25/1,000/20,000 m, stale/missing/invalid; reference never sent to students; rotation never moves it; students at 0/5/10/15/19/20/21/50 m; boundary uncertainty; poor accuracy → uncertain (never "outside"); stale; invalid coordinates; expired session; server-computed distance recorded; duplicate and concurrent submissions → 1 record; audited reference change re-checks accepted students; cross-tenant; retry limit |
| Frontend location | `src/lib/geo.test.ts`, `src/features/attend/attend.test.tsx` (frontend) | 18 + 4 | watchPosition acquisition with a fake navigator: best reading (no averaging), stability, early stop, ±20,000 m, cached reading, denied/unavailable, sample budget; student page: outside-20 m rejection, poor accuracy shown as retry then accepted, missing lecturer location, permission denial |
| Lecturer accounts | `npx vitest run tests/integration/lecturer-accounts.test.ts` (backend) | 5 | Account created on add (placeholder, Lecturer role, setup email), setup link completes it (single-use), self sign-up with the same email keeps the lecturer role and creates an owned organization with no data crossover, existing account added and notified, resend replaces older links, "Forgot password" completes a pending account |
| Frontend unit | `npm test --workspace frontend` | 12 | Student-ID counter and auto-verify, error screens, submit with idempotency key, role-aware navigation, route guards, placeholder generation |
| End-to-end (Playwright) | `PW_CHANNEL=msedge npm run test:e2e --workspace frontend` | 11 | `proximity.spec.ts`: lecturer ±20 km reading refused (no QR) then ±6 m registers the reference and generates the QR; student within 20 m accepted → ID → recorded → live update; student 50 m away rejected; ±60 m reading shown as retry then accepted; audited location update; ended session refused. `attendance.spec.ts`: sign-up → onboarding; invalid QR; Add Students upload; sign-out |

Backend tests run against a real PostgreSQL test database — a dedicated Neon **test** branch
(`TEST_DATABASE_URL` / `TEST_DIRECT_URL`), migrated automatically. Tests run with `NODE_ENV=test`:
files go to an in-memory store and emails to an in-memory outbox, so nothing reaches Cloudinary or
Brevo. E2E tests start the API with `npm run dev:sandbox` (same mode) and read sign-up codes from the
test-only `GET /api/v1/__test__/mail` endpoint, which is not registered outside test mode. Google token verification is replaced by a test double (it needs Google's network);
everything after verification runs for real.

**E2E safety:** `dev:sandbox` uses `DATABASE_URL` from `backend/.env`. Before running Playwright, start
the API yourself with `DATABASE_URL`/`DIRECT_URL` set to the test database (environment variables
override the `.env` file) and seed it (`npm run db:seed --workspace backend` with the same variables),
so E2E data never reaches production. Also set `REDIS_URL=` (empty) so the sandbox API never uses the
production Redis. Geolocation in E2E is simulated by Playwright; real-device classroom testing is
still required.

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
