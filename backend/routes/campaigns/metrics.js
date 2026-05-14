// Per-campaign analytics endpoints. Read CampaignSend + Event rows and
// aggregate by recipient / link / variant / overall KPIs.
//
// Event classification (open / click / bounce) goes through the shared
// helpers in event-classifiers.js so the same code path drives the metrics
// endpoint and the Reports page totals.
import {
  getCampaign,
  listCampaignSends,
  listEventsForCampaign,
} from '../../lib/db.js';
import { asyncRoute } from '../../utils/store.js';
import { isBounce, isClick, isOpen } from './event-classifiers.js';
import { serializeCampaign } from './schemas.js';

export function registerMetricsRoutes(app) {
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
      const variantTag = tags.find(
        (tag) => typeof tag === 'string' && tag.startsWith('variant:'),
      );
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

    events.forEach((event) => {
      const payload = event.payload || {};
      const tags = Array.isArray(payload.tags) ? payload.tags : [];
      const variantTag = tags.find(
        (tag) => typeof tag === 'string' && tag.startsWith('variant:'),
      );
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
}
