// Drip-sequence runner. Cron tick scans for enrollments whose nextRunAt has
// elapsed, sends the next step, and advances the cursor.
//
// One enrollment = one (sequence, contact) pair. The runner doesn't loop
// over a sequence's whole step list in one go — each tick fires the *current*
// step then schedules the next one for delayDays from now. This keeps step
// timings honest: "3 days after step 1, send step 2" stays 3 days even if
// step 1 itself gets delayed by an outage.
//
// Multi-tenant scope: listDueEnrollments returns enrollments with their
// parent Sequence included, so each enrollment carries the workspace's
// accountId. Every per-tenant helper (template / contact / unsubscribed
// set) gets that accountId threaded through; the unsubscribed set is
// memoized per-account inside one tick so 50 enrollments in the same
// workspace don't do 50 round-trips.
//
// Public API:
//   - registerSequenceRunner(): wires a 5-minute cron. Called once at server start.
//   - runDueSequences(): one-shot processor; runs every tick AND can be invoked
//     directly from tests or admin reset scripts.

import cron from 'node-cron';
import { renderTemplate } from '../../shared/campaignUtils.js';
import { sendTransactionalEmail } from './brevoClient.js';
import { resolveSender } from './sender.js';
import {
  advanceEnrollment,
  listDueEnrollments,
  prisma,
  unsubscribedEmailSet,
} from './db.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Test seam. Set during unit tests so we don't make actual Brevo calls. Real
// production code path goes through the real sendTransactionalEmail.
let sendOverride = null;
export function _setSendOverride(fn) { sendOverride = fn; }

