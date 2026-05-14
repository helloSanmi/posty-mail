// Event persistence. Stores webhook events from the email provider so the
// Reports page + Notification feed have a per-recipient activity trail.
//
// `recordEvent` is idempotent via an externalId derived from the payload —
// either Brevo's uuid (preferred) or a composite of messageId + event +
// timestamp. Catch-up syncs re-fire the same events; the upsert dedupes.
import { prisma } from './prisma.js';

export function eventFromDb(event) {
  return {
    id: event.id,
    provider: event.provider,
    payload: event.payload,
    receivedAt: event.receivedAt?.toISOString?.() || event.receivedAt,
  };
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
  // Match by tag in JSON payload. The send loop tags each outbound email
  // with `campaign:<id>` so the webhook can attribute events later.
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

export async function recordEvent(event) {
  // Pull the provider's per-event uuid into a dedicated indexed column so
  // catch-up sync can dedupe atomically with an upsert. Falls back to a
  // synthetic id derived from the payload so we still have a stable
  // handle when uuid is missing.
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
      // No-op update. We just need the upsert to dedupe; the existing
      // row's payload is already canonical.
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

export async function pruneEventsToLatest(limit = 500) {
  const cutoff = await prisma.event.findMany({
    orderBy: { receivedAt: 'desc' },
    skip: limit,
    take: 1,
    select: { receivedAt: true },
  });
  if (cutoff[0]) {
    await prisma.event.deleteMany({
      where: { receivedAt: { lt: cutoff[0].receivedAt } },
    });
  }
}
