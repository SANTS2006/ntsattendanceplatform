-- GPS geofencing policy (see documentation/ATTENDANCE_WORKFLOW.md).

-- Organization location policy
ALTER TABLE "organization_settings"
  ADD COLUMN "venueCaptureMaxAccuracyM" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "maxLocationAgeSeconds" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "locationTimeoutSeconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "locationSampleCount" INTEGER NOT NULL DEFAULT 5;
-- New organizations default to 50 m student uncertainty; existing values are kept.
ALTER TABLE "organization_settings" ALTER COLUMN "minGpsAccuracyM" SET DEFAULT 50;

-- Venue provenance. Existing coordinates have unknown provenance (NULL) and must be
-- re-captured by GPS or confirmed on the map before they can anchor a session.
ALTER TABLE "classes"
  ADD COLUMN "venueLocationSource" TEXT,
  ADD COLUMN "venueAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "venueCapturedAt" TIMESTAMP(3);
ALTER TABLE "events"
  ADD COLUMN "venueLocationSource" TEXT,
  ADD COLUMN "venueAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "venueCapturedAt" TIMESTAMP(3);
ALTER TABLE "classes" ADD CONSTRAINT "classes_venue_source_chk" CHECK ("venueLocationSource" IS NULL OR "venueLocationSource" IN ('GPS', 'MAP'));
ALTER TABLE "events" ADD CONSTRAINT "events_venue_source_chk" CHECK ("venueLocationSource" IS NULL OR "venueLocationSource" IN ('GPS', 'MAP'));

-- Session snapshot
ALTER TABLE "attendance_sessions"
  ADD COLUMN "locationSource" TEXT,
  ADD COLUMN "locationAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "maxLocationAgeSeconds" INTEGER NOT NULL DEFAULT 30;
