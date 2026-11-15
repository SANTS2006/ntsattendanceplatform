-- Multiple roles per member: the role the member is currently acting as.
ALTER TABLE "organization_memberships" ADD COLUMN "activeRole" TEXT;

-- History module: fast lookups of a record's audit trail.
CREATE INDEX "audit_logs_organizationId_targetType_targetId_createdAt_idx"
  ON "audit_logs" ("organizationId", "targetType", "targetId", "createdAt");

-- Attendance geofence is now 14-20 m (default 20 m).
ALTER TABLE "organization_settings" ALTER COLUMN "defaultGeofenceRadiusM" SET DEFAULT 20;
UPDATE "organization_settings" SET "defaultGeofenceRadiusM" = LEAST(GREATEST("defaultGeofenceRadiusM", 14), 20);
