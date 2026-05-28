// The per-send execution loop. Iterates batches, enforces unsubscribes /
// timezone gates / category preferences / compliance issues, picks a
// deterministic A/B variant per recipient, and writes a CampaignSend ledger
// row for every contact. Helpers (variant picking, category prefs, retry)
// are kept private to this file because nothing else needs them.
//
// Multi-tenant scope: the campaign object carries its own accountId
// (created from req.user.accountId by /api/campaigns/schedule). Every
// helper call below threads it through so unsubscribes / category prefs /
// CampaignSend rows / persisted campaign state stay isolated per workspace.
import {
  complianceIssues,
  renderTemplate,
  withPreheader,
} from '../../../shared/campaignUtils.js';
import { sendTransactionalEmail } from '../brevoClient.js';
import { resolveSender } from '../sender.js';
import { isReady, nowInZone, parseLocalTarget } from '../sendTime.js';
import {
  getSendRecord,
  markSendAttempt,
  markSendFailed,
  markSendSkipped,
  markSendSucceeded,
  prisma,
  unsubscribedEmailSet,
} from '../db.js';

// How long to wait between per-timezone re-checks. 15 minutes is a sweet
// spot: short enough that recipients don't get the email significantly late,
// long enough that we don't hammer the DB for a slow-moving campaign.
const TIMEZONE_RECHECK_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read per-contact subscribedCategories preferences for the recipients of a
// run. Returns a Map<email, Set<categoryId>>. Contacts without an entry mean
// "preferences never set" — backward compat with legacy contacts means we
// treat that as "subscribed to all categories" so they keep receiving.
async function loadCategoryPreferences(accountId, emails) {
  if (!emails.length) return new Map();
  // Scope by accountId so a campaign in workspace A can't read prefs
  // off a same-email contact in workspace B (only relevant after the
  // composite-PK migration; today's globally-unique email PK makes the
  // collision impossible, but the filter is safe defense-in-depth).
  const rows = await prisma.contact.findMany({
    where: { email: { in: emails }, accountId },
    select: { email: true, data: true },
  });
  const map = new Map();
  for (const row of rows) {
    const list = row.data?.subscribedCategories;
    if (Array.isArray(list)) map.set(row.email, new Set(list));
  }
  return map;
}

async function withRetry(task, maxAttempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (![408, 429, 500, 502, 503, 504].includes(error.status) || attempt === maxAttempts) break;
      await sleep(2 ** attempt * 1000);
    }
  }

  throw lastError;
}

