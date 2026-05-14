-- Adds IANA timezone column to Contact for send-time-per-timezone campaigns.
-- Nullable: legacy contacts default to "no timezone known" which the scheduler
-- treats as UTC.
ALTER TABLE "Contact" ADD COLUMN "timezone" TEXT;
