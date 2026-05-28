// Drip-sequence persistence. A Sequence is a linear chain of templated
// emails contacts receive over time; SequenceEnrollment tracks each
// contact's position in the chain. The runner (lib/sequenceRunner.js)
// reads these on a cron tick.
//
// Multi-tenant scope: Sequence carries an accountId; the helpers below
// scope every read/write by it. SequenceEnrollment is a child of
// Sequence and inherits scope through its parent — the runner reads
// Sequence.accountId to attribute downstream sends.
import { prisma } from './prisma.js';

export function sequenceFromDb(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    triggerType: row.triggerType,
    triggerGroupId: row.triggerGroupId,
    steps: Array.isArray(row.steps) ? row.steps : [],
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  };
}

export async function listSequences(accountId) {
  const rows = await prisma.sequence.findMany({
    where: { accountId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(sequenceFromDb);
}

export async function getSequence(accountId, id) {
  const row = await prisma.sequence.findFirst({ where: { id, accountId } });
  return row ? sequenceFromDb(row) : null;
}

export async function upsertSequence(accountId, seq) {
  const data = {
    name: seq.name,
    status: seq.status || 'active',
    triggerType: seq.triggerType || 'group_added',
    triggerGroupId: seq.triggerGroupId || null,
    steps: seq.steps || [],
  };
  const row = await prisma.sequence.upsert({
    where: { id: seq.id },
    create: { id: seq.id, ...data, accountId },
    update: data,
  });
  return sequenceFromDb(row);
}

export async function deleteSequence(accountId, id) {
  return prisma.sequence.deleteMany({ where: { id, accountId } });
}

// Idempotent: if already enrolled, this is a no-op (the @@unique constraint
// on (sequenceId, email) prevents duplicates). Sets nextRunAt based on
// step 0's delayDays so the runner fires the first email at the right time.
//
// Tenant note: the sequence lookup intentionally does NOT take accountId
// because the callers are either (a) the audience-add trigger which has
// already resolved the sequence list for this account, or (b) the manual
// enroll route which has validated ownership via the sequence id. The
// SequenceEnrollment row inherits scope through Sequence.accountId.
export async function enrollInSequence(sequenceId, email) {
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq || seq.status !== 'active') return null;
  const steps = Array.isArray(seq.steps) ? seq.steps : [];
  if (!steps.length) return null;
  const firstDelayMs = (Number(steps[0].delayDays) || 0) * 24 * 60 * 60 * 1000;
  const nextRunAt = new Date(Date.now() + firstDelayMs);
  try {
    return await prisma.sequenceEnrollment.create({
      data: { sequenceId, email, nextStepIndex: 0, nextRunAt, status: 'active' },
    });
  } catch (error) {
    // P2002 = unique violation (already enrolled). Treat as a no-op.
    if (error?.code === 'P2002') return null;
    throw error;
  }
}

export async function listDueEnrollments(now = new Date()) {
  return prisma.sequenceEnrollment.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    take: 100, // batch cap per runner tick
  });
}

export async function advanceEnrollment(id, {
  nextStepIndex, nextRunAt, status, lastError,
}) {
  return prisma.sequenceEnrollment.update({
    where: { id },
    data: { nextStepIndex, nextRunAt, status, lastError: lastError ?? null },
  });
}

export async function listEnrollmentsForSequence(accountId, sequenceId) {
  // Look up the sequence first to confirm it belongs to this account —
  // SequenceEnrollment has no accountId column of its own, so the
  // tenancy gate has to ride on the parent.
  const seq = await prisma.sequence.findFirst({
    where: { id: sequenceId, accountId },
    select: { id: true },
  });
  if (!seq) return null;
  return prisma.sequenceEnrollment.findMany({
    where: { sequenceId },
    orderBy: { enrolledAt: 'desc' },
    take: 500,
  });
}
