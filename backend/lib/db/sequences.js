// Drip-sequence persistence. A Sequence is a linear chain of templated
// emails contacts receive over time; SequenceEnrollment tracks each
// contact's position in the chain. The runner (lib/sequenceRunner.js)
// reads these on a cron tick.
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

export async function listSequences() {
  const rows = await prisma.sequence.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(sequenceFromDb);
}

export async function getSequence(id) {
  const row = await prisma.sequence.findUnique({ where: { id } });
  return row ? sequenceFromDb(row) : null;
}

export async function upsertSequence(seq) {
  const data = {
    name: seq.name,
    status: seq.status || 'active',
    triggerType: seq.triggerType || 'group_added',
    triggerGroupId: seq.triggerGroupId || null,
    steps: seq.steps || [],
  };
  const row = await prisma.sequence.upsert({
    where: { id: seq.id },
    create: { id: seq.id, ...data },
    update: data,
  });
  return sequenceFromDb(row);
}

export async function deleteSequence(id) {
  return prisma.sequence.deleteMany({ where: { id } });
}

// Idempotent: if already enrolled, this is a no-op (the @@unique constraint
// on (sequenceId, email) prevents duplicates). Sets nextRunAt based on
// step 0's delayDays so the runner fires the first email at the right time.
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

export async function listEnrollmentsForSequence(sequenceId) {
  return prisma.sequenceEnrollment.findMany({
    where: { sequenceId },
    orderBy: { enrolledAt: 'desc' },
    take: 500,
  });
}
