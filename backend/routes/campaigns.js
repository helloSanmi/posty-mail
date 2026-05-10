import { sendTestEmail } from '../lib/brevoClient.js';
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
import { sanitizeEmailHtml, sanitizeSubject } from '../lib/sanitize.js';
import { createCampaignPayload, scheduleCampaignJob } from '../lib/scheduler.js';
import { findUnreachableImageUrls } from '../lib/urlReachability.js';

// Brevo's webhook event names come in variants. Use these to classify them
// once, in one place, so metrics counts don't silently drop opens/clicks just
// because Brevo named them `unique_opened` / `proxy_open` / `unique_clicked`.
const OPEN_EVENTS = new Set(['opened', 'open', 'unique_opened', 'proxy_open']);
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
  scheduledAt: z.string().datetime().optional(),
  schedule: z.object({
    frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    timezone: z.string().optional(),
  }).optional(),
  compliance: z.object({
    requireOptIn: z.boolean().optional(),
    gdprMode: z.boolean().optional(),
  }).optional(),
  unsubscribeBaseUrl: z.string().url().optional(),
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
      // We can't know it without access to the variants array — but we already know which
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
        sender: getSender(),
        subject: merge(template.subject, previewContact),
        htmlContent: renderedHtml,
        textContent: merge(template.text, previewContact),
      });
      // Surface URLs the recipient's mail client won't be able to fetch (localhost,
      // private IPs, .local, etc.). Common cause: PUBLIC_BASE_URL not set, so the
      // asset upload returned an http://localhost URL that's now embedded in the
      // email. Send still goes out — we just warn so the user knows why images
      // appear broken in Gmail.
      const unreachable = findUnreachableImageUrls(renderedHtml, template.logoUrl);
      const warnings = unreachable.length
        ? [{
            kind: 'unreachable_images',
            message: 'Some images point to URLs the recipient\'s mail client cannot fetch (localhost or a private network). Set PUBLIC_BASE_URL to a publicly reachable URL and re-upload the assets.',
            urls: unreachable,
          }]
        : [];
      res.json({ sent: true, dryRun: !process.env.BREVO_API_KEY, result, warnings });
    }),
  );
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

function getSender() {
  return {
    email: process.env.BREVO_SENDER_EMAIL || 'campaigns@example.com',
    name: process.env.BREVO_SENDER_NAME || 'Campaign Team',
  };
}

