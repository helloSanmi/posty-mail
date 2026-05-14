import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export function contactFromDb(contact) {
  return {
    ...(contact.data || {}),
    email: contact.email,
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    consent: contact.consent || '',
    region: contact.region || '',
    timezone: contact.timezone || '',
    savedAt: contact.savedAt?.toISOString?.() || contact.savedAt,
    updatedAt: contact.updatedAt?.toISOString?.() || contact.updatedAt,
  };
}

export function templateFromDb(template) {
  return {
    ...(template.data || {}),
    id: template.id,
    name: template.name,
    subject: template.subject,
    html: template.html,
    text: template.text,
    logoUrl: template.logoUrl || '',
    updatedAt: template.updatedAt?.toISOString?.() || template.updatedAt,
  };
}

export function audienceFromDb(audience) {
  return {
    id: audience.id,
    name: audience.name,
    contactEmails: audience.contactEmails,
    disabled: Boolean(audience.disabled),
    updatedAt: audience.updatedAt?.toISOString?.() || audience.updatedAt,
  };
}

// Toggle the "disabled" flag on a group. Disabled groups stay in the DB
// (members, send history references) but get filtered out of the campaign
// recipient picker. Used by the Audience admin to retire an old group
// without losing its data.
export async function setAudienceDisabled(id, disabled) {
  const row = await prisma.audience.update({
    where: { id },
    data: { disabled: Boolean(disabled) },
  });
  return audienceFromDb(row);
}

// Rename only. Kept separate from upsertAudience because that one rewrites
// the membership list too, which is the wrong behavior for an in-place
// rename triggered from the Groups sidebar.
export async function renameAudience(id, name) {
  const row = await prisma.audience.update({
    where: { id },
    data: { name },
  });
  return audienceFromDb(row);
}

export function campaignFromDb(campaign) {
  return {
    ...(campaign.data || {}),
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    createdAt: campaign.createdAt?.toISOString?.() || campaign.createdAt,
    updatedAt: campaign.updatedAt?.toISOString?.() || campaign.updatedAt,
  };
}

export function draftFromDb(draft) {
  return {
    ...(draft.data || {}),
    id: draft.id,
    name: draft.name || draft.data?.name || 'Draft',
    updatedAt: draft.updatedAt?.toISOString?.() || draft.updatedAt,
  };
}

export function unsubscribeFromDb(item) {
  return {
    email: item.email,
    reason: item.reason || '',
    unsubscribedAt: item.unsubscribedAt?.toISOString?.() || item.unsubscribedAt,
  };
}

export function eventFromDb(event) {
  return {
    id: event.id,
    provider: event.provider,
    payload: event.payload,
    receivedAt: event.receivedAt?.toISOString?.() || event.receivedAt,
  };
}

export async function listContacts() {
  const rows = await prisma.contact.findMany({ orderBy: { savedAt: 'desc' } });
  return rows.map(contactFromDb);
}

// Backward-compat thin wrapper around the pure filterToWhere translator in
// lib/segmentFilter.js. Old call sites pass `{ search, region, consent,
// excludeUnsubscribed }` and that still works; new call sites can also pass
// `rules`, `addedAfter`, `addedBefore`, and `_inAnyGroupEmails` via the same
// shape. See segmentFilter.js for the full grammar.
import { filterToWhere } from './segmentFilter.js';
export { filterToWhere as buildContactWhere };

