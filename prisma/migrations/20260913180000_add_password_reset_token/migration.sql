-- Additive: one new table. No ALTER on User, no backfill, no data movement.
-- deploy.sh runs db:deploy BEFORE the pm2 restart, so the OLD code runs
-- against the NEW schema for the length of `npm run build`. A brand-new table
-- is invisible to old code, which is what makes that window a non-event.
--
-- Lock footprint, stated honestly rather than claimed away: the foreign key
-- below briefly takes ShareRowExclusive on "User" (blocking writes to User,
-- not reads) while it installs its trigger. Validation is instantaneous
-- because PasswordResetToken is empty. No table rewrite, no scan.
--
-- Rollback: DROP TABLE "PasswordResetToken". Reverting the code alone is
-- already safe, since old code never references the table.
CREATE TABLE "PasswordResetToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
