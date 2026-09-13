-- Default 0, NOT NULL. Tokens issued before this column existed carry no
-- version claim; requireAuth reads a missing claim as 0, which matches every
-- existing row, so no one is signed out by the deploy itself.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
