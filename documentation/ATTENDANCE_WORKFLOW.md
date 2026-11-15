# Attendance workflow

## Lecturer

1. **Sessions & QR → New session**: choose a class or event (lecturers see only assigned ones).
2. Choose QR expiry (5 / 10 / 15 / 30 / 60 minutes or custom), optional "late after" minutes and
   optional **rotating QR** (new code every 30 s).
3. Location: capture the current position or use the venue saved on the class/event; set radius and
   minimum GPS accuracy, or disable location checks.
4. Selfie and enrollment requirements default from organization settings.
5. **Generate QR code**. Present it full screen. The page shows a server-synced countdown, present /
   absent / rate statistics, failed attempts and a live feed (Socket.IO).
6. Close the session, revoke the QR (e.g. if shared), or replace it with a new session. Records can be
   corrected or added manually with an audited reason. Export CSV, Excel or PDF.

## Student (phone, no account)

| Step | Server checks |
|---|---|
| Scan QR → `POST /public/attendance/:token/validate` | Token hash exists, not revoked, session active, not expired (server clock), organization active. Returns the context, student-ID format and a signed attempt token. |
| Share location → `/verify-location` | Coordinates valid; accuracy ≤ threshold; Haversine distance ≤ radius. Repeated failures per client are capped and logged. |
| Type student ID → `/verify-student` | Live `n/8` counter; verification starts automatically once the configured format is satisfied (no lookup button). Server validates format, finds the active student in this tenant, checks enrollment/registration and that attendance isn't already recorded. Failure caps prevent enumeration. Returns name, ID, masked email, program and level. |
| Selfie → `/upload-selfie` | Front camera capture (or native camera fallback); type sniffing, decode, EXIF stripping, private storage. |
| Submit → `/submit` (Idempotency-Key) | Re-validates **everything** in one transaction with the server clock: session open, student active and eligible, location, selfie ownership, late rules. The unique constraint makes concurrent duplicates impossible; the same idempotency key replays the original success. |
| Success page | Reference number, details, server time in the organization's time zone, selfie. |

Error screens: invalid, expired or revoked QR; closed session; student not found; not enrolled;
location denied, outside geofence or inaccurate; camera denied or missing; upload failure;
already recorded; too many attempts; network errors.

## Data recorded per check-in

Tenant, session, student, class/event, lecturer, reference number, snapshots of name/ID/email/
program/level/context, server timestamp, attendance date (organization time zone), status
(present/late), location verified, distance, accuracy, coordinates, selfie reference and
verification flags (e.g. implausible accuracy, duplicate selfie in session).
