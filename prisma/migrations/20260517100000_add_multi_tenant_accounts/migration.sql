-- Multi-tenant foundation. Introduces an Account model and adds an
-- accountId foreign key to every data table. Existing single-tenant
-- data is backfilled into one "Default workspace" Account so the app
-- continues to function unchanged after this migration applies.
--
-- This migration is intentionally surgical:
--   1. Create the Account table.
--   2. Insert one Default workspace row.
--   3. For each data table: ADD COLUMN accountId nullable → UPDATE to
--      point at Default → ALTER COLUMN to NOT NULL.
--   4. Add FK constraints + accountId indexes.
--   5. Setting stays global — per-account preferences move into
--      Account.data JSON instead (Prisma rejects nullable fields in
--      composite PKs).
--
-- What this migration does NOT do:
--   - Change Contact / Unsubscribe primary key. Both still keyed on
--     `email`. A follow-up migration will switch to UUID PK +
--     @@unique([accountId, email]) once the code is scoped to read
--     contacts via the composite key.
--   - Touch application code. That comes in the query-scoping pass.
--     With every existing row pointed at the Default account, the
--     un-scoped queries that exist today keep returning the same data
--     they did before this migration.

-- 1. Account table -----------------------------------------------------
CREATE TABLE "Account" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "senderEmail"   TEXT,
  "senderName"    TEXT,
  "replyToEmail"  TEXT,
  "replyToName"   TEXT,
  "data"          JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- 2. Seed the Default workspace ---------------------------------------
-- Deterministic id ('default') makes referencing it in backfill SQL
-- + tests + setup scripts trivial. Future Accounts use uuid.
INSERT INTO "Account" ("id", "name", "createdAt", "updatedAt")
VALUES ('default', 'Default workspace', NOW(), NOW());

-- 3. Add accountId to each scoped table -------------------------------
-- Pattern per table: ADD nullable → UPDATE to 'default' → ALTER NOT NULL.
-- The intermediate nullable state means the migration is safe even
-- against tables that already contain rows.

-- Contact
ALTER TABLE "Contact" ADD COLUMN "accountId" TEXT;
UPDATE "Contact" SET "accountId" = 'default';
ALTER TABLE "Contact" ALTER COLUMN "accountId" SET NOT NULL;

-- Audience
ALTER TABLE "Audience" ADD COLUMN "accountId" TEXT;
UPDATE "Audience" SET "accountId" = 'default';
ALTER TABLE "Audience" ALTER COLUMN "accountId" SET NOT NULL;

-- Template
ALTER TABLE "Template" ADD COLUMN "accountId" TEXT;
UPDATE "Template" SET "accountId" = 'default';
ALTER TABLE "Template" ALTER COLUMN "accountId" SET NOT NULL;

-- Campaign
ALTER TABLE "Campaign" ADD COLUMN "accountId" TEXT;
UPDATE "Campaign" SET "accountId" = 'default';
ALTER TABLE "Campaign" ALTER COLUMN "accountId" SET NOT NULL;

-- Draft
ALTER TABLE "Draft" ADD COLUMN "accountId" TEXT;
UPDATE "Draft" SET "accountId" = 'default';
ALTER TABLE "Draft" ALTER COLUMN "accountId" SET NOT NULL;

-- Unsubscribe
ALTER TABLE "Unsubscribe" ADD COLUMN "accountId" TEXT;
UPDATE "Unsubscribe" SET "accountId" = 'default';
ALTER TABLE "Unsubscribe" ALTER COLUMN "accountId" SET NOT NULL;

-- Event
ALTER TABLE "Event" ADD COLUMN "accountId" TEXT;
UPDATE "Event" SET "accountId" = 'default';
ALTER TABLE "Event" ALTER COLUMN "accountId" SET NOT NULL;

-- User
ALTER TABLE "User" ADD COLUMN "accountId" TEXT;
UPDATE "User" SET "accountId" = 'default';
ALTER TABLE "User" ALTER COLUMN "accountId" SET NOT NULL;

-- CampaignSend (denormalized accountId for cross-campaign aggregates)
ALTER TABLE "CampaignSend" ADD COLUMN "accountId" TEXT;
UPDATE "CampaignSend" SET "accountId" = 'default';
ALTER TABLE "CampaignSend" ALTER COLUMN "accountId" SET NOT NULL;

-- Segment
ALTER TABLE "Segment" ADD COLUMN "accountId" TEXT;
UPDATE "Segment" SET "accountId" = 'default';
ALTER TABLE "Segment" ALTER COLUMN "accountId" SET NOT NULL;

-- Sequence
ALTER TABLE "Sequence" ADD COLUMN "accountId" TEXT;
UPDATE "Sequence" SET "accountId" = 'default';
ALTER TABLE "Sequence" ALTER COLUMN "accountId" SET NOT NULL;

-- Asset
ALTER TABLE "Asset" ADD COLUMN "accountId" TEXT;
UPDATE "Asset" SET "accountId" = 'default';
ALTER TABLE "Asset" ALTER COLUMN "accountId" SET NOT NULL;

-- AuditLog (nullable: super-admin actions have no parent account)
ALTER TABLE "AuditLog" ADD COLUMN "accountId" TEXT;

-- 4. Foreign keys ------------------------------------------------------
-- Every per-account FK cascades on Account delete so wiping a tenant
-- cleans up all of its rows in one statement. AuditLog uses SET NULL
-- because super-admin audit history outlives a deleted account.
ALTER TABLE "Contact"      ADD CONSTRAINT "Contact_accountId_fkey"      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Audience"     ADD CONSTRAINT "Audience_accountId_fkey"     FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Template"     ADD CONSTRAINT "Template_accountId_fkey"     FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Campaign"     ADD CONSTRAINT "Campaign_accountId_fkey"     FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Draft"        ADD CONSTRAINT "Draft_accountId_fkey"        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Unsubscribe"  ADD CONSTRAINT "Unsubscribe_accountId_fkey"  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Event"        ADD CONSTRAINT "Event_accountId_fkey"        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "User"         ADD CONSTRAINT "User_accountId_fkey"         FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "CampaignSend" ADD CONSTRAINT "CampaignSend_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Segment"      ADD CONSTRAINT "Segment_accountId_fkey"      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Sequence"     ADD CONSTRAINT "Sequence_accountId_fkey"     FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Asset"        ADD CONSTRAINT "Asset_accountId_fkey"        FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "AuditLog"     ADD CONSTRAINT "AuditLog_accountId_fkey"     FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Indexes -----------------------------------------------------------
CREATE INDEX "Contact_accountId_idx"      ON "Contact"("accountId");
CREATE INDEX "Audience_accountId_idx"     ON "Audience"("accountId");
CREATE INDEX "Template_accountId_idx"     ON "Template"("accountId");
CREATE INDEX "Campaign_accountId_idx"     ON "Campaign"("accountId");
CREATE INDEX "Draft_accountId_idx"        ON "Draft"("accountId");
CREATE INDEX "Unsubscribe_accountId_idx"  ON "Unsubscribe"("accountId");
CREATE INDEX "Event_accountId_idx"        ON "Event"("accountId");
CREATE INDEX "User_accountId_idx"         ON "User"("accountId");
CREATE INDEX "CampaignSend_accountId_idx" ON "CampaignSend"("accountId");
CREATE INDEX "Segment_accountId_idx"      ON "Segment"("accountId");
CREATE INDEX "Sequence_accountId_idx"     ON "Sequence"("accountId");
CREATE INDEX "Asset_accountId_idx"        ON "Asset"("accountId");
CREATE INDEX "AuditLog_accountId_idx"     ON "AuditLog"("accountId");
