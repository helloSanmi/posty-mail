-- Optional, informational, self-service. Nullable with no default and no
-- backfill, so this is additive: every existing row stays valid, every
-- existing query keeps working, and a deploy that runs this against a live
-- database takes no lock worth worrying about.
ALTER TABLE "User" ADD COLUMN "location" TEXT;
