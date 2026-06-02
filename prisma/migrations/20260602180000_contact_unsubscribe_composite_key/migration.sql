-- Relax the global email primary key on Contact + Unsubscribe so the SAME
-- email can exist in different workspaces. Email stays unique WITHIN a
-- workspace via a composite unique index ([accountId, email]); a UUID id
-- becomes the new primary key.
--
-- Strictly additive + non-destructive: we add an `id` column populated with
-- generated UUIDs for existing rows, swap the primary key from email→id, and
-- add the per-account unique index. No row's email/data is modified or
-- dropped. gen_random_uuid() is built into Postgres 13+ (pgcrypto in core).
--
-- Existing data lives entirely in the 'default' workspace, where every email
-- is already unique, so the new ([accountId, email]) unique index can't
-- collide on the way in.

-- ---- Contact ---------------------------------------------------------
ALTER TABLE "Contact" ADD COLUMN "id" TEXT;
UPDATE "Contact" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "Contact" ALTER COLUMN "id" SET NOT NULL;

-- Swap PK: drop the email-based PK, add the id-based one. The old PK's
-- implicit unique index on email goes away with the constraint; the new
-- composite unique index re-establishes per-account uniqueness.
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_pkey";
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Contact_accountId_email_key" ON "Contact"("accountId", "email");

-- ---- Unsubscribe -----------------------------------------------------
ALTER TABLE "Unsubscribe" ADD COLUMN "id" TEXT;
UPDATE "Unsubscribe" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "Unsubscribe" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "Unsubscribe" DROP CONSTRAINT "Unsubscribe_pkey";
ALTER TABLE "Unsubscribe" ADD CONSTRAINT "Unsubscribe_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Unsubscribe_accountId_email_key" ON "Unsubscribe"("accountId", "email");