export async function queryContacts({ filter = {}, page = 1, pageSize = 50, sort = 'savedAt' } = {}) {
  const where = filterToWhere(filter);
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);

  const [rows, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      orderBy: { [sort === 'email' ? 'email' : 'savedAt']: sort === 'email' ? 'asc' : 'desc' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    rows: rows.map(contactFromDb),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function deleteContacts(emails) {
  if (!emails?.length) return 0;
  const result = await prisma.contact.deleteMany({
    where: { email: { in: emails } },
  });
  return result.count;
}

export async function unsubscribedEmailSet() {
  const rows = await prisma.unsubscribe.findMany({ select: { email: true } });
  return new Set(rows.map((row) => row.email));
}

export async function listSegments() {
  const rows = await prisma.segment.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    filter: row.filter,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function upsertSegment(segment) {
  return prisma.segment.upsert({
    where: { id: segment.id },
    create: { id: segment.id, name: segment.name, filter: segment.filter },
    update: { name: segment.name, filter: segment.filter },
  });
}

export async function deleteSegment(id) {
  return prisma.segment.deleteMany({ where: { id } });
}

export async function listTemplates() {
  const rows = await prisma.template.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(templateFromDb);
}

export async function listAudiences() {
  const [existingContacts, rows] = await Promise.all([
    prisma.contact.findMany({ select: { email: true } }),
    prisma.audience.findMany({ orderBy: { updatedAt: 'desc' } }),
  ]);
  const liveEmails = new Set(existingContacts.map((row) => row.email));

  const cleaned = [];
  const writes = [];
  for (const row of rows) {
    const before = row.contactEmails || [];
    const after = before.filter((email) => liveEmails.has(email));
    if (after.length !== before.length) {
      writes.push(prisma.audience.update({
        where: { id: row.id },
        data: { contactEmails: after },
      }));
    }
    cleaned.push({ ...row, contactEmails: after });
  }

  // Persist the prune in the background; we don't wait for it.
  if (writes.length) {
    Promise.all(writes).catch(() => {});
  }
  return cleaned.map(audienceFromDb);
}

export async function getAudience(id) {
  const row = await prisma.audience.findUnique({ where: { id } });
  return row ? audienceFromDb(row) : null;
}

export async function deleteAudience(id) {
  return prisma.audience.deleteMany({ where: { id } });
}

export async function patchAudienceMembers(id, { add = [], remove = [] }) {
  const existing = await prisma.audience.findUnique({ where: { id } });
  if (!existing) return null;
  const addNormalized = (add || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  const removeNormalized = (remove || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  const current = new Set(existing.contactEmails || []);
  addNormalized.forEach((email) => current.add(email));
  removeNormalized.forEach((email) => current.delete(email));
  const updated = await prisma.audience.update({
    where: { id },
    data: { contactEmails: Array.from(current) },
  });
  // Same exclusivity invariant as addEmailsToAudience: when adding emails to
  // this group, scrub them from every other group so counts always sum to
  // total contacts.
  if (addNormalized.length) {
    const removeSet = new Set(addNormalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id } } });
    for (const other of others) {
      const before = other.contactEmails || [];
      const after = before.filter((email) => !removeSet.has(email));
      if (after.length !== before.length) {
        await prisma.audience.update({
          where: { id: other.id },
          data: { contactEmails: after },
        });
      }
    }
  }
  return audienceFromDb(updated);
}

export async function listAudienceContacts(id) {
  const audience = await prisma.audience.findUnique({ where: { id } });
  if (!audience) return null;
  const emails = audience.contactEmails || [];
  if (!emails.length) return [];
  const rows = await prisma.contact.findMany({
    where: { email: { in: emails } },
    orderBy: { savedAt: 'desc' },
  });
  return rows.map(contactFromDb);
}

export async function listCampaigns() {
  const rows = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(campaignFromDb);
}

export async function listCampaignsPaged({ page = 1, pageSize = 8 } = {}) {
  const safePageSize = Math.min(Math.max(Number(pageSize) || 8, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const [rows, total] = await prisma.$transaction([
    prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.campaign.count(),
  ]);
  return {
    rows: rows.map(campaignFromDb),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function listDrafts() {
  const rows = await prisma.draft.findMany({ orderBy: { updatedAt: 'desc' } });
  return rows.map(draftFromDb);
}

export async function listUnsubscribes() {
  const rows = await prisma.unsubscribe.findMany({ orderBy: { unsubscribedAt: 'desc' } });
  return rows.map(unsubscribeFromDb);
}

// Read events for the Reports page. With no args, returns the latest 500 —
// the historical default that kept the page snappy for installs with years
// of accumulated webhook traffic. When `since` / `until` are provided we
// raise the cap to 5000 so a date-filtered query (e.g. "last 7 days") can
// return everything in that window even on a high-volume install.
export async function listEvents({ since, until } = {}) {
  const where = {};
  if (since instanceof Date && !Number.isNaN(since.getTime())) {
    where.receivedAt = { ...(where.receivedAt || {}), gte: since };
  }
  if (until instanceof Date && !Number.isNaN(until.getTime())) {
    where.receivedAt = { ...(where.receivedAt || {}), lte: until };
  }
  const hasFilter = Object.keys(where).length > 0;
  const rows = await prisma.event.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: hasFilter ? 5000 : 500,
  });
  return rows.map(eventFromDb);
}

export async function listEventsForCampaign(campaignId, limit = 1000) {
  // Match by tag in JSON payload
  const rows = await prisma.event.findMany({
    where: {
      payload: {
        path: ['tags'],
        array_contains: `campaign:${campaignId}`,
      },
    },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  });
  return rows.map(eventFromDb);
}

export async function upsertContacts(contacts) {
  const ops = contacts.map((contact) => prisma.contact.upsert({
    where: { email: contact.email },
    create: {
      email: contact.email,
      firstname: contact.firstname || '',
      lastname: contact.lastname || '',
      // Default consent to "yes" when the CSV / payload has no value. The
      // compliance gate in shared/campaignUtils.js treats "yes" as affirmative
      // opt-in, so new imports won't be held back by `requireOptIn`. On UPDATE
      // we only fill in the default for empty values. Never overwrite a real
      // value the row already has.
      consent: contact.consent || 'yes',
      region: contact.region || '',
      // Timezone is opt-in. Stored as an IANA string ('America/New_York').
      // Empty = "unknown" which the scheduler treats as UTC. We never
      // overwrite a stored timezone with empty on UPDATE.
      ...(contact.timezone ? { timezone: contact.timezone } : {}),
      data: contact,
    },
    update: {
      firstname: contact.firstname || '',
      lastname: contact.lastname || '',
      // On update we only set consent when the incoming row actually has a
      // value. If consent is missing on the new payload, the spread below is
      // empty and we leave the stored value alone. Re-importing a CSV with
      // no consent column will not silently re-opt-in someone who said "no".
      ...(contact.consent ? { consent: contact.consent } : {}),
      region: contact.region || '',
      ...(contact.timezone ? { timezone: contact.timezone } : {}),
      data: contact,
    },
  }));
  await prisma.$transaction(ops);
}

export async function upsertTemplate(template) {
  return prisma.template.upsert({
    where: { id: template.id },
    create: {
      id: template.id,
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text,
      logoUrl: template.logoUrl || '',
      data: template,
    },
    update: {
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text,
      logoUrl: template.logoUrl || '',
      data: template,
    },
  });
}

export async function deleteTemplate(id) {
  return prisma.template.deleteMany({ where: { id } });
}

export async function upsertAudience(audience) {
  return prisma.audience.upsert({
    where: { id: audience.id },
    create: {
      id: audience.id,
      name: audience.name,
      contactEmails: audience.contactEmails || [],
    },
    update: {
      name: audience.name,
      contactEmails: audience.contactEmails || [],
    },
  });
}

export async function findOrCreateAudienceByName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = await prisma.audience.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  return prisma.audience.create({
    data: {
      id: crypto.randomUUID(),
      name: trimmed,
      contactEmails: [],
    },
  });
}

export async function addEmailsToAudience(id, emails) {
  const audience = await prisma.audience.findUnique({ where: { id } });
  if (!audience) return null;
  const set = new Set(audience.contactEmails || []);
  const normalized = (emails || [])
    .map((email) => (email ? String(email).trim().toLowerCase() : ''))
    .filter(Boolean);
  normalized.forEach((email) => set.add(email));
  const updated = await prisma.audience.update({
    where: { id },
    data: { contactEmails: Array.from(set) },
  });
  // Groups are exclusive: a contact lives in exactly one group at a time.
  // When we add an email to group X, scrub it from every OTHER audience so
  // counts always sum to total. No double-bookkeeping. This covers the
  // legacy "Unspecified" case as well as overlap between named groups.
  if (normalized.length) {
    const removeSet = new Set(normalized);
    const others = await prisma.audience.findMany({ where: { id: { not: id } } });
    for (const other of others) {
      const before = other.contactEmails || [];
      const after = before.filter((email) => !removeSet.has(email));
      if (after.length !== before.length) {
        await prisma.audience.update({
          where: { id: other.id },
          data: { contactEmails: after },
        });
      }
    }

    // Drip-sequence trigger: enroll each newly-added email into any active
    // sequence configured to fire on "added to this group". Fire-and-forget
    // because enrollment is idempotent (unique constraint dedupes) and we
    // don't want the audience write to block on it. Guarded against an
    // un-migrated install (no Sequence model on the Prisma client).
    if (prisma.sequence) {
      try {
        const sequences = await prisma.sequence.findMany({
          where: {
            triggerType: 'group_added',
            triggerGroupId: id,
            status: 'active',
          },
        });
        if (sequences.length) {
          for (const seq of sequences) {
            for (const email of normalized) {
              try { await enrollInSequence(seq.id, email); } catch { /* idempotent */ }
            }
          }
        }
      } catch (error) {
        // Don't fail the group-add just because the sequence enrollment
        // sidecar broke. Log and continue.
        console.error('[audience] sequence trigger failed:', error.message);
      }
    }
  }
  return updated;
}

export async function removeEmailsFromAllAudiences(emails) {
  if (!emails?.length) return 0;
  const set = new Set(emails.map((email) => String(email).trim().toLowerCase()));
  const audiences = await prisma.audience.findMany();
  let touched = 0;
  for (const audience of audiences) {
    const before = audience.contactEmails || [];
    const after = before.filter((email) => !set.has(email));
    if (after.length !== before.length) {
      await prisma.audience.update({
        where: { id: audience.id },
        data: { contactEmails: after },
      });
      touched += 1;
    }
  }
  return touched;
}

export async function upsertCampaign(campaign) {
  return prisma.campaign.upsert({
    where: { id: campaign.id },
    create: {
      id: campaign.id,
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
    },
    update: {
      name: campaign.name || 'Untitled campaign',
      status: campaign.status || 'scheduled',
      data: campaign,
    },
  });
}

export async function getCampaign(id) {
  const row = await prisma.campaign.findUnique({ where: { id } });
  return row ? campaignFromDb(row) : null;
}

export async function listScheduledOrRunningCampaigns() {
  const rows = await prisma.campaign.findMany({
    where: { status: { in: ['scheduled', 'running'] } },
  });
  return rows.map(campaignFromDb);
}

export async function upsertDraft(draft) {
  return prisma.draft.upsert({
    where: { id: draft.id },
    create: {
      id: draft.id,
      name: draft.name || draft.form?.name || 'Draft',
      data: draft,
    },
    update: {
      name: draft.name || draft.form?.name || 'Draft',
      data: draft,
    },
  });
}

export async function upsertUnsubscribe(item) {
  const saved = await prisma.unsubscribe.upsert({
    where: { email: item.email },
    create: {
      email: item.email,
      reason: item.reason || '',
    },
    update: {
      reason: item.reason || '',
      unsubscribedAt: new Date(),
    },
  });

  // Reflect the unsubscribe on the Contact row too. So the Contacts page
  // shows the person as opted-out, not still "yes". The Unsubscribe table is
  // the suppression list (queried at send time); Contact.consent is the
  // user's expressed preference. Both should agree after an unsubscribe.
  // No-op when the email isn't in Contacts (e.g. an admin-added suppression
  // for a stranger who wrote in to opt out).
  await prisma.contact.updateMany({
    where: { email: item.email },
    data: { consent: 'no' },
  });

  return saved;
}

// Admin action: re-opt-in a contact who reached out and asked to come back.
// Removes them from the Unsubscribe table AND flips their Contact.consent
// back to 'yes' so future campaigns include them again.
export async function restoreContactSubscription(email) {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return { restored: false, reason: 'empty email' };
  const removed = await prisma.unsubscribe.deleteMany({ where: { email: lower } });
  const updated = await prisma.contact.updateMany({
    where: { email: lower },
    data: { consent: 'yes' },
  });
  return {
    restored: removed.count > 0 || updated.count > 0,
    removedFromUnsubscribeList: removed.count,
    contactRowsUpdated: updated.count,
  };
}

export async function recordEvent(event) {
  // Pull Brevo's per-event uuid (or whatever the provider calls it) into a
  // dedicated indexed column so the catch-up sync can dedupe atomically with
  // an upsert. Falls back to a synthetic id derived from the payload so we
  // still have a stable handle when uuid is missing.
  const externalId = pickExternalId(event.payload);
  if (externalId) {
    return prisma.event.upsert({
      where: { externalId },
      create: {
        externalId,
        provider: event.provider || 'unknown',
        payload: event.payload || {},
        // Honor an explicit timestamp on the payload (sync uses event.date),
        // otherwise default to now via Prisma.
        ...(event.receivedAt ? { receivedAt: event.receivedAt } : {}),
      },
      // No-op update. We just need the upsert to dedupe; the existing row's
      // payload is already canonical.
      update: {},
    });
  }
  return prisma.event.create({
    data: {
      provider: event.provider || 'unknown',
      payload: event.payload || {},
      ...(event.receivedAt ? { receivedAt: event.receivedAt } : {}),
    },
  });
}

function pickExternalId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  // Webhook payload uses `uuid`; API responses sometimes use `messageId` +
  // event + ts as the natural key. Prefer uuid; otherwise build a composite.
  if (payload.uuid) return String(payload.uuid);
  const messageId = payload['message-id'] || payload.messageId;
  if (messageId && payload.event && payload.ts) {
    return `${messageId}:${payload.event}:${payload.ts}`;
  }
  return null;
}

export async function getLatestEventDate() {
  const row = await prisma.event.findFirst({
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true },
  });
  return row?.receivedAt || null;
}

export async function getSendRecord(campaignId, email) {
  return prisma.campaignSend.findUnique({
    where: { campaignId_email: { campaignId, email } },
  });
}

export async function markSendAttempt(campaignId, email) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'sending',
      attempts: 1,
    },
    update: {
      status: 'sending',
      attempts: { increment: 1 },
    },
  });
}

