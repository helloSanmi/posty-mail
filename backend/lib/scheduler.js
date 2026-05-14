// Thin re-export shim. The real implementation lives in `lib/scheduler/`
// split by concern:
//   - run-campaign.js    runCampaign + per-send loop helpers
//   - schedule-job.js    scheduleCampaignJob + cron registration
//   - create-payload.js  createCampaignPayload (POST body → in-memory campaign)
//
// Import sites in routes/campaigns/* keep using `../lib/scheduler.js` so
// none of them needed updates when this split happened.
export { runCampaign } from './scheduler/run-campaign.js';
export { scheduleCampaignJob } from './scheduler/schedule-job.js';
export { createCampaignPayload } from './scheduler/create-payload.js';
