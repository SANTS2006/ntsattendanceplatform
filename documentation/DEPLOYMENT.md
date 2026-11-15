# Deployment on Render (no Docker)

NTSAttend deploys as a Render **Blueprint** (`render.yaml` at the repository root) on Render's
**free plan — no payment details needed**. All data lives in managed services; nothing is stored on
the server's disk.

Why no card is requested: the Blueprint contains only one `plan: free` web service. Render's
background workers, paid Key Value plans and `preDeployCommand` all require billing, so instead the
background jobs run inside the web service (`WORKERS_IN_API=true`), Redis comes from a free
**Redis Cloud** database, and migrations run at the end of the build.

| Component | Where | Notes |
|---|---|---|
| Web app + API + background jobs | Render free web service `ntsattend` (https://ntsattend.onrender.com) | Express serves the built React app and the API from one origin; BullMQ workers (emails, imports, reports, backups) run in the same process |
| Queues / realtime | Redis Cloud (free database) | BullMQ, shared rate limits, Socket.IO fan-out — set `REDIS_URL` |
| Database | Neon PostgreSQL | Pooled URL for the app, direct URL for migrations |
| Files | Cloudinary | Private assets, signed expiring URLs |
| Email | Brevo | Transactional API |
| Backups | Cloudflare R2 | Platform → Backup & recovery |

## 1. Prepare the external services

1. **Neon:** create a project. From *Connect*, copy the URL with *Connection pooling* on →
   `DATABASE_URL` (append `&pgbouncer=true`) and with pooling off → `DIRECT_URL`. Migrations run
   automatically on deploy; see [DATABASE.md](DATABASE.md).
2. **Cloudinary:** Dashboard → *API Keys*: copy the cloud name, API key and API secret.
3. **Brevo:** *SMTP & API → API keys* → create a key. Under *Senders, domains & dedicated IPs*,
   authenticate your domain (SPF/DKIM) and add the sender used in `MAIL_FROM`.
4. **Cloudflare R2:** create a private bucket (e.g. `ntsattend-backups`), then *Manage R2 API
   tokens* → create a token with **Object Read & Write** on that bucket only. Copy the account id,
   access key id and secret.
5. **Redis Cloud:** create a free database at redis.io and copy its public endpoint as
   `redis://default:<password>@<host>:<port>` → `REDIS_URL`.
6. **Google (optional):** create an OAuth client of type *Web application* and add your Render URL
   (and custom domain) to *Authorized JavaScript origins*.

## 2. Create the Blueprint

1. Push the repository to GitHub/GitLab.
2. Render dashboard → **New → Blueprint** → select the repository. Render reads `render.yaml`.
3. Fill in every value Render prompts for (`sync: false` entries in the `ntsattend` group).
   Generate the four secrets locally:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   and `DATA_ENCRYPTION_KEY` with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   `APP_URL` and `EMAIL_BASE_URL` are already set to `https://ntsattend.onrender.com` in
   `render.yaml`; change both if you use a custom domain.
4. Apply. Each deploy runs: `npm ci` → `prisma generate` → build (backend + frontend) →
   `prisma migrate deploy` (uses `DIRECT_URL`) → start. The health check is `GET /health/ready`
   (database + Redis).
5. Register your own account on the live site, then grant yourself Super Admin from the web
   service's **Shell** tab:

   ```bash
   npm run platform:grant-admin --workspace backend -- you@example.com
   ```

6. Optional custom domain: Render → service → *Settings → Custom domains*. Update `APP_URL` and the
   Google authorized origins afterwards.

The API validates every variable at start-up and refuses to boot when something required is missing
(names are reported, values never printed). Production also refuses to start if the database role can
bypass Row-Level Security.

## Free plan limits and scaling

- The free web service sleeps after about 15 minutes without traffic; the first request after that
  takes up to a minute while it wakes. Scheduled backups and selfie clean-up run whenever it is awake.
- Brevo: if *Authorised IPs* is enabled in Brevo, either turn it off or emails from Render will be
  rejected (Render's outgoing IP addresses change).
- To scale later (paid plans): add a `worker` service running `npm run start:worker --workspace backend`
  and set `WORKERS_IN_API=false` on the web service; add more web instances freely — sessions are
  stateless JWTs and rate limits/Socket.IO use Redis.

## Monitoring

- `GET /health/live` (process) and `GET /health/ready` (database + Redis).
- *Platform → System health* (Super Admin): database, Redis, storage, queue counts, process stats.
- Logs are structured JSON (pino) with request ids — view them in Render's *Logs* tab or stream them
  to a log platform.
- Security events (lockouts, token reuse, enumeration, location abuse) appear under Platform → Security.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "Invalid environment configuration" | Set the variables listed in the log (values are never printed) |
| Sign-up codes not arriving | Check `BREVO_API_KEY` and that `MAIL_FROM` is a verified sender; logs show "Brevo send failed (status)" |
| Google button missing | `GOOGLE_CLIENT_ID` not set, or origin not authorized in Google Cloud |
| Uploads fail | Verify the three `CLOUDINARY_*` values; check *Platform → System health* |
| Backups page says "not configured" | Set all four `R2_*` variables on both services and redeploy |
| "Use my current location" fails | Location only works over HTTPS (Render provides it) and needs browser permission |
| Students see "QR code expired" early | Device clock is wrong; the server clock is authoritative |
