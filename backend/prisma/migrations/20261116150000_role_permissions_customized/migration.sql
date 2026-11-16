-- Built-in roles whose permissions an owner/administrator has edited are no longer topped up with
-- default permissions at startup (so a removed permission stays removed).
ALTER TABLE "roles" ADD COLUMN "permissionsCustomized" BOOLEAN NOT NULL DEFAULT false;
