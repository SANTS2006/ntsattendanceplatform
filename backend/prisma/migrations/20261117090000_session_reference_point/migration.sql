-- Lecturer-generated QR proximity verification (see documentation/ATTENDANCE_WORKFLOW.md).
-- The reference point of an attendance session is now the lecturer's own GPS position when the
-- QR code is generated (no permanent classroom geofence). Columns are renamed in place so
-- existing sessions and their history are preserved; CHECK constraints follow the renames.

-- ── Attendance sessions ─────────────────────────────────────────────────────
ALTER TABLE "attendance_sessions" RENAME COLUMN "latitude" TO "referenceLatitude";
ALTER TABLE "attendance_sessions" RENAME COLUMN "longitude" TO "referenceLongitude";
ALTER TABLE "attendance_sessions" RENAME COLUMN "locationAccuracyM" TO "referenceAccuracyMeters";
ALTER TABLE "attendance_sessions" RENAME COLUMN "radiusM" TO "maximumDistanceMeters";
ALTER TABLE "attendance_sessions" RENAME COLUMN "minAccuracyM" TO "studentMaxAccuracyM";
ALTER TABLE "attendance_sessions" RENAME COLUMN "locationRequired" TO "locationVerificationEnabled";
ALTER TABLE "attendance_sessions" ADD COLUMN "referenceCapturedAt" TIMESTAMP(3);

-- Existing sessions: their anchor was captured when the session was created.
UPDATE "attendance_sessions" SET "referenceCapturedAt" = "createdAt" WHERE "referenceLatitude" IS NOT NULL;

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT attendance_sessions_reference_accuracy_chk CHECK ("referenceAccuracyMeters" IS NULL OR "referenceAccuracyMeters" >= 0),
  ADD CONSTRAINT attendance_sessions_reference_pair_chk CHECK (("referenceLatitude" IS NULL) = ("referenceLongitude" IS NULL));

-- ── Organization settings ───────────────────────────────────────────────────
-- The distance limit is fixed at 20 m, so the configurable geofence radius is removed.
ALTER TABLE "organization_settings" DROP COLUMN "defaultGeofenceRadiusM";
ALTER TABLE "organization_settings" RENAME COLUMN "minGpsAccuracyM" TO "studentMaxAccuracyM";
ALTER TABLE "organization_settings" RENAME COLUMN "venueCaptureMaxAccuracyM" TO "lecturerMaxAccuracyM";
ALTER TABLE "organization_settings" ALTER COLUMN "studentMaxAccuracyM" SET DEFAULT 20;
ALTER TABLE "organization_settings" ALTER COLUMN "lecturerMaxAccuracyM" SET DEFAULT 20;
