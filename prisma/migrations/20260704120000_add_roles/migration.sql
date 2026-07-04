-- Role-based access control. Introduces a per-account Role table. Each role
-- carries a JSON array of "area" permission keys (see shared/permissions.js).
-- User.role continues to hold a role KEY (e.g. 'admin', 'editor'); this table
-- gives those keys structure + editable permission sets + custom roles.
--
-- No data backfill here: the built-in roles (admin/editor/viewer) are seeded
-- idempotently from application code at startup (ensureAllAccountsSeeded) and
-- on signup, so existing accounts get their roles without a SQL INSERT that
-- would need gen_random_uuid()/JSON literals.

CREATE TABLE "Role" (
  "id"          TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "permissions" JSONB NOT NULL,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_accountId_key_key" ON "Role"("accountId", "key");
CREATE INDEX "Role_accountId_idx" ON "Role"("accountId");

ALTER TABLE "Role"
  ADD CONSTRAINT "Role_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
