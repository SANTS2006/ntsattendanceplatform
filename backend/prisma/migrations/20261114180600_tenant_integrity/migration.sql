-- ════════════════════════════════════════════════════════════════════════
-- Tenant integrity: defense-in-depth that Prisma cannot model.
--   1. Cross-tenant reference triggers (a row may only reference rows of its own tenant)
--   2. organizationId immutability
--   3. Row-Level Security keyed on the transaction-local setting app.tenant_id
--   4. CHECK constraints
--   5. Append-only audit log
-- Prisma ignores triggers, policies and CHECK constraints, so future `migrate dev`
-- runs will not drop them.
-- NOTE: superusers and BYPASSRLS roles ignore RLS. The application must connect
-- as a normal role (see documentation/DATABASE.md).
-- ════════════════════════════════════════════════════════════════════════

-- 1. Cross-tenant reference guard ------------------------------------------------
-- Usage: TRIGGER ... EXECUTE FUNCTION nts_assert_same_tenant('colA','tableA','colB','tableB',...)
CREATE OR REPLACE FUNCTION nts_assert_same_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i int := 0;
  col text;
  tbl text;
  ref_org uuid;
  row_json jsonb := to_jsonb(NEW);
  own_org uuid := (row_json->>'organizationId')::uuid;
BEGIN
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    tbl := TG_ARGV[i + 1];
    IF row_json->>col IS NOT NULL THEN
      EXECUTE format('SELECT "organizationId" FROM %I WHERE id = $1', tbl)
        INTO ref_org USING (row_json->>col)::uuid;
      IF ref_org IS DISTINCT FROM own_org THEN
        RAISE EXCEPTION 'NTS_CROSS_TENANT_REFERENCE: %.% references a row outside the tenant', TG_TABLE_NAME, col
          USING ERRCODE = '23503';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION nts_forbid_tenant_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'NTS_TENANT_IMMUTABLE: organizationId cannot change on %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('membership_roles',         $a$'membershipId','organization_memberships','roleId','roles','departmentId','departments'$a$),
    ('invitations',              $a$'roleId','roles','departmentId','departments'$a$),
    ('departments',              $a$'facultyId','faculties'$a$),
    ('programs',                 $a$'departmentId','departments'$a$),
    ('semesters',                $a$'academicYearId','academic_years'$a$),
    ('courses',                  $a$'departmentId','departments','programId','programs','levelId','academic_levels'$a$),
    ('classes',                  $a$'courseId','courses','academicYearId','academic_years','semesterId','semesters'$a$),
    ('students',                 $a$'programId','programs','departmentId','departments','levelId','academic_levels'$a$),
    ('lecturers',                $a$'membershipId','organization_memberships','departmentId','departments'$a$),
    ('class_lecturers',          $a$'classId','classes','lecturerId','lecturers'$a$),
    ('enrollments',              $a$'studentId','students','classId','classes'$a$),
    ('event_participants',       $a$'eventId','events','studentId','students'$a$),
    ('event_managers',           $a$'eventId','events','lecturerId','lecturers'$a$),
    ('attendance_sessions',      $a$'classId','classes','eventId','events','lecturerId','lecturers'$a$),
    ('qr_tokens',                $a$'sessionId','attendance_sessions'$a$),
    ('attendance_selfies',       $a$'sessionId','attendance_sessions','studentId','students'$a$),
    ('attendance_records',       $a$'sessionId','attendance_sessions','studentId','students','classId','classes','eventId','events','lecturerId','lecturers','selfieId','attendance_selfies'$a$),
    ('attendance_verifications', $a$'sessionId','attendance_sessions','studentId','students'$a$)
  ) AS t(tbl, args)
  LOOP
    EXECUTE format('CREATE TRIGGER nts_same_tenant BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION nts_assert_same_tenant(%s)', spec.tbl, spec.args);
  END LOOP;
END $$;

-- 2 + 3. Immutability and Row-Level Security on tenant-owned tables ---------------
CREATE OR REPLACE FUNCTION nts_tenant_visible(org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  -- Inside a tenant-scoped transaction app.tenant_id is set and only that tenant's rows
  -- are visible/writable. System paths (auth, platform admin, workers resolving a tenant
  -- from a validated job) run without the setting.
  SELECT coalesce(current_setting('app.tenant_id', true), '') = ''
      OR org = nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organization_memberships','roles','membership_roles','invitations','faculties','departments','programs',
    'academic_levels','academic_years','semesters','courses','classes','students','lecturers','class_lecturers',
    'enrollments','events','event_participants','event_managers','attendance_sessions','qr_tokens',
    'attendance_records','attendance_selfies','attendance_verifications','student_imports','report_exports'
  ] LOOP
    EXECUTE format('CREATE TRIGGER nts_tenant_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION nts_forbid_tenant_change()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'organization_memberships','roles','membership_roles','invitations','faculties','departments','programs',
    'academic_levels','academic_years','semesters','courses','classes','students','lecturers','class_lecturers',
    'enrollments','events','event_participants','event_managers','attendance_sessions','qr_tokens',
    'attendance_records','attendance_selfies','attendance_verifications','student_imports','report_exports',
    'organization_settings','audit_logs','security_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY nts_tenant_isolation ON %I USING (nts_tenant_visible("organizationId")) WITH CHECK (nts_tenant_visible("organizationId"))', t);
  END LOOP;
END $$;

-- 4. CHECK constraints ------------------------------------------------------------
ALTER TABLE attendance_sessions
  ADD CONSTRAINT attendance_sessions_target_chk CHECK ("classId" IS NOT NULL OR "eventId" IS NOT NULL),
  ADD CONSTRAINT attendance_sessions_window_chk CHECK ("expiresAt" > "startsAt"),
  ADD CONSTRAINT attendance_sessions_radius_chk CHECK ("radiusM" BETWEEN 5 AND 50000),
  ADD CONSTRAINT attendance_sessions_accuracy_chk CHECK ("minAccuracyM" BETWEEN 1 AND 10000),
  ADD CONSTRAINT attendance_sessions_lat_chk CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT attendance_sessions_lng_chk CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT attendance_sessions_location_chk CHECK (NOT "locationRequired" OR (latitude IS NOT NULL AND longitude IS NOT NULL));

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_lat_chk CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT attendance_records_lng_chk CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  ADD CONSTRAINT attendance_records_accuracy_chk CHECK ("gpsAccuracyM" IS NULL OR "gpsAccuracyM" >= 0);

ALTER TABLE organization_settings
  ADD CONSTRAINT org_settings_id_len_chk CHECK ("studentIdMinLength" >= 1 AND "studentIdMaxLength" <= 64 AND "studentIdMinLength" <= "studentIdMaxLength"),
  ADD CONSTRAINT org_settings_exact_len_chk CHECK ("studentIdExactLength" IS NULL OR "studentIdExactLength" BETWEEN 1 AND 64),
  ADD CONSTRAINT org_settings_radius_chk CHECK ("defaultGeofenceRadiusM" BETWEEN 5 AND 50000),
  ADD CONSTRAINT org_settings_retention_chk CHECK ("imageRetentionDays" BETWEEN 1 AND 3650);

-- 5. Append-only audit log --------------------------------------------------------
CREATE OR REPLACE FUNCTION nts_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NTS_AUDIT_IMMUTABLE: audit records cannot be modified or deleted' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER nts_audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION nts_audit_append_only();