async function loadTemplate(accountId, templateId) {
  if (!templateId) return null;
  // findFirst (not findUnique) so we can AND in accountId — a template
  // id from one workspace cannot be loaded by a sequence in another.
  const row = await prisma.template.findFirst({
    where: { id: templateId, accountId },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    text: row.text,
    logoUrl: row.logoUrl || '',
    ...(row.data || {}),
  };
}

async function processEnrollment(enrollment, ctx) {
  // listDueEnrollments includes the parent sequence, so accountId is
  // already on the enrollment object. Sequence status changes (paused
  // / deleted) are checked off this same in-memory copy.
  const seq = enrollment.sequence;
  const accountId = seq?.accountId;
  if (!seq || seq.status !== 'active') {
    // Sequence was paused / deleted underneath us. Park the enrollment.
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: enrollment.nextStepIndex,
      nextRunAt: null,
      status: 'paused',
    });
    return;
  }

  const steps = Array.isArray(seq.steps) ? seq.steps : [];
  const stepIdx = enrollment.nextStepIndex;
  const step = steps[stepIdx];
  if (!step) {
    // We ran past the end — mark complete.
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: stepIdx,
      nextRunAt: null,
      status: 'completed',
    });
    return;
  }

  // Hard-suppression check at fire time. The Unsubscribe table is the
  // source of truth — if the contact unsubscribed since enrolling, we
  // stop here and mark the enrollment so reports show why. The set is
  // looked up lazily per-account (cached in ctx.unsubscribedByAccount)
  // so 50 enrollments in the same workspace don't run 50 queries.
  const unsubscribed = await ctx.unsubscribedFor(accountId);
  if (unsubscribed.has(enrollment.email)) {
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: stepIdx,
      nextRunAt: null,
      status: 'unsubscribed',
    });
    return;
  }

  const template = await loadTemplate(accountId, step.templateId);
  if (!template) {
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: stepIdx,
      nextRunAt: null,
      status: 'paused',
      lastError: `Template ${step.templateId} not found.`,
    });
    return;
  }

  // Look up the contact via findFirst + accountId so even if Contact's
  // global email PK is eventually relaxed to per-account, this loader
  // keeps doing the right thing.
  const contactRow = await prisma.contact.findFirst({
    where: { email: enrollment.email, accountId },
  });
  // contact might have been deleted since enrollment. Treat as completed
  // rather than retrying forever; no recipient to send to.
  if (!contactRow) {
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: stepIdx,
      nextRunAt: null,
      status: 'completed',
    });
    return;
  }

  const unsubscribeBase = process.env.PUBLIC_BASE_URL
    ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/unsubscribe`
    : 'https://example.com/unsubscribe';
  const unsubscribeUrl = `${unsubscribeBase}?email=${encodeURIComponent(enrollment.email)}&sequence=${seq.id}`;
  const enriched = {
    ...contactRow,
    ...(contactRow.data || {}),
    unsubscribeUrl,
    logoUrl: template.logoUrl || '',
  };

  try {
    const send = sendOverride || sendTransactionalEmail;
    await send({
      contact: contactRow,
      sender: ctx.sender,
      subject: renderTemplate(template.subject, enriched),
      htmlContent: renderTemplate(template.html, enriched),
      textContent: renderTemplate(template.text, enriched),
      idempotencyKey: `seq:${seq.id}:${enrollment.email}:${stepIdx}`,
      // We tag with sequence:<id>:step:<n> so the webhook handler / metrics
      // can attribute opens & clicks back to this sequence step. Doesn't go
      // through campaignId because there's no Campaign row.
      campaignId: `seq-${seq.id}-${stepIdx}`,
    });
  } catch (error) {
    // Transient errors get a retry on the next tick (15 min). Don't advance.
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: stepIdx,
      nextRunAt: new Date(Date.now() + 15 * 60 * 1000),
      status: 'active',
      lastError: error.message,
    });
    return;
  }

  // Advance to the next step, or complete.
  const nextIdx = stepIdx + 1;
  if (nextIdx >= steps.length) {
    await advanceEnrollment(enrollment.id, {
      nextStepIndex: nextIdx,
      nextRunAt: null,
      status: 'completed',
    });
    return;
  }
  const nextDelay = (Number(steps[nextIdx].delayDays) || 0) * ONE_DAY_MS;
  await advanceEnrollment(enrollment.id, {
    nextStepIndex: nextIdx,
    nextRunAt: new Date(Date.now() + nextDelay),
    status: 'active',
  });
}

/**
 * One pass over due enrollments. Fires each one's next step in serial. Safe to
 * invoke directly (tests, admin scripts) or via the scheduled cron.
 */
export async function runDueSequences() {
  // Defensive guard against an un-migrated install. If the Prisma client
  // doesn't have the Sequence model yet (migration applied but `prisma
  // generate` was skipped on this machine), bail quietly instead of spamming
  // the log every 5 minutes.
  if (!prisma.sequence || !prisma.sequenceEnrollment) {
    return { processed: 0, skipped: 'prisma-client-out-of-date' };
  }
  const due = await listDueEnrollments();
  if (!due.length) return { processed: 0 };

  let sender = null;
  try { sender = await resolveSender(); } catch { /* keep going; null sender = abort below */ }
  if (!sender) {
    // Park everything for an hour. Re-check after the admin sets a sender.
    for (const enrollment of due) {
      await advanceEnrollment(enrollment.id, {
        nextStepIndex: enrollment.nextStepIndex,
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000),
        status: 'active',
        lastError: 'Sender not configured.',
      });
    }
    return { processed: 0, paused: due.length };
  }

  // Memoize the unsubscribed set per account inside one tick. Multiple
  // enrollments from the same workspace share one round-trip.
  const unsubscribedByAccount = new Map();
  async function unsubscribedFor(accountId) {
    if (!accountId) return new Set();
    if (unsubscribedByAccount.has(accountId)) return unsubscribedByAccount.get(accountId);
    const set = await unsubscribedEmailSet(accountId);
    unsubscribedByAccount.set(accountId, set);
    return set;
  }
  const ctx = { sender, unsubscribedFor };

  let processed = 0;
  for (const enrollment of due) {
    try {
      await processEnrollment(enrollment, ctx);
      processed += 1;
    } catch (error) {
      console.error('[sequenceRunner] processEnrollment failed:', error.message);
    }
  }
  return { processed };
}

/**
 * Cron registration. Fires every 5 minutes. Idempotent; if called twice it
 * silently no-ops the second time.
 */
let cronJob = null;
export function registerSequenceRunner() {
  if (cronJob) return cronJob;
  cronJob = cron.schedule('*/5 * * * *', () => {
    runDueSequences().catch((error) => {
      console.error('[sequenceRunner] tick failed:', error.message);
    });
  }, { scheduled: true });
  return cronJob;
}
