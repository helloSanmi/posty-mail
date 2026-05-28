// Catch-up sync for Brevo transactional events.
//
// Webhooks are fire-and-forget HTTP POSTs. If the backend is down when Brevo
// fires one, the event is dropped after a few retries. This module fills that
// gap on startup by asking Brevo's API for events since the last one we have
// stored, and upserting them into the local Event table (deduped by Brevo's
// per-event `uuid`).
//
// Brevo retains transactional events for ~30 days. Anything older than that
// when we boot is permanently lost on Brevo's side too. No recovery possible.
//
// Multi-tenant scope: each event carries a campaign:<id> tag (set by the
// scheduler when sending). We look up Campaign.accountId from that id and
// pass it to recordEvent so the row gets stamped with the right workspace.
// Events without a campaign tag (rare provider noise) fall back to 'default'.

import { fetchTransactionalEvents } from './brevoClient.js';
import { getLatestEventDate, prisma, recordEvent } from './db.js';
import { isPostyEvent } from './eventScope.js';

// Resolve the workspace for a single Brevo event by reading its
// campaign:<id> tag and looking up Campaign.accountId. Cached per
// campaignId across one sync run so a campaign with 5000 events
// doesn't hit the DB 5000 times.
function resolveAccountId(payload, cache) {
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const tag = tags.find((t) => typeof t === 'string' && t.startsWith('campaign:'));
  if (!tag) return Promise.resolve('default');
  const campaignId = tag.slice('campaign:'.length);
  if (cache.has(campaignId)) return Promise.resolve(cache.get(campaignId));
  const promise = prisma.campaign
    .findUnique({ where: { id: campaignId }, select: { accountId: true } })
    .then((row) => row?.accountId || 'default')
    .catch(() => 'default');
  cache.set(campaignId, promise);
  return promise;
}

// Reach back this far before the latest stored event to catch any events we
// might have missed in a small overlap window (clock skew, late-arriving
// webhooks). Cheap because dedup makes it idempotent.
const OVERLAP_HOURS = 1;

export async function syncBrevoEvents({ logger = console } = {}) {
  if (!process.env.BREVO_API_KEY) {
    logger.log('[sync] Skipping Brevo event sync. BREVO_API_KEY not set.');
    return { skipped: true, reason: 'no_api_key' };
  }

  const latest = await getLatestEventDate();
  // First-ever sync: pull a generous window so a fresh install gets recent
  // history. After that, only fetch from a bit before the latest known event.
  const startCursor = latest
    ? new Date(latest.getTime() - OVERLAP_HOURS * 60 * 60 * 1000)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startDate = startCursor.toISOString().slice(0, 10); // Brevo expects YYYY-MM-DD

  let events;
  try {
    events = await fetchTransactionalEvents({ startDate });
  } catch (error) {
    logger.warn(`[sync] Could not reach Brevo events API: ${error.message}`);
    return { skipped: false, error: error.message };
  }

  if (!events.length) {
    logger.log('[sync] No new Brevo events since last run.');
    return { fetched: 0, inserted: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  let foreign = 0;
  // Per-campaign accountId lookups are deduped across the run so a
  // batch of 5000 events from the same campaign hits the DB once.
  const accountIdCache = new Map();
  for (const apiEvent of events) {
    const payload = normaliseApiEvent(apiEvent);
    if (!payload) { skipped += 1; continue; }
    // Drop events for emails not sent by Posty. Brevo's API returns the entire
    // account's history including other systems on the same key.
    if (!isPostyEvent(payload)) { foreign += 1; continue; }
    try {
      const accountId = await resolveAccountId(payload, accountIdCache);
      await recordEvent(accountId, {
        provider: 'brevo',
        payload,
        receivedAt: payload.date ? new Date(payload.date) : undefined,
      });
      inserted += 1;
    } catch (error) {
      // Most likely a duplicate that raced with a concurrent webhook write.
      // safe to ignore.
      skipped += 1;
      logger.warn(`[sync] Skipped one event: ${error.message}`);
    }
  }

  logger.log(
    `[sync] Brevo events: fetched ${events.length}, inserted ${inserted}, ` +
    `skipped/dup ${skipped}, foreign-dropped ${foreign}.`,
  );
  return { fetched: events.length, inserted, skipped, foreign };
}

// Brevo's API response uses slightly different field names than the webhook
// payload (e.g. `messageId` instead of `message-id`). Normalize so the rest
// of the app. Metrics, dashboards, drill-downs. Sees one consistent shape.
function normaliseApiEvent(apiEvent) {
  if (!apiEvent || !apiEvent.event) return null;
  // Brevo's API returns `tag` in two shapes depending on call: sometimes a
  // JSON-encoded array string (`'["a","b"]'`), sometimes a plain
  // comma-separated string (`'a,b'`). Webhooks deliver a proper array.
  // Normalize all three so downstream code sees a real `tags: string[]`.
  const tagsRaw = apiEvent.tag;
  let tags = [];
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw;
  } else if (typeof tagsRaw === 'string') {
    try {
      const parsed = JSON.parse(tagsRaw);
      tags = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Plain comma-separated fallback. Most common shape from /smtp/statistics/events.
      tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  return {
    // Synthetic uuid since the API endpoint doesn't always include the
    // webhook's `uuid` field. Composite of messageId + event + date keeps
    // it stable across retries / re-runs.
    uuid: apiEvent.uuid || `${apiEvent.messageId || 'no-msg'}:${apiEvent.event}:${apiEvent.date || ''}`,
    event: apiEvent.event,
    email: apiEvent.email || null,
    subject: apiEvent.subject || null,
    date: apiEvent.date || null,
    'message-id': apiEvent.messageId || null,
    link: apiEvent.link || null,
    user_agent: apiEvent.userAgent || null,
    sending_ip: apiEvent.ip || null,
    tag: tagsRaw,
    tags,
    _source: 'sync',
  };
}