// Deterministically pick a variant for a given email so retries always use the same one.
function pickVariant(variants, email) {
  if (!variants?.length) return null;
  const totalWeight = variants.reduce((sum, v) => sum + (Number(v.weight) || 1), 0);
  const hash = simpleHash(email);
  const target = hash % totalWeight;
  let acc = 0;
  for (const variant of variants) {
    acc += Number(variant.weight) || 1;
    if (target < acc) return variant;
  }
  return variants[variants.length - 1];
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function mergeVariant(baseTemplate, variant) {
  return {
    ...baseTemplate,
    subject: variant.subject ?? baseTemplate.subject,
    html: variant.html ?? baseTemplate.html,
    text: variant.text ?? baseTemplate.text,
  };
}

export async function runCampaign(campaign, onUpdate) {
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();
  campaign.progress = {
    sent: 0,
    failed: 0,
    skipped: 0,
    currentBatch: 0,
    totalBatches: campaign.batches.length,
  };
  await onUpdate?.(campaign);

  // Resolve sender at FIRE time, not at schedule time. If the admin updated
  // the Sender in Settings between scheduling and now, the new value wins.
  // If nothing is configured, we fail the whole campaign here instead of
  // mailing under a dummy address. That's the whole point of refusing to
  // ship a placeholder.
  let liveSender = null;
  try {
    liveSender = await resolveSender();
  } catch {
    // resolveSender already swallows DB errors. Falls through to the null guard.
  }
  if (!liveSender) {
    campaign.status = 'completed_with_errors';
    campaign.completedAt = new Date().toISOString();
    campaign.logs.push({
      level: 'error',
      message: 'Sender not configured. Set From name + email in Settings, then reschedule.',
      at: new Date().toISOString(),
    });
    await onUpdate?.(campaign);
    return;
  }

  // Pull accountId once at the top — every per-tenant helper below
  // reads from it. Falls back to 'default' for legacy campaigns
  // scheduled before multi-tenancy landed (their persisted payload
  // doesn't carry accountId).
  const accountId = campaign.accountId || 'default';

  const unsubscribed = await unsubscribedEmailSet(accountId);
  const hasVariants = Array.isArray(campaign.variants) && campaign.variants.length > 0;
  // Per-template category gating. If the campaign's template carries a
  // category id, recipients whose preference list excludes that category get
  // skipped at send time. Contacts with no preference list are treated as
  // subscribed-to-all (legacy behavior).
  const templateCategory = String(campaign.template?.category || '').trim() || null;
  const categoryPrefs = templateCategory
    ? await loadCategoryPreferences(accountId, campaign.contacts.map((c) => c.email))
    : null;

  // Send-time-per-timezone. When set, the campaign's scheduledAt is treated
  // as a wall-clock LOCAL time (the digits as-typed, not a UTC instant). For
  // each contact we compare their current local clock against that target;
  // contacts whose clock hasn't reached it get deferred and re-checked on a
  // 15-minute timer until done. Contacts with no stored timezone fall back
  // to UTC (which often makes them go first since UTC is "ahead" of most
  // Americas zones).
  const useRecipientTz = Boolean(campaign.useRecipientTimezone);
  const localTarget = useRecipientTz ? parseLocalTarget(campaign.scheduledAt) : null;
  let anyDeferred = false;

  for (let index = 0; index < campaign.batches.length; index += 1) {
    const batch = campaign.batches[index];
    campaign.progress.currentBatch = index + 1;

    for (const contact of batch) {
      const prior = await getSendRecord(campaign.id, contact.email);
      if (prior?.status === 'sent') {
        campaign.progress.sent += 1;
        continue;
      }

      if (unsubscribed.has(contact.email)) {
        campaign.progress.skipped += 1;
        await markSendSkipped(accountId, campaign.id, contact.email, 'Recipient previously unsubscribed');
        campaign.logs.push({
          level: 'warn',
          email: contact.email,
          message: 'Skipped: unsubscribed',
          at: new Date().toISOString(),
        });
        continue;
      }

      // Per-timezone gate. Holds back the send until the contact's local
      // clock reaches the target. Status is 'pending' (not 'skipped') so
      // the next run picks them up; we DO NOT write a markSendSkipped row
      // because that would permanently exclude them.
      if (useRecipientTz && localTarget) {
        const zone = contact.timezone || 'UTC';
        if (isReady(nowInZone(zone), localTarget) === 'later') {
          anyDeferred = true;
          continue; // don't increment progress.skipped; revisit next cycle
        }
      }

      // Category-preference gate. Only fires when the campaign's template
      // has a category set AND the contact has explicit preferences that
      // exclude it. Missing preferences = subscribed to all = no skip.
      if (templateCategory && categoryPrefs) {
        const prefs = categoryPrefs.get(contact.email);
        if (prefs && !prefs.has(templateCategory)) {
          campaign.progress.skipped += 1;
          const reason = `Skipped: opted out of "${templateCategory}"`;
          await markSendSkipped(accountId, campaign.id, contact.email, reason);
          campaign.logs.push({
            level: 'warn', email: contact.email, message: reason, at: new Date().toISOString(),
          });
          continue;
        }
      }

      const issues = complianceIssues(contact, campaign.compliance);
      if (issues.length) {
        campaign.progress.skipped += 1;
        await markSendSkipped(accountId, campaign.id, contact.email, issues.join(', '));
        campaign.logs.push({
          level: 'warn',
          email: contact.email,
          message: issues.join(', '),
          at: new Date().toISOString(),
        });
        continue;
      }

      const variant = hasVariants
        ? pickVariant(campaign.variants, contact.email)
        : null;
      const template = variant
        ? mergeVariant(campaign.template, variant)
        : campaign.template;

      const unsubscribeUrl = [
        campaign.unsubscribeBaseUrl,
        `?email=${encodeURIComponent(contact.email)}`,
        `&campaign=${campaign.id}`,
      ].join('');
      const enriched = { ...contact, unsubscribeUrl, logoUrl: template.logoUrl || '' };

      try {
        await markSendAttempt(accountId, campaign.id, contact.email);
        // Inject the preview text (preheader) as a hidden block at the
        // start of the rendered HTML. Inbox previews (Gmail/Outlook/Apple)
        // read it; the message body looks unchanged. Personalization tags
        // inside the preview text get rendered too, so {{firstname}} works.
        const renderedPreview = renderTemplate(template.previewText || '', enriched);
        const renderedHtml = withPreheader(
          renderTemplate(template.html, enriched),
          renderedPreview,
        );
        const response = await withRetry(() =>
          sendTransactionalEmail({
            contact,
            sender: liveSender,
            // replyTo is a Brevo "advanced setting" — when set, recipients'
            // replies route here instead of the From address. Validated and
            // dropped silently inside the provider if malformed.
            replyTo: template.replyTo || null,
            subject: renderTemplate(template.subject, enriched),
            htmlContent: renderedHtml,
            textContent: renderTemplate(template.text, enriched),
            idempotencyKey: `${campaign.id}:${contact.email}`,
            campaignId: campaign.id,
            variantId: variant?.id,
          }),
        );
        await markSendSucceeded(campaign.id, contact.email, response?.messageId || null);
        campaign.progress.sent += 1;
      } catch (error) {
        await markSendFailed(campaign.id, contact.email, error.message);
        campaign.progress.failed += 1;
        campaign.logs.push({
          level: 'error',
          email: contact.email,
          message: error.message,
          at: new Date().toISOString(),
        });
      }
    }

    if (index < campaign.batches.length - 1) {
      await sleep(campaign.delayMinutes * 60 * 1000);
    }
  }

  campaign.lastRunAt = new Date().toISOString();

  // Per-timezone re-check. If we deferred any contacts this pass, the
  // campaign isn't truly done. Stay in 'running' status and re-arm a timer
  // 15 minutes out so the next batch of timezones gets their turn.
  if (anyDeferred && useRecipientTz) {
    campaign.status = 'running';
    await onUpdate?.(campaign);
    setTimeout(() => {
      runCampaign(campaign, onUpdate).catch((error) => {
        console.error('[scheduler] per-tz re-check failed:', error.message);
      });
    }, TIMEZONE_RECHECK_MS);
    return;
  }

  campaign.status = campaign.schedule?.frequency && campaign.schedule.frequency !== 'once'
    ? 'scheduled'
    : campaign.progress.failed > 0 ? 'completed_with_errors' : 'completed';
  campaign.completedAt = new Date().toISOString();
  await onUpdate?.(campaign);
}
