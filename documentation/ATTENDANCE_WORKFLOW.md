# Attendance workflow

## Lecturer

1. **Sessions & QR → New session**: choose a class or event (lecturers see only assigned ones).
2. Choose QR expiry (5 / 10 / 15 / 30 / 60 minutes or custom), optional "late after" minutes and
   optional **rotating QR** (new code every 30 s).
3. Location: use the venue saved on the class/event, **capture it by GPS** (only a reading within the
   organization's venue-capture limit, default ±30 m, can be saved) or **select it on the map**
   (recorded as *manual, not GPS-verified*). Set the radius (14–20 m) and the maximum student GPS
   uncertainty, or disable location checks. See *Location verification* below.
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
| Type student ID → `/verify-student` | Live `n/8` counter; verification starts automatically once the configured format is satisfied (no lookup button). Server validates format, finds the active student in this tenant, checks enrollment/registration and that attendance isn't already recorded. Failure caps prevent enumeration. Returns name, ID, full email (shown so the student can confirm it is their record), program and level. |
| Selfie → `/upload-selfie` | Front camera capture (or native camera fallback); type sniffing, decode, EXIF stripping, private storage. |
| Submit → `/submit` (Idempotency-Key) | Re-validates **everything** in one transaction with the server clock: session open, student active and eligible, location, selfie ownership, late rules. The unique constraint makes concurrent duplicates impossible; the same idempotency key replays the original success. |
| Success page | Reference number, details, server time in the organization's time zone, selfie. |

Error screens: invalid, expired or revoked QR; closed session; student not found; not enrolled;
location denied, outside geofence or inaccurate; camera denied or missing; upload failure;
already recorded; too many attempts; network errors.

## Location verification

Browser geolocation is untrusted input. The device only collects readings; every decision is made by
the server against the session's snapshot of the venue and policy.

### Policy (Settings → Attendance & location; snapshotted on each session)

| Setting | Default | Range | Purpose |
|---|---|---|---|
| Geofence radius | 20 m | 14–20 m | Maximum distance from the venue. Never widened by GPS uncertainty. |
| Max student GPS uncertainty | 50 m | 5–1000 m | Readings less precise than this are rejected; the student may retry. Recommended 25–30 m. |
| Max venue capture uncertainty | 30 m | 5–100 m | A venue can only be registered by GPS when the reading is at least this precise. |
| Max reading age | 30 s | 5–300 s | Cached/stale readings are rejected. |
| Acquisition timeout | 60 s | 10–180 s | How long devices keep collecting readings. |
| Readings collected | 5 | 1–20 | Devices keep the single most precise fresh reading — never an average. |
| Max failed location checks | 5 | 1–100 | Per device, per session, within 15 minutes. |

Settings and the new-session page warn when the allowed uncertainty exceeds the radius, when a venue
is missing, when a venue was placed manually on the map, and when a saved venue predates verification.

### Lecturer venue capture states

| State | Message |
|---|---|
| Acquiring | "Obtaining your current location. Please wait." (with reading count and best accuracy so far) |
| Acceptable | "Location accuracy is acceptable. You can save this classroom location." |
| Insufficient | "Your device reported location uncertainty of approximately N metres. We cannot use this reading to register a classroom." + retry / select on map |
| Error | "Unable to obtain your location. Check your device location settings and browser permissions." |

The panel shows latitude, longitude, accuracy, capture time and a map preview with the uncertainty
circle (dashed) and the geofence (solid). An inaccurate reading is never saved. Every venue change is
audited (`class.venue_location_set` / `event.venue_location_set`, with source and accuracy). Venues saved
before this policy existed have no source and must be re-captured or placed on the map before they
can anchor a session (`VENUE_NOT_VERIFIED`).

### Student check (server order)

1. **Freshness** — `clientTime − Position.timestamp` ≤ max reading age (`STALE_LOCATION`).
2. **Accuracy** — reported uncertainty ≤ the session limit (`GPS_ACCURACY_INSUFFICIENT`).
3. **Distance** — Haversine distance (degrees in, metres out) ≤ radius (`OUTSIDE_GEOFENCE`, with
   `distanceM`, `radiusM`, `accuracyM` so the page can explain it).

A passing check is signed into the attempt token; `/submit` reuses that verified location (for up to
15 minutes) instead of taking a second reading that could contradict the first. Without it, submit
re-checks the submitted reading itself. Client-supplied distance or "inside" flags are ignored.

### Device requirements and limits

- HTTPS is required (Render provides it); `Permissions-Policy: geolocation=(self)` allows only this origin.
- Phones need Location on and **Precise location** allowed for the browser (Android: Location →
  Google Location Accuracy; iOS: Settings → Privacy → Location Services → Safari Websites → Precise).
- Laptops/desktops usually have no GPS and report Wi-Fi/IP positions with ±100 m to ±20 km; they
  cannot register a venue by GPS — use a phone at the venue or the map.
- Indoors, phone GPS is often ±10–50 m and can drift; multi-storey buildings cannot be distinguished.
- GPS can be spoofed; the geofence raises the effort of cheating but is not proof of presence.

## Data recorded per check-in

Tenant, session, student, class/event, lecturer, reference number, snapshots of name/ID/email/
program/level/context, server timestamp, attendance date (organization time zone), status
(present/late), location verified, distance, accuracy, coordinates, selfie reference and
verification flags (e.g. implausible accuracy, duplicate selfie in session).
