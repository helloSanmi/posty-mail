// Campaign list / detail / patch / delete / clone. The CRUD endpoints
// that don't touch sender resolution or per-recipient analytics.
import {
  getCampaign,
  listCampaigns,
  listCampaignsPaged,
  prisma,
  upsertCampaign,
} from '../../lib/db.js';
import { recordAudit } from '../../lib/audit.js';
import { hasLevel } from '../../../shared/permissions.js';
import { scheduleCampaignJob } from '../../lib/scheduler.js';
import { validate, z } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import { serializeCampaign } from './schemas.js';

function requireCampaignManage(req, res, next) {
  if (hasLevel(req.user?.permissions, 'campaigns', 'manage')) {
    next();
    return;
  }
  res.status(403).json({ error: 'This needs full access to Campaigns.' });
}

export function registerCrudRoutes(app) {
  app.get('/api/campaigns', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    // Backward-compat: with no pagination params, return the flat array
    // (used by the dashboard, which only needs counts/totals). With
    // page/pageSize, return the paged shape
    // `{ rows, total, page, pageSize, totalPages }`.
    if (req.query.page || req.query.pageSize) {
      const result = await listCampaignsPaged({
        accountId,
        page: req.query.page,
        pageSize: req.query.pageSize,
      });
      res.json({ ...result, rows: result.rows.map(serializeCampaign) });
      return;
    }
    const campaigns = await listCampaigns(accountId);
    res.json(campaigns.map(serializeCampaign));
  }));

  app.patch(
    '/api/campaigns/:id',
    validate(z.object({
      name: z.string().min(1).max(200).optional(),
      scheduledAt: z.string().datetime().optional(),
      frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
    })),
    asyncRoute(async (req, res) => {
      const { accountId } = req.user;
      const campaign = await getCampaign(accountId, req.params.id);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }
      if (campaign.status === 'running') {
        res.status(409).json({
          error: 'Cannot edit a campaign that is currently running.',
        });
        return;
      }
      if (campaign.status === 'completed' || campaign.status === 'completed_with_errors') {
        // Only allow renaming for completed campaigns.
        if (req.body.scheduledAt || req.body.frequency) {
          res.status(409).json({
            error: 'Completed campaigns can only be renamed.',
          });
          return;
        }
      }

      // Arming the scheduler is a SEND, and sending needs `manage`.
      //
      // The rules table cannot see this: PATCH /api/campaigns/:id matches the
      // general /campaigns rule and asks for `write`, which is right for a
      // rename and wrong for anything that touches the clock. Setting
      // scheduledAt to a past time with frequency 'once' makes
      // scheduleCampaignJob fire runCampaign on the next tick of the event
      // loop, and runCampaign mails the whole recipient list. A role holding
      // campaigns:'write' — the exact role the area catalog invites an admin
      // to create, whose manage rung is documented as "Send, schedule and
      // delete" — could reach a real send in two ordinary API calls while
      // being correctly refused by /campaigns/schedule.
      //
      // So the level is asserted where the send becomes possible, not where
      // the path happens to match.
      const touchesTheClock = req.body.scheduledAt !== undefined
        || req.body.frequency !== undefined;
      if (touchesTheClock && !hasLevel(req.user?.permissions, 'campaigns', 'manage')) {
        res.status(403).json({
          error: 'Scheduling a campaign needs full access to Campaigns.',
        });
        return;
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

      await upsertCampaign(accountId, updated);

      // If still scheduled, refresh the cron job to reflect the new time/frequency.
      if (campaign.status === 'scheduled' || campaign.status === 'draft') {
        // TODO(multi-tenant): the scheduler still calls upsertCampaign
        // without an accountId. Bind the current accountId in the
        // upsert callback so the cron tick stays scoped.
        scheduleCampaignJob(updated, (next) => upsertCampaign(accountId, next));
      }

      await recordAudit(req, 'campaign.edit', 'campaign', updated.id, {
        changes: req.body,
      });
      res.json(serializeCampaign(updated));
    }),
  );

  app.delete('/api/campaigns/:id', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const campaign = await getCampaign(accountId, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    await prisma.$transaction([
      // CampaignSend's accountId column is denormalized from the parent,
      // so scoping the delete by both campaignId and accountId is
      // belt-and-suspenders against a misrouted id.
      prisma.campaignSend.deleteMany({ where: { campaignId: req.params.id, accountId } }),
      prisma.campaign.deleteMany({ where: { id: req.params.id, accountId } }),
    ]);
    await recordAudit(req, 'campaign.delete', 'campaign', req.params.id, {
      name: campaign.name,
    });
    res.json({ ok: true, id: req.params.id });
  }));

  // A clone carries the original's resolved recipient list and batches
  // verbatim, under a fresh id — so the send ledger is empty and every
  // recipient would be mailed again. Duplicating a live audience is closer
  // to sending than to editing, so it sits on the same rung as delete.
  app.post('/api/campaigns/:id/clone', requireCampaignManage, asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const original = await getCampaign(accountId, req.params.id);
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
    await upsertCampaign(accountId, clone);
    await recordAudit(req, 'campaign.clone', 'campaign', clone.id, {
      from: original.id,
    });
    res.status(201).json(serializeCampaign(clone));
  }));
}
