-- Nullable, no default, no backfill. NULL means "we do not know", which is
-- the truth for every row that existed before this column — backfilling it
-- from createdAt would state a date nobody can vouch for, on a field people
-- would reasonably use to decide whether a password is stale.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
