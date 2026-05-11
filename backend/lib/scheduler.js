import cron from 'node-cron';
import { chunkContacts, complianceIssues, renderTemplate } from '../../shared/campaignUtils.js';
import { sendTransactionalEmail } from './brevoClient.js';
import {
  getSendRecord,
  markSendAttempt,
  markSendFailed,
  markSendSkipped,
  markSendSucceeded,
  unsubscribedEmailSet,
} from './db.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jobs = new Map();

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

export async function runCampaign(campaign, onUpdate) {
  campaign.status = 'running';
  campaign.startedAt = new Date().toISOString();
  campaign.progress = { sent: 0, failed: 0, skipped: 0, currentBatch: 0, totalBatches: campaign.batches.length };
  await onUpdate?.(campaign);

  const unsubscribed = await unsubscribedEmailSet();
  const hasVariants = Array.isArray(campaign.variants) && campaign.variants.length > 0;

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
        await markSendSkipped(campaign.id, contact.email, 'Recipient previously unsubscribed');
        campaign.logs.push({
          level: 'warn',
          email: contact.email,
          message: 'Skipped: unsubscribed',
          at: new Date().toISOString(),
        });
        continue;
      }

      const issues = complianceIssues(contact, campaign.compliance);
      if (issues.length) {
        campaign.progress.skipped += 1;
        await markSendSkipped(campaign.id, contact.email, issues.join(', '));
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
        await markSendAttempt(campaign.id, contact.email);
        const response = await withRetry(() =>
          sendTransactionalEmail({
            contact,
            sender: campaign.sender,
            subject: renderTemplate(template.subject, enriched),
            htmlContent: renderTemplate(template.html, enriched),
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
  campaign.status = campaign.schedule?.frequency && campaign.schedule.frequency !== 'once'
    ? 'scheduled'
    : campaign.progress.failed > 0 ? 'completed_with_errors' : 'completed';
  campaign.completedAt = new Date().toISOString();
  await onUpdate?.(campaign);
}

function mergeVariant(baseTemplate, variant) {
  return {
    ...baseTemplate,
    subject: variant.subject ?? baseTemplate.subject,
    html: variant.html ?? baseTemplate.html,
    text: variant.text ?? baseTemplate.text,
  };
}

function cronForCampaign(campaign) {
  const scheduledAt = new Date(campaign.scheduledAt);
  const minute = scheduledAt.getMinutes();
  const hour = scheduledAt.getHours();
  const day = scheduledAt.getDate();
  const weekday = scheduledAt.getDay();
  const frequency = campaign.schedule?.frequency || 'once';

  if (frequency === 'daily') return `${minute} ${hour} * * *`;
  if (frequency === 'weekly') return `${minute} ${hour} * * ${weekday}`;
  if (frequency === 'monthly') return `${minute} ${hour} ${day} * *`;
  return `${minute} ${hour} ${day} ${scheduledAt.getMonth() + 1} *`;
}

export function scheduleCampaignJob(campaign, onUpdate) {
  if (jobs.has(campaign.id)) {
    jobs.get(campaign.id).stop();
    jobs.delete(campaign.id);
  }

  const scheduledAt = new Date(campaign.scheduledAt);
  const now = new Date();
  const frequency = campaign.schedule?.frequency || 'once';

  if (frequency === 'once' && scheduledAt <= now) {
    setTimeout(() => runCampaign(campaign, onUpdate), 0);
    return null;
  }

  const job = cron.schedule(cronForCampaign(campaign), async () => {
    await runCampaign(campaign, onUpdate);
    if (frequency === 'once') {
      job.stop();
      jobs.delete(campaign.id);
    }
  }, { scheduled: true });
  jobs.set(campaign.id, job);
  return job;
}

export function createCampaignPayload(body) {
  const batchSize = Math.min(Math.max(Number(body.batchSize) || 300, 1), 1000);
  const delayMinutes = Math.min(Math.max(Number(body.delayMinutes) || 1, 0), 60);
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const variants = Array.isArray(body.variants) && body.variants.length
    ? body.variants.map((variant, index) => ({
      id: variant.id || `v${index + 1}`,
      label: variant.label || `Variant ${index + 1}`,
      subject: variant.subject ?? null,
      html: variant.html ?? null,
      text: variant.text ?? null,
      weight: Number(variant.weight) || 1,
    }))
    : null;

  return {
    id: crypto.randomUUID(),
    name: body.name || 'Untitled campaign',
    createdAt: new Date().toISOString(),
    scheduledAt: body.scheduledAt || new Date().toISOString(),
    schedule: {
      frequency: body.schedule?.frequency || body.frequency || 'once',
      timezone: body.schedule?.timezone || body.timezone || 'local',
    },
    batchSize,
    delayMinutes,
    contacts,
    batches: chunkContacts(contacts, batchSize),
    template: body.template,
    variants,
    compliance: body.compliance || { requireOptIn: true, gdprMode: true },
    // Sender is resolved by the caller (see /api/campaigns/schedule and
    // /api/campaigns/test-email) so we don't have to make this whole helper
    // async. Falls back to env vars when the caller hasn't supplied one. Keeps
    // legacy code paths and tests working without a DB read.
    sender: body.sender || {
      email: process.env.BREVO_SENDER_EMAIL || 'campaigns@example.com',
      name: process.env.BREVO_SENDER_NAME || 'Campaign Team',
    },
    // Default the unsubscribe link to the self-hosted page on PUBLIC_BASE_URL.
    // Falls back to the example.com placeholder only if neither is set, which
    // means the link will be visibly broken. That's intentional, so the dev
    // notices and configures PUBLIC_BASE_URL before sending real campaigns.
    unsubscribeBaseUrl: body.unsubscribeBaseUrl
      || (process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/unsubscribe` : 'https://example.com/unsubscribe'),
    status: 'scheduled',
    logs: [],
    progress: { sent: 0, failed: 0, skipped: 0, currentBatch: 0, totalBatches: 0 },
  };
}
