-- Drip sequences: a chain of templated emails a contact receives over time.
-- v1 trigger is "added to a specific group" (triggerType='group_added').
CREATE TABLE "Sequence" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "triggerType"    TEXT NOT NULL DEFAULT 'group_added',
  "triggerGroupId" TEXT,
  "steps"          JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SequenceEnrollment" (
  "id"            TEXT NOT NULL,
  "sequenceId"    TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "enrolledAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextStepIndex" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt"     TIMESTAMP(3),
  "status"        TEXT NOT NULL DEFAULT 'active',
  "lastError"     TEXT,
  CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_email_key"
  ON "SequenceEnrollment"("sequenceId", "email");
CREATE INDEX "SequenceEnrollment_nextRunAt_status_idx"
  ON "SequenceEnrollment"("nextRunAt", "status");

ALTER TABLE "SequenceEnrollment"
  ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey"
  FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
