// POST /api/campaigns/schedule — the one endpoint that turns a builder
// payload into a saved Campaign row + an in-process cron job.
//
// Sender is required AT THE TIME OF SCHEDULING. requireSender() throws a
// 400 if not configured, so the admin gets a clear error instead of a
// placeholder going out. runCampaign re-resolves sender at FIRE time, so
// a Settings change between schedule and run takes effect.
import {
  upsertCampaign,
} from '../../lib/db.js';
import { recordAudit } from '../../lib/audit.js';
import { sanitizeEmailHtml, sanitizeSubject } from '../../lib/sanitize.js';
import { createCampaignPayload, scheduleCampaignJob } from '../../lib/scheduler.js';
import { requireSender } from '../../lib/sender.js';
import { validate } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import { scheduleSchema, serializeCampaign } from './schemas.js';

export function registerScheduleRoutes(app) {
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
      // We resolve sender here for the audit snapshot, but runCampaign
      // re-resolves at fire time so a Settings change between schedule
      // and run takes effect. If nothing is configured we 400 with a
      // clear message instead of letting a placeholder through.
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
}
