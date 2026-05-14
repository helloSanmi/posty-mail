import { fetchVerifiedSenders, sendTestEmail } from '../lib/brevoClient.js';
import {
  getCampaign,
  listCampaigns,
  listCampaignsPaged,
  listCampaignSends,
  listDrafts,
  listEventsForCampaign,
  listScheduledOrRunningCampaigns,
  prisma,
  upsertCampaign,
  upsertDraft,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { checkDeliverability } from '../lib/deliverability.js';
import { runSendChecks } from '../lib/preflight.js';
import { sanitizeEmailHtml, sanitizeSubject } from '../lib/sanitize.js';
import { createCampaignPayload, scheduleCampaignJob } from '../lib/scheduler.js';
import { findUnreachableImageUrls } from '../lib/urlReachability.js';
import { readSenderSetting, requireSender, resolveSender, writeSenderSetting } from '../lib/sender.js';

// Brevo's webhook event names come in variants. Use these to classify them
// once, in one place, so metrics counts don't silently drop opens/clicks just
// because Brevo named them `unique_opened` / `proxy_open` / `unique_clicked`.
const OPEN_EVENTS = new Set(['opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy']);
const CLICK_EVENTS = new Set(['click', 'clicked', 'unique_clicked']);
const BOUNCE_EVENTS_METRICS = new Set(['hard_bounce', 'soft_bounce', 'blocked', 'invalid_email']);
const isOpen = (e) => OPEN_EVENTS.has(e);
const isClick = (e) => CLICK_EVENTS.has(e);
const isBounce = (e) => BOUNCE_EVENTS_METRICS.has(e);
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  logoUrl: z.string().optional(),
}).passthrough();

const contactSchema = z.object({
  email: z.string().email(),
}).passthrough();

const variantSchema = z.object({
  id: z.string().optional(),
  label: z.string().max(80).optional(),
  subject: z.string().min(1).max(998).optional(),
  html: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  weight: z.number().min(1).max(100).optional(),
});

const scheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contacts: z.array(contactSchema).min(1, 'At least one contact is required'),
  template: templateSchema,
  variants: z.array(variantSchema).max(4).optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  delayMinutes: z.number().min(0).max(60).optional(),
  // Accepts BOTH full ISO instants ("...Z" / offset) and local-naive datetime
  // strings ("2026-05-13T09:00"). The latter is used for send-time-per-
  // timezone mode where the digits are the per-recipient wall-clock target.
  scheduledAt: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/, 'Invalid datetime')
    .optional(),
  schedule: z.object({
    frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    timezone: z.string().optional(),
  }).optional(),
  compliance: z.object({
    requireOptIn: z.boolean().optional(),
    gdprMode: z.boolean().optional(),
  }).optional(),
  unsubscribeBaseUrl: z.string().url().optional(),
  useRecipientTimezone: z.boolean().optional(),
});

const draftSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(200).optional(),
}).passthrough();

const testEmailSchema = z.object({
  toEmail: z.string().email(),
  template: templateSchema,
  contact: z.record(z.unknown()).optional(),
});

