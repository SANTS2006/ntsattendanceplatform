# Security

## Authentication

| Control | Implementation |
|---|---|
| Password hashing | Argon2id (19 MiB, t=2, p=1); timing-equalized responses for unknown emails |
| Sign-up verification | 6-character code from an unambiguous alphabet (no 0/O/1/I/L); only an HMAC is stored; 10-minute expiry; 5 attempts; 60 s resend cooldown and 5 sends max; the user row is created only after verification; identical responses whether or not an email is registered (no enumeration) |
| Google sign-in | Google ID token verified server-side (signature, audience = `GOOGLE_CLIENT_ID`, issuer, expiry); requires `email_verified`; links to an existing account only for the same verified email; MFA still enforced |
| Sessions | Access JWT (15 min, HS256) in memory; refresh token (random 384-bit, SHA-256 stored) in an `HttpOnly; SameSite=Strict` cookie scoped to `/api/v1/auth`; rotation on every refresh; reuse of a rotated token revokes the whole family and raises a HIGH security event; 20 s grace for concurrent tabs |
| CSRF | Only the refresh and logout endpoints use the cookie; they require the `X-NTS-CSRF` header and an allowed Origin |
| Brute force | Per-IP and per-IP+email rate limits; account lock for 15 min after 5 failures; distributed-failure and new-network detection |
| MFA | TOTP (RFC 6238), secret encrypted with AES-256-GCM |
| Password reset | Single-use 30-minute token; all sessions revoked on reset |
| Email change | Current password required (if the account has one); 6-character code sent to the **new** address (HMAC stored, 10-minute expiry, 5 attempts, resend cooldown); the old address is alerted when the change starts and when it completes; the address must not belong to another account |
| Terms | Sign-up requires accepting the Terms of Service and Privacy Policy; the acceptance time is stored (`termsAcceptedAt`) |

## Authorization

- RBAC with per-organization roles; permissions optionally scoped to a department.
- Object-level checks for classes, events, sessions, records (lecturers only see assigned classes).
- Non-owners cannot grant permissions they don't hold (privilege-escalation guard).
- Platform (Super Admin) access is a separate `PlatformAdmin` grant; organization roles never confer it.

## API hardening

Helmet (strict CSP, `frame-ancestors 'none'`, HSTS in production), strict CORS allow-list, JSON body
limits, Zod validation with unknown keys stripped (mass-assignment protection), standard error
envelope with no internal details, Prisma parameterized queries only, request ids, structured
logging with redaction of passwords, tokens, cookies, attempt tokens and QR tokens in URLs.

## Public attendance flow

256-bit QR tokens stored only as SHA-256 hashes; optional 30-second rotation; server-side expiry;
attempt tokens bound to QR token + session + tenant; per-step rate limits; per-client failure caps
(student ID enumeration, location retries) with security events; student emails shown in full on the attendance page by product decision (enumeration is limited by the failure caps);
idempotency keys and a unique `(sessionId, studentId)` constraint; confirmation pages require a
192-bit confirmation token in addition to the reference number.

## Files and images

Magic-byte type detection (JPEG/PNG/WebP only), full decode with a pixel limit, re-encode to JPEG
(strips all EXIF incl. GPS), random tenant- or user-prefixed keys, private Cloudinary `authenticated` storage for every file
(selfies, logos, profile pictures, imports, reports), short-lived signed URLs, configurable retention with an
automatic deletion job. Spreadsheet exports neutralize formula injection.

## Backups

Database backups go to a private Cloudflare R2 bucket with a token scoped to that bucket. Only
platform admins can list or download them (five-minute signed links); only Super Admins can restore
or delete, a restore requires typing `RESTORE`, takes a safety backup first, runs in one
transaction and is audit-logged. Backups contain personal data — treat the R2 bucket and any
downloaded file as production data.

## Support conversations

Organization owners/administrators and platform admins exchange messages through tenant-scoped
tickets (RLS-protected); organizations can only read their own conversations and feedback.

## Honest limits

- **Browser GPS coordinates are untrusted and can be spoofed** (developer tools, mock-location apps).
  The lecturer-generated QR proximity check improves proximity checking; it does not guarantee
  physical presence. Selfies, rotating QR codes and short expiry add deterrence.
- Proximity policy (`modules/attendance/proximity.service.ts`): each session's reference point is the
  lecturer's GPS position when the QR code is generated (fresh, within the lecturer accuracy limit,
  otherwise refused and not stored). The server alone computes the Haversine distance to each
  student reading and applies the fixed 20 m rule with the device's reported uncertainty: accepted
  only when distance + accuracy ≤ 20 m, rejected only when distance − accuracy > 20 m, otherwise
  *uncertain* (retry). The limit is never widened for poor accuracy; stale or timestamp-less readings
  are refused. Reference coordinates are never returned to students.
- The reference point changes only through an authorized, audited action
  (`attendance_session.reference_location_changed`, with reason, old and new point); accepted
  students are re-checked against the current point at submit.
- Location is the first step: student-ID lookups (and their enumeration caps) only start after the
  server has accepted the device's location. The accepted reading is signed into the short-lived
  attempt token bound to the QR token, session and tenant, so submit cannot be fed a different
  reading or a token from another session. Failed checks are capped per client and session
  (uncertain readings have a larger allowance) and raise security events; route-level rate limits
  apply as well. Geolocation requires HTTPS and is limited to this origin by `Permissions-Policy`.
- A selfie is an audit and deterrence aid. It is not biometric identity verification; records say
  `CAPTURED_NOT_BIOMETRICALLY_VERIFIED`. Face matching and liveness can be added as modules.

## Secrets

All secrets come from environment variables (see `.env.example`). Never commit `.env`. Rotate
`JWT_*` secrets to invalidate all sessions; rotating `DATA_ENCRYPTION_KEY` requires re-enrolling MFA.
