-- The session and QR code are now created first and the lecturer's location is saved right after,
-- so a session that requires location can briefly have no coordinates. Students are refused
-- (LECTURER_LOCATION_MISSING) until it is saved. No data is changed.
ALTER TABLE "attendance_sessions" DROP CONSTRAINT IF EXISTS attendance_sessions_location_chk;
