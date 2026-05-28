// Thin re-export shim. The real route handlers live in
// `routes/campaigns/` split by concern:
//   - schedule.js          POST /api/campaigns/schedule
//   - crud.js              list / patch / delete / clone
//   - metrics.js           sends / recipients / links / variants / metrics
//   - drafts.js            drafts CRUD
//   - test-preflight.js    test-email + preflight
//   - sender.js            sender setting + verified-senders + deliverability
//   - schemas.js           shared Zod schemas + serializeCampaign + merge
//   - event-classifiers.js OPEN_EVENTS / CLICK_EVENTS / BOUNCE_EVENTS_METRICS
//
// `registerCampaignRoutes` calls every domain-specific register* function
// so server.js keeps its single-import surface. `restoreCampaignJobs` and
// `serializeCampaign` stay re-exported from here for backward compat.
import {
  listScheduledOrRunningCampaigns,
  upsertCampaign,
} from '../lib/db.js';
import { scheduleCampaignJob } from '../lib/scheduler.js';
import { registerCrudRoutes } from './campaigns/crud.js';
import { registerDraftRoutes } from './campaigns/drafts.js';
import { registerMetricsRoutes } from './campaigns/metrics.js';
import { registerScheduleRoutes } from './campaigns/schedule.js';
import { registerSenderRoutes } from './campaigns/sender.js';
import { registerTestAndPreflightRoutes } from './campaigns/test-preflight.js';

export { serializeCampaign } from './campaigns/schemas.js';

export function registerCampaignRoutes(app) {
  registerScheduleRoutes(app);
  registerCrudRoutes(app);
  registerMetricsRoutes(app);
  registerDraftRoutes(app);
  registerTestAndPreflightRoutes(app);
  registerSenderRoutes(app);
}

export async function restoreCampaignJobs() {
  // Boot-time re-arm of cron jobs for every campaign that was still
  // scheduled or running when the server last shut down. The campaign
  // payload carries its own accountId (stamped at creation time in
  // createCampaignPayload), so we bind it into a per-campaign closure
  // here — runCampaign's onUpdate callback then writes status / progress
  // back to the SAME workspace it came from.
  const campaigns = await listScheduledOrRunningCampaigns();
  campaigns.forEach((campaign) => {
    const accountId = campaign.accountId || 'default';
    scheduleCampaignJob(campaign, (next) => upsertCampaign(accountId, next));
  });
}