export function registerCampaignRoutes(app) {
  app.post(
    '/api/campaigns/schedule',
    validate(scheduleSchema),
    asyncRoute(async (req, res) => {
      const safeBody = {
        ...req.body,
        template: {
          ...req.body.template,
          subject: sanitizeSubject(req.body.template.subject),
          html: sanitizeEmailHtml(req.body.template.html),
        },
        variants: req.body.variants?.map((variant) => ({
          ...variant,
          subject: variant.subject != null ? sanitizeSubject(variant.subject) : null,
          html: variant.html != null ? sanitizeEmailHtml(variant.html) : null,
        })),
      };
      // Sender must be configured before scheduling. We resolve it here for
      // the audit snapshot, but runCampaign re-resolves at fire time so a
      // Settings change between schedule and run takes effect. If nothing is
      // configured we 400 with a clear message instead of letting a placeholder
      // through.
      safeBody.sender = await requireSender();
      const campaign = createCampaignPayload(safeBody);
      await upsertCampaign(campaign);
      scheduleCampaignJob(campaign, upsertCampaign);
      await recordAudit(req, 'campaign.schedule', 'campaign', campaign.id, {
        name: campaign.name,
        contactCount: campaign.contacts.length,
        scheduledAt: campaign.scheduledAt,
      });
      res.status(201).json(serializeCampaign(campaign));
    }),
  );

  app.get('/api/campaigns', asyncRoute(async (req, res) => {
    // Backward-compat: with no pagination params, return the flat array (used
    // by the dashboard, which only needs counts/totals). With page/pageSize,
    // return the paged shape `{ rows, total, page, pageSize, totalPages }`.
    if (req.query.page || req.query.pageSize) {
      const result = await listCampaignsPaged({
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      res.json({ ...result, rows: result.rows.map(serializeCampaign) });
      return;
    }
    const campaigns = await listCampaigns();
    res.json(campaigns.map(serializeCampaign));
  }));

  app.get('/api/campaigns/:id/sends', asyncRoute(async (req, res) => {
    const sends = await listCampaignSends(req.params.id);
    res.json(sends.map((row) => ({
      campaignId: row.campaignId,
      email: row.email,
      status: row.status,
      attempts: row.attempts,
      brevoMessageId: row.brevoMessageId,
      errorMessage: row.errorMessage,
      sentAt: row.sentAt?.toISOString() || null,
      updatedAt: row.updatedAt.toISOString(),
    })));
  }));

  app.get('/api/campaigns/:id/recipients', asyncRoute(async (req, res) => {
    const [sends, events] = await Promise.all([
      listCampaignSends(req.params.id),
      listEventsForCampaign(req.params.id, 5000),
    ]);

    const summaryByEmail = new Map();
    sends.forEach((row) => {
      summaryByEmail.set(row.email, {
        email: row.email,
        status: row.status,
        sentAt: row.sentAt?.toISOString() || null,
        variantId: null,
        opens: 0,
        clicks: 0,
        bounces: 0,
        unsubscribed: false,
        lastEventAt: null,
      });
    });

    events.forEach((event) => {
      const payload = event.payload || {};
      const email = String(payload.email || '').toLowerCase();
      if (!email) return;
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      const variantTag = tags.find((tag) => typeof tag === 'string' && tag.startsWith('variant:'));
      const variantId = variantTag?.replace(/^variant:/, '') || null;
      const eventName = String(payload.event || '').toLowerCase();
      const summary = summaryByEmail.get(email) || {
        email,
        status: 'unknown',
        sentAt: null,
        variantId: null,
        opens: 0,
        clicks: 0,
        bounces: 0,
        unsubscribed: false,
        lastEventAt: null,
      };
      if (variantId && !summary.variantId) summary.variantId = variantId;
      if (isOpen(eventName)) summary.opens += 1;
      if (isClick(eventName)) summary.clicks += 1;
      if (isBounce(eventName)) summary.bounces += 1;
      if (eventName === 'unsubscribed') summary.unsubscribed = true;
      const at = event.receivedAt;
      if (!summary.lastEventAt || (at && at > summary.lastEventAt)) {
        summary.lastEventAt = at;
      }
      summaryByEmail.set(email, summary);
    });

    res.json(Array.from(summaryByEmail.values())
      .sort((a, b) => (b.lastEventAt || '').localeCompare(a.lastEventAt || '')));
  }));

  app.get('/api/campaigns/:id/links', asyncRoute(async (req, res) => {
    const events = await listEventsForCampaign(req.params.id, 5000);
    const counts = new Map();
    let totalClicks = 0;

    events.forEach((event) => {
      const payload = event.payload || {};
      const eventName = String(payload.event || '').toLowerCase();
      if (eventName !== 'click' && eventName !== 'clicked') return;
      const url = payload.link || payload.url;
      if (!url) return;
      counts.set(url, (counts.get(url) || 0) + 1);
      totalClicks += 1;
    });

    res.json({
      totalClicks,
      links: Array.from(counts.entries())
        .map(([url, clicks]) => ({ url, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
    });
  }));

  app.get('/api/campaigns/:id/variants', asyncRoute(async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    if (!campaign.variants?.length) {
      res.json({ variants: [] });
      return;
    }

    const events = await listEventsForCampaign(req.params.id, 5000);
    const sends = await listCampaignSends(req.params.id);

    const stats = new Map(campaign.variants.map((variant) => [
      variant.id,
      {
        id: variant.id,
        label: variant.label,
        subject: variant.subject,
        weight: variant.weight,
        sent: 0,
        opens: 0,
        clicks: 0,
      },
    ]));

    sends.forEach((send) => {
      // Variant for a recipient is determined by the same hash function used at send time.
      // We can't know it without access to the variants array. But we already know which
      // variant was tagged in the events stream. Count sends per-recipient unconditionally
      // and rely on event tags for opens/clicks attribution.
      const fallback = stats.get('v1') || stats.values().next().value;
      if (fallback && send.status === 'sent') {
        // Approximate distribution based on weight ratios.
        // For an exact attribution use the recipients endpoint with variantId.
      }
      void fallback;
    });

    events.forEach((event) => {
      const payload = event.payload || {};
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      const variantTag = tags.find((tag) => typeof tag === 'string' && tag.startsWith('variant:'));
      if (!variantTag) return;
      const variantId = variantTag.replace(/^variant:/, '');
      const entry = stats.get(variantId);
      if (!entry) return;
      const eventName = String(payload.event || '').toLowerCase();
      if (eventName === 'request' || eventName === 'sent') entry.sent += 1;
      if (isOpen(eventName)) entry.opens += 1;
      if (isClick(eventName)) entry.clicks += 1;
    });

    res.json({ variants: Array.from(stats.values()) });
  }));

  app.get('/api/campaigns/:id/metrics', asyncRoute(async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const [sends, events] = await Promise.all([
      listCampaignSends(req.params.id),
      listEventsForCampaign(req.params.id, 5000),
    ]);

    const sent = sends.filter((row) => row.status === 'sent').length;
    const failed = sends.filter((row) => row.status === 'failed').length;
    const skipped = sends.filter((row) => row.status === 'skipped').length;

    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    let unsubscribes = 0;
    const openersByEmail = new Set();
    const clickersByEmail = new Set();

    events.forEach((event) => {
      const eventName = String(event.payload?.event || '').toLowerCase();
      const email = String(event.payload?.email || '').toLowerCase();
      if (isOpen(eventName)) {
        opens += 1;
        if (email) openersByEmail.add(email);
      }
      if (isClick(eventName)) {
        clicks += 1;
        if (email) clickersByEmail.add(email);
      }
      if (isBounce(eventName)) bounces += 1;
      if (eventName === 'unsubscribed') unsubscribes += 1;
    });

    res.json({
      campaignId: req.params.id,
      sent,
      delivered: sent,
      failed,
      skipped,
      opens,
      uniqueOpens: openersByEmail.size,
      clicks,
      uniqueClicks: clickersByEmail.size,
      bounces,
      unsubscribes,
      campaign: serializeCampaign(campaign),
    });
  }));

  app.get('/api/campaigns/drafts', asyncRoute(async (_req, res) => {
    res.json(await listDrafts());
  }));

  app.post(
    '/api/campaigns/drafts',
    validate(draftSchema),
    asyncRoute(async (req, res) => {
      const draft = {
        ...req.body,
        id: req.body.id || `draft-${crypto.randomUUID()}`,
      };
      await upsertDraft(draft);
      res.status(201).json({ ...draft, updatedAt: new Date().toISOString() });
    }),
  );

  app.patch(
    '/api/campaigns/:id',
    validate(z.object({
      name: z.string().min(1).max(200).optional(),
      scheduledAt: z.string().datetime().optional(),
      frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    })),
    asyncRoute(async (req, res) => {
      const campaign = await getCampaign(req.params.id);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      if (campaign.status === 'running') {
        res.status(409).json({ error: 'Cannot edit a campaign that is currently running.' });
        return;
      }
      if (campaign.status === 'completed' || campaign.status === 'completed_with_errors') {
        // Only allow renaming for completed campaigns
        if (req.body.scheduledAt || req.body.frequency) {
          res.status(409).json({ error: 'Completed campaigns can only be renamed.' });
          return;
        }
      }

      const updated = {
        ...campaign,
        name: req.body.name ?? campaign.name,
        scheduledAt: req.body.scheduledAt ?? campaign.scheduledAt,
        schedule: {
          ...(campaign.schedule || {}),
          frequency: req.body.frequency ?? campaign.schedule?.frequency ?? 'once',
        },
      };

      await upsertCampaign(updated);

      // If the campaign is still scheduled, refresh the cron job to reflect the new time/frequency.
      if (campaign.status === 'scheduled' || campaign.status === 'draft') {
        scheduleCampaignJob(updated, upsertCampaign);
      }

      await recordAudit(req, 'campaign.edit', 'campaign', updated.id, {
        changes: req.body,
      });
      res.json(serializeCampaign(updated));
    }),
  );

  app.delete('/api/campaigns/:id', asyncRoute(async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    await prisma.$transaction([
      prisma.campaignSend.deleteMany({ where: { campaignId: req.params.id } }),
      prisma.campaign.delete({ where: { id: req.params.id } }),
    ]);
    await recordAudit(req, 'campaign.delete', 'campaign', req.params.id, { name: campaign.name });
    res.json({ ok: true, id: req.params.id });
  }));

  app.post('/api/campaigns/:id/clone', asyncRoute(async (req, res) => {
    const original = await getCampaign(req.params.id);
    if (!original) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    const clone = {
      ...original,
      id: crypto.randomUUID(),
      name: `${original.name} (copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      lastRunAt: null,
      logs: [],
      progress: { sent: 0, failed: 0, skipped: 0, currentBatch: 0, totalBatches: 0 },
    };
    await upsertCampaign(clone);
    await recordAudit(req, 'campaign.clone', 'campaign', clone.id, { from: original.id });
    res.status(201).json(serializeCampaign(clone));
  }));

  app.delete('/api/campaigns/drafts/:id', asyncRoute(async (req, res) => {
    const result = await prisma.draft.deleteMany({ where: { id: req.params.id } });
    if (result.count) await recordAudit(req, 'draft.delete', 'draft', req.params.id);
    res.json({ deleted: result.count });
  }));

  app.post(
    '/api/campaigns/test-email',
    validate(testEmailSchema),
    asyncRoute(async (req, res) => {
      const { toEmail, template, contact = {} } = req.body;
      const previewContact = {
        firstname: 'Test',
        unsubscribeUrl: 'https://example.com/unsubscribe',
        ...contact,
        email: toEmail,
      };
      const renderedHtml = merge(template.html, previewContact);
      const result = await sendTestEmail({
        toEmail,
        sender: await requireSender(),
        subject: merge(template.subject, previewContact),
        htmlContent: renderedHtml,
        textContent: merge(template.text, previewContact),
      });
      // Full preflight (subject / merge tags / unsub / size / spam-score / images)
      // for the rendered preview. We keep the legacy `warnings` array for
      // backward-compat (older UI builds key off it) and add `preflight` with
      // the structured checklist so newer UI can render the full list.
      const preflight = runSendChecks({
        template: {
          subject: merge(template.subject, previewContact),
          html: renderedHtml,
          text: merge(template.text, previewContact),
          logoUrl: template.logoUrl,
        },
      });
      const unreachable = findUnreachableImageUrls(renderedHtml, template.logoUrl);
      const warnings = unreachable.length
        ? [{
            kind: 'unreachable_images',
            message: 'Some images point to URLs the recipient\'s mail client cannot fetch (localhost or a private network). Set PUBLIC_BASE_URL to a publicly reachable URL and re-upload the assets.',
            urls: unreachable,
          }]
        : [];
      res.json({
        sent: true,
        dryRun: !process.env.BREVO_API_KEY,
        result,
        warnings,
        preflight,
      });
    }),
  );

  // Pre-send lint. Called from the Builder before "Send now" fires, so the
  // admin sees a checklist of fail/warn rows and can fix them before the
  // campaign is committed. Returns `{ ok, checks }`. No side effects.
  app.post(
    '/api/campaigns/preflight',
    validate(z.object({ template: templateSchema })),
    asyncRoute(async (req, res) => {
      // Use the as-saved subject/html/text. Merge tags stay literal here so
      // the checklist surfaces unsubscribe-tag warnings even before send.
      const preflight = runSendChecks({ template: req.body.template });
      res.json(preflight);
    }),
  );

  // Sender identity for outgoing campaigns. Stored in the Setting table so
  // admins can edit via the UI instead of touching env vars. resolveSender()
  // reads this first, falls back to env, then to a placeholder.
  app.get('/api/settings/sender', asyncRoute(async (_req, res) => {
    // resolved is null when nothing real is configured. The UI uses that to
    // show "Not configured" instead of a placeholder address.
    const resolved = await resolveSender();
    const stored = await readSenderSetting();
    const source = stored?.email
      ? 'database'
      : (process.env.BREVO_SENDER_EMAIL ? 'env' : 'unset');
    res.json({
      // What sends actually use right now. null = nothing configured yet.
      effective: resolved,
      // 'database' | 'env' | 'unset'. Helps the UI show an accurate status pill
      // and an env-override note when the DB row is empty but env is set.
      source,
      // The raw stored override, so the UI can pre-fill the form with what's
      // actually editable (not the env fallback).
      stored: stored || null,
    });
  }));

  app.post(
    '/api/settings/sender',
    validate(z.object({
      email: z.string().email().max(200),
      name: z.string().min(1).max(120),
    })),
    asyncRoute(async (req, res) => {
      const previous = await readSenderSetting();
      const saved = await writeSenderSetting(req.body);
      await recordAudit(req, 'setting.sender.update', 'setting', 'campaign.sender', {
        previous: previous ? { email: previous.email, name: previous.name } : null,
        next: { email: saved.email, name: saved.name },
      });
      res.json({ ok: true, ...saved });
    }),
  );

  // Verified senders pulled live from Brevo. Drives the UI dropdown so admins
  // pick from addresses that will actually deliver. Instead of free-typing
  // an unverified one and getting cryptic 400s from Brevo at send time.
  // Returns `[]` in dry-run mode (no API key); UI falls back to free text.
  app.get('/api/settings/sender/verified', asyncRoute(async (_req, res) => {
    try {
      const senders = await fetchVerifiedSenders();
      res.json({ senders, dryRun: !process.env.BREVO_API_KEY });
    } catch (error) {
      // Surface the Brevo error message but don't 500. The UI will degrade
      // to free-text input and the admin can still save.
      res.json({ senders: [], dryRun: !process.env.BREVO_API_KEY, error: error.message });
    }
  }));

  // Deliverability self-check. Resolves SPF / DKIM / DMARC for the sender
  // domain and classifies each. Used by the Settings page to show the admin
  // what DNS work is still needed before sending at volume. Read-only.
  // 400s if the sender isn't configured yet, so the UI can prompt for setup
  // first.
  app.get('/api/settings/sender/deliverability', asyncRoute(async (_req, res) => {
    const sender = await resolveSender();
    if (!sender?.email) {
      res.status(400).json({
        error: 'Configure your sender email first, then re-run the deliverability check.',
        code: 'SENDER_NOT_CONFIGURED',
      });
      return;
    }
    const result = await checkDeliverability(sender.email);
    res.json(result);
  }));
}

export async function restoreCampaignJobs() {
  const campaigns = await listScheduledOrRunningCampaigns();
  campaigns.forEach((campaign) => scheduleCampaignJob(campaign, upsertCampaign));
}

export function serializeCampaign(campaign) {
  return {
    ...campaign,
    contacts: undefined,
    template: undefined,
    batches: undefined,
  };
}

function merge(template, contact) {
  return template
    .replace(/\{\{\s*firstname\s*\}\}/g, contact.firstname || '')
    .replace(/\{\{\s*unsubscribeUrl\s*\}\}/g, contact.unsubscribeUrl);
}


