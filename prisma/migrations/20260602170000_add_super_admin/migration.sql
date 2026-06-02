-- Install-level super-admin flag on User.
--
-- A super-admin manages every workspace (the /api/super-admin/* routes),
-- as opposed to `role`, which is the user's role inside their own
-- workspace. On a fresh install the first signup becomes the super-admin.
--
-- Backfill: the original install owner is the admin of the seeded
-- 'default' workspace (that's where the first-ever user landed before
-- multi-tenancy and where the migration parked all legacy data). Promote
-- every admin in 'default' to super-admin so the existing operator keeps
-- full control after this migration.

ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "isSuperAdmin" = true
WHERE "accountId" = 'default' AND "role" = 'admin';
