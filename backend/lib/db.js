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
    updatedAt: audience.updatedAt?.toISOString?.() || audience.updatedAt,
  };
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

export function buildContactWhere(filter = {}) {
  const where = {};
  const search = filter.search?.trim();
  const region = filter.region?.trim();
  const consent = filter.consent?.trim();

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { firstname: { contains: search, mode: 'insensitive' } },
      { lastname: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (region) where.region = region;
  if (consent) where.consent = consent;
  if (filter.excludeUnsubscribed) {
    where.email = { notIn: filter._unsubscribedEmails || [] };
  }

  return where;
}

export async function queryContacts({ filter = {}, page = 1, pageSize = 50, sort = 'savedAt' } = {}) {
  const where = buildContactWhere(filter);
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

export async function listEvents() {
  const rows = await prisma.event.findMany({ orderBy: { receivedAt: 'desc' }, take: 500 });
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