export async function markSendSucceeded(campaignId, email, brevoMessageId = null) {
  return prisma.campaignSend.update({
    where: { campaignId_email: { campaignId, email } },
    data: {
      status: 'sent',
      brevoMessageId,
      errorMessage: null,
      sentAt: new Date(),
    },
  });
}

export async function markSendFailed(campaignId, email, message) {
  return prisma.campaignSend.update({
    where: { campaignId_email: { campaignId, email } },
    data: {
      status: 'failed',
      errorMessage: message?.slice(0, 500) || 'unknown error',
    },
  });
}

export async function markSendSkipped(campaignId, email, message) {
  return prisma.campaignSend.upsert({
    where: { campaignId_email: { campaignId, email } },
    create: {
      campaignId,
      email,
      status: 'skipped',
      errorMessage: message?.slice(0, 500) || null,
    },
    update: {
      status: 'skipped',
      errorMessage: message?.slice(0, 500) || null,
    },
  });
}

export async function listCampaignSends(campaignId) {
  return prisma.campaignSend.findMany({
    where: { campaignId },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listAssets(kind) {
  return prisma.asset.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAsset(asset) {
  return prisma.asset.create({ data: asset });
}

export async function getAsset(id) {
  return prisma.asset.findUnique({ where: { id } });
}

export async function deleteAsset(id) {
  return prisma.asset.delete({ where: { id } });
}

export async function pruneEventsToLatest(limit = 500) {
  const cutoff = await prisma.event.findMany({
    orderBy: { receivedAt: 'desc' },
    skip: limit,
    take: 1,
    select: { receivedAt: true },
  });
  if (cutoff[0]) {
    await prisma.event.deleteMany({ where: { receivedAt: { lt: cutoff[0].receivedAt } } });
  }
}

// ---- Drip sequences ------------------------------------------------------

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
  const rows = await prisma.sequence.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.map(sequenceFromDb);
}

export async function getSequence(id) {
  const row = await prisma.sequence.findUnique({ where: { id } });
  return row ? sequenceFromDb(row) : null;
}

export async function upsertSequence(seq) {
  const data = {
    name: seq.name,
    status: seq.status || "active",
    triggerType: seq.triggerType || "group_added",
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

// Enrolls one contact in one sequence. Idempotent: if already enrolled, this
// is a no-op (the @@unique constraint prevents duplicates). Sets nextRunAt
// based on step 0 delayDays.
export async function enrollInSequence(sequenceId, email) {
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq || seq.status !== "active") return null;
  const steps = Array.isArray(seq.steps) ? seq.steps : [];
  if (!steps.length) return null;
  const firstDelayMs = (Number(steps[0].delayDays) || 0) * 24 * 60 * 60 * 1000;
  const nextRunAt = new Date(Date.now() + firstDelayMs);
  try {
    return await prisma.sequenceEnrollment.create({
      data: { sequenceId, email, nextStepIndex: 0, nextRunAt, status: "active" },
    });
  } catch (error) {
    // P2002 = unique violation (already enrolled). Treat as a no-op.
    if (error?.code === "P2002") return null;
    throw error;
  }
}

export async function listDueEnrollments(now = new Date()) {
  return prisma.sequenceEnrollment.findMany({
    where: { status: "active", nextRunAt: { lte: now } },
    take: 100, // batch cap per runner tick
  });
}

export async function advanceEnrollment(id, { nextStepIndex, nextRunAt, status, lastError }) {
  return prisma.sequenceEnrollment.update({
    where: { id },
    data: { nextStepIndex, nextRunAt, status, lastError: lastError ?? null },
  });
}

export async function listEnrollmentsForSequence(sequenceId) {
  return prisma.sequenceEnrollment.findMany({
    where: { sequenceId },
    orderBy: { enrolledAt: "desc" },
    take: 500,
  });
}

