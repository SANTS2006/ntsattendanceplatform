# Attendance workflow

## Lecturer

1. **Sessions & QR → New session**: choose the course/class (lecturers see only assigned ones) or an
   event; the page shows the class's room so the lecturer can confirm they are in it.
2. Choose QR expiry (5 / 10 / 15 / 30 / 60 minutes or custom), optional "late after" minutes and
   optional **rotating QR** (new code every 30 s).
3. Location verification is on by default (*students must be within 20 m of you*); it can be turned off
   per session. Selfie and enrollment requirements default from organization settings.
4. **Generate QR code**: the browser asks for the lecturer's current position (high accuracy), collects
   fresh readings and keeps the most precise one. A reading less precise than the lecturer threshold
   (default ±20 m) or older than the maximum age is **refused and not saved** — no session, no QR code.
   Otherwise the server re-validates the reading, saves it as the session's **reference point**
   (latitude, longitude, accuracy, capture time) and only then creates the session and its QR code.
5. Present the QR full screen. The page shows a server-synced countdown, statistics, failed attempts,
   a live feed (Socket.IO) and the reference point (coordinates, accuracy, time).
6. **Update location** (only if the QR was generated in the wrong place): requires a reason and a new
   reading meeting the same rules; recorded in the audit log. Students already accepted are re-checked
   against the new point when they submit.
7. Close the session, revoke the QR (e.g. if shared), or replace it with a new session (the
   replacement keeps the reference point). Records can be corrected or added manually with an audited
   reason. Export CSV, Excel or PDF.

## Student (phone, no account)

| Step | Server checks |
|---|---|
| Scan QR → `POST /public/attendance/:token/validate` | Token hash exists, not revoked, session active, not expired (server clock), organization active. Returns the context, student-ID format and a signed attempt token. |
| Share location → `/verify-location` (**first**, when location verification is on) | Fresh reading; valid coordinates; Haversine distance to the lecturer's reference point; the 20 m rule with the reported uncertainty (below). Structured outcome; repeated failures per client are capped and logged. |
| Type student ID → `/verify-student` | Refused (`LOCATION_NOT_VERIFIED`) until the location is accepted. Live `n/8` counter; verification starts automatically once the configured format is satisfied (no lookup button). Server validates format, finds the active student in this tenant, checks enrollment/registration and that attendance isn't already recorded. Failure caps prevent enumeration. Returns name, ID, full email (shown so the student can confirm it is their record), program and level. |
| Selfie → `/upload-selfie` | Front camera capture (or native camera fallback); type sniffing, decode, EXIF stripping, private storage. |
| Submit → `/submit` (Idempotency-Key) | Re-validates **everything** in one transaction with the server clock: session open, student active and eligible, location, selfie ownership, late rules. The unique constraint makes concurrent duplicates impossible; the same idempotency key replays the original success. |
| Success page | Reference number, details, server time in the organization's time zone, selfie. |

Error screens: invalid, expired or revoked QR; ended session; session without a valid reference
point; student not found; not enrolled; location denied, outside 20 m, uncertain or stale (retry);
camera denied or missing; upload failure; already recorded; too many attempts; network errors.

## Location verification

1. The lecturer creates the session from any device. The session and QR code are created first.
2. The session page then asks for the lecturer's location and saves it
   (`POST /attendance/sessions/:id/location`, audited). The lecturer can share it again if they move.
3. A student scans the QR code and the page asks for their location.
4. The server compares the two with the Haversine formula:
   - **20 m apart or less:** the student is in class and continues to the student ID step.
   - **More than 20 m apart:** `NOT_IN_CLASS`; the student sees the error and cannot record attendance.
5. At submit, the accepted location is compared again with the lecturer's current location.

Other outcomes: `LECTURER_LOCATION_MISSING` (the lecturer has not shared a location yet) and
`LOCATION_INVALID` (unusable coordinates). The device's reported accuracy is stored for staff but
does not affect the decision. The lecturer's coordinates are never sent to students.

**Limitation:** browser location can be spoofed, and computers and indoor phones can be tens of
metres (computers sometimes kilometres) off. A wrong lecturer reading affects every student in that
session; the lecturer can share again from a phone, and staff can use manual entry.

## Data recorded per check-in

Tenant, session, student, class/event, lecturer, reference number, snapshots of name/ID/email/
program/level/context, server timestamp, attendance date (organization time zone), status
(present/late), location verified, server-computed distance, accuracy, the accepted coordinates,
the proximity outcome with the reference point's accuracy and capture time, selfie reference and
verification flags (e.g. implausible accuracy, coordinates identical to the reference, duplicate selfie).
