-- Distinct SQLSTATEs so the API can tell tenant-integrity violations apart from ordinary
-- foreign-key errors (Prisma collapses 23503 into a generic P2003 without the message).
--   NTS01 = cross-tenant reference, NTS02 = tenant id change

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
          USING ERRCODE = 'NTS01';
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
    RAISE EXCEPTION 'NTS_TENANT_IMMUTABLE: organizationId cannot change on %', TG_TABLE_NAME USING ERRCODE = 'NTS02';
  END IF;
  RETURN NEW;
END $$;

