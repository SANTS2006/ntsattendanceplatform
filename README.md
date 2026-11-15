# NTSAttend — Next-generation Tenant Attendance System

Multi-tenant SaaS for secure QR attendance. Universities, colleges, schools, training institutions
and event organizers each get an isolated workspace. Lecturers project an expiring QR code; students
scan it on their phones (no account), share their location, type their student ID (verified
automatically), take a selfie and check in. Lecturers watch attendance arrive live.

| Layer | Technology |
|---|---|
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 (light & dark themes) · React Router · TanStack Query · React Hook Form + Zod · Recharts · Socket.IO client |
| Backend | Node.js · Express 5 · TypeScript · Prisma 6 · Zod · JWT · Argon2id · BullMQ · Socket.IO · OpenAPI |
| Database | PostgreSQL on **Neon** with Row-Level Security |
| Files | **Cloudinary** (private assets, signed expiring URLs) — selfies, logos, profile pictures, imports, reports |
| Email | **Brevo** transactional API |
| Backups | **Cloudflare R2** (scheduled + on-demand, restore from the Super Admin console) |
| Hosting | **Render** (web service + worker + Key Value) — see `render.yaml` |
| Sign-in | Email + password (6-character emailed code at sign-up), Google, optional TOTP MFA |

**No Docker, no local database, no local file storage.** Everything runs natively and all data lives
in the managed services above.

## Quick start (development)

Prerequisites: Node.js ≥ 20.11 (22 LTS recommended), npm ≥ 10, and accounts on Neon, Cloudinary and
Brevo (R2 and Google are optional).

```bash
npm install
```

```bash
cp backend/.env.example backend/.env
```

Fill in `backend/.env` (every variable is explained in the file). Use a Neon **dev** branch for
`DATABASE_URL`/`DIRECT_URL` and a separate **test** branch for `TEST_DATABASE_URL`/`TEST_DIRECT_URL`.
Then create the tables once:

```bash
npm run db:migrate --workspace backend
```

Optionally load demo data:

```bash
npm run db:seed --workspace backend
```

Run the API (http://localhost:4000, API docs at /api/docs) and the web app (http://localhost:5173):

```bash
npm run dev:api
```

```bash
npm run dev:web
```

### Sandbox mode (no emails sent, no files uploaded)

`npm run dev:sandbox --workspace backend` starts the API with in-memory file storage and captured
emails — what the automated tests use. Sign-up codes are readable at
`GET /api/v1/__test__/mail?to=<email>` (this endpoint does not exist outside sandbox/test mode).
Files and emails disappear when it stops. It still needs a database (`DATABASE_URL`).

Seeded accounts (after `db:seed`): `admin@nts.localhost` (Super Admin), `owner@demo.localhost`
(Demo University owner), `lecturer@demo.localhost` (lecturer of CS201-A), all with `SEED_PASSWORD`.

## Deploying

See [DEPLOYMENT.md](documentation/DEPLOYMENT.md): create a Render Blueprint from `render.yaml`,
paste the service credentials, deploy, and grant yourself Super Admin.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Backend (Vitest + Supertest against the Neon test branch) and frontend (Vitest + Testing Library) tests |
| `npm run test:e2e --workspace frontend` | Playwright end-to-end tests (API in sandbox mode; set `PW_CHANNEL=msedge` or `chrome` to use an installed browser) |
| `npm run build` | Production builds of API and web app |
| `npm run load:burst --workspace backend -- --students 1000 --concurrency 200` | Attendance burst benchmark (test database) |
| `npm run openapi --workspace backend` | Regenerate `documentation/openapi.json` |
| `npm run platform:grant-admin --workspace backend -- someone@example.com` | Grant the first Super Admin |

## Documentation

- [Architecture](documentation/ARCHITECTURE.md) · [Tenant isolation](documentation/TENANT_ISOLATION.md) · [Security](documentation/SECURITY.md)
- [Database & backups](documentation/DATABASE.md) · [API](documentation/API_DOCUMENTATION.md) · [User roles](documentation/USER_ROLES.md)
- [Attendance workflow](documentation/ATTENDANCE_WORKFLOW.md) · [Testing](documentation/TESTING.md) · [Deployment on Render](documentation/DEPLOYMENT.md)
- [Project progress](PROJECT_PROGRESS.md)
