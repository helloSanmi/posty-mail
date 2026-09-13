-- One live reset token per user, enforced by the database.
--
-- The application already guarantees this: issueToken burns outstanding rows
-- and creates the replacement inside a single transaction that opens with a
-- per-user advisory lock. This index is the backstop, so the invariant does
-- not depend on a future caller remembering the burn — two live tokens for one
-- user is two live takeover credentials for one account.
--
-- Partial, on usedAt IS NULL: burned and expired rows are deliberately kept
-- (the per-address hourly counter reads them), and there may be any number of
-- those per user.
--
-- The burn below is defensive. It can only match rows if a build running the
-- pre-lock code raced itself before this migration was applied; on any healthy
-- database it updates nothing. It must run first regardless, or CREATE UNIQUE
-- INDEX would fail on exactly the duplicates this is here to prevent.
UPDATE "PasswordResetToken" t
   SET "usedAt" = NOW()
 WHERE t."usedAt" IS NULL
   AND EXISTS (
     SELECT 1 FROM "PasswordResetToken" o
      WHERE o."userId" = t."userId"
        AND o."usedAt" IS NULL
        AND (o."createdAt" > t."createdAt"
             OR (o."createdAt" = t."createdAt" AND o."id" > t."id"))
   );

CREATE UNIQUE INDEX "PasswordResetToken_one_live_per_user"
    ON "PasswordResetToken"("userId")
 WHERE "usedAt" IS NULL;
