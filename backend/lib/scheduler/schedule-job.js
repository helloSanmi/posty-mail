// TODO(multi-tenant): scope by accountId — scheduleCampaignJob takes the
// upsertCampaign function as a callback; that function now requires an
// accountId argument. The cron tick needs to pass campaign.accountId
// through. Handled in a separate pass.
//
// Cron registration for scheduled campaigns. One node-cron job per campaign,
// tracked in an in-process Map so reschedules can stop the old job first.
// The actual send loop lives in run-campaign.js; this file is just the
// timing harness.
import cron from 'node-cron';
import { runCampaign } from './run-campaign.js';

const jobs = new Map();

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
