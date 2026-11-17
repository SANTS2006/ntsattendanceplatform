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

## Location verification (lecturer-generated QR proximity)

There is **no permanent classroom geofence**. Each session's reference point is the lecturer's own
GPS position when the QR code is generated; it stays fixed for the session (QR rotation and student
scans never move it) and can only be changed by the audited *Update location* action. Classroom
coordinates saved before this change are kept in the database for history but are not used.

Browser geolocation is untrusted input. Devices only collect readings; every decision is made by the
server (`backend/src/modules/attendance/proximity.service.ts`).

### The 20-metre rule

`MAXIMUM_DISTANCE_METERS = 20` (fixed; saved on each session as `maximumDistanceMeters`).
`distance = haversine(referenceLatitude, referenceLongitude, studentLatitude, studentLongitude)`;
`accuracy` is the student device's reported uncertainty. Distances are compared at 1 cm resolution.

| Condition (server order) | Outcome | HTTP | Student sees |
|---|---|---|---|
| Session closed, revoked or past `expiresAt` (server clock) | `ATTENDANCE_SESSION_EXPIRED` | 410 | "Attendance session ended" |
| Session has no valid reference point | `LECTURER_REFERENCE_LOCATION_INVALID` | 409 | "Session location not set" |
| Reading missing, coordinates out of range, accuracy missing or negative | `LOCATION_ACQUISITION_FAILED` | 422 | Retry guidance |
| `clientTime − Position.timestamp` > max reading age, or no timestamp | `LOCATION_STALE` | 422 | Retry with a fresh reading |
| `distance − accuracy > 20` | `LOCATION_OUTSIDE_RADIUS` | 403 | "About N m from your lecturer … outside the 20 m distance" |
| `accuracy >` student threshold | `LOCATION_UNCERTAIN` (`POOR_ACCURACY`) | 422 | "Only accurate to about ±N m … try again" — never "outside" |
| `distance + accuracy ≤ 20` | `LOCATION_ACCEPTED` | 200 | "Location accepted" (continue to ID and selfie) |
| otherwise (the uncertainty circle straddles 20 m) | `LOCATION_UNCERTAIN` (`BOUNDARY`) | 422 | "Could not confirm … stand still and try again" |

Errors carry `outcome`, `retryable`, `reason`, `distanceM`, `accuracyM`, `ageSeconds` and
`maximumDistanceMeters`. The lecturer's coordinates are never sent to students. The 20 m limit is
never widened to compensate for poor accuracy; a reading less precise than ±20 m can never be accepted.

The lecturer's own reading is checked separately before it can become a reference point (valid
coordinates, not (0, 0), accuracy present and within the lecturer threshold, fresh). Otherwise the
API answers `LECTURER_REFERENCE_LOCATION_INVALID` (422, `reason` `POOR_ACCURACY`, `READING_TOO_OLD`,
`INVALID_COORDINATES`, …) and nothing is saved. The lecturer's own uncertainty is not added to the
student check: a reference point captured at ±20 m can itself be up to about 20 m from the
lecturer's true position.

### Policy (Settings → Attendance & location; snapshotted on each session)

| Setting | Default | Range | Purpose |
|---|---|---|---|
| Verify students' location by default | on | — | Default for new sessions (`locationVerificationEnabled`). |
| Lecturer GPS accuracy required | 20 m | 5–50 m | The reference reading must be at least this precise. |
| Student GPS accuracy required | 20 m | 5–100 m | Less precise readings are `LOCATION_UNCERTAIN` (retry). Values above 20 m only change the guidance. |
| Max reading age | 30 s | 5–300 s | Cached or stale readings are refused (lecturer and student). |
| Acquisition timeout | 60 s | 10–180 s | How long devices keep collecting readings. |
| Readings collected | 5 | 1–20 | Devices keep the single most precise fresh reading — never an average. |
| Max failed location checks | 5 | 1–100 | Per device, per session, within 15 minutes; uncertain readings get 3× this. Then `LOCATION_ATTEMPTS_EXCEEDED` (429) and a security event. |

### Attempt chain, submit and replay protection

1. `/validate` → signed attempt token bound to the QR token, session and tenant.
2. `/verify-location` → on acceptance the accepted reading is signed into the attempt token (valid
   15 minutes). Tokens from another QR code, session or tenant are refused (`ATTEMPT_MISMATCH`).
3. `/verify-student` → only with an accepted location (`LOCATION_NOT_VERIFIED` otherwise).
4. `/submit` (Idempotency-Key) → inside one transaction: session still open; the signed location is
   **re-evaluated against the session's current reference point** (so a corrected reference applies
   to everyone); student eligible; selfie owned; late rules. The unique (session, student)
   constraint makes concurrent duplicates impossible; the same key replays the original success.
   Client-supplied distances, coordinates or "inside" flags are ignored.

### Device requirements and limits

- HTTPS is required (Render provides it); `Permissions-Policy: geolocation=(self)` allows only this origin.
- Phones need Location on and **Precise location** allowed for the browser (Android: Location →
  Google Location Accuracy; iOS: Settings → Privacy → Location Services → Safari Websites → Precise).
- The lecturer should generate the QR code **on a phone**, standing where the students are. Laptops and
  desktops usually have no GPS and report Wi-Fi/IP positions of ±100 m to ±20 km, which are refused.
  A projector can then show the same session with *Present full screen*.
- Indoors, phone GPS is often ±10–50 m and can drift; with a 20 m limit many indoor readings will be
  *uncertain* and need a retry (or a manual entry by the lecturer). Floors of a building cannot be
  distinguished.
- **GPS coordinates from a browser can be spoofed.** This approach improves proximity checking; it does
  not guarantee physical presence. It has not yet been validated on real smartphones in classrooms.

## Data recorded per check-in

Tenant, session, student, class/event, lecturer, reference number, snapshots of name/ID/email/
program/level/context, server timestamp, attendance date (organization time zone), status
(present/late), location verified, server-computed distance, accuracy, the accepted coordinates,
the proximity outcome with the reference point's accuracy and capture time, selfie reference and
verification flags (e.g. implausible accuracy, coordinates identical to the reference, duplicate selfie).
