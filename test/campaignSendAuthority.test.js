// Who can actually cause mail to be sent.
//
// This file exists because of a confirmed escalation. The `campaigns`
// area has a `manage` rung documented as "Send, schedule and delete", and a
// role holding only `write` was correctly refused by POST
// /api/campaigns/schedule — and could then reach a real send in two ordinary
// calls that the rules table had no way to recognise:
//
//   POST  /api/campaigns/<id>/clone        (matched the generic /campaigns
//                                           rule, so `write` was enough)
//   PATCH /api/campaigns/<clone>           {scheduledAt: <in the past>,
//                                           frequency: 'once'}
//
// The PATCH re-armed the cron job, scheduleCampaignJob saw a past time with
// frequency 'once', and fired runCampaign on the next tick. runCampaign had
// no precondition at all, so the entire recipient list was mailed.
//
// The lesson is that a path-prefix rule cannot see the difference between
// "rename this campaign" and "arm the scheduler", so the level has to be
// asserted where the send becomes possible. Three guards now, deliberately
// overlapping: the clock check in the PATCH handler, the manage requirement
// on clone, and a status precondition inside runCampaign itself.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import { runCampaign } from '../backend/lib/scheduler/run-campaign.js';

const crud = () => readFileSync(
  new URL('../backend/routes/campaigns/crud.js', import.meta.url),
  'utf8',
);

describe('the PATCH route cannot be used to schedule', () => {
  it('requires campaigns:manage whenever the body touches the clock', () => {
    const text = crud();
    const handler = text.slice(
      text.indexOf("'/api/campaigns/:id'"),
      text.indexOf("'/api/campaigns/:id/clone'"),
    );
    assert.match(handler, /scheduledAt !== undefined/);
    assert.match(handler, /frequency !== undefined/);
    assert.match(handler, /hasLevel\(req\.user\?\.permissions, 'campaigns', 'manage'\)/);
    // And the check has to come BEFORE the job is armed, not after.
    // Matched on the CALL, not the bare identifier: the comment explaining
    // why the check exists names scheduleCampaignJob several lines above it,
    // so searching for the word finds the explanation and concludes the
    // check is in the wrong place.
    assert.ok(
      handler.indexOf("'campaigns', 'manage'") < handler.indexOf('scheduleCampaignJob('),
      'the level check must run before scheduleCampaignJob is called',
    );
  });

  it('still allows a plain rename at write level', () => {
    // The guard is conditional on purpose: renaming a campaign is an edit,
    // and making it need `manage` would collapse the two rungs back into one.
    const text = crud();
    const handler = text.slice(
      text.indexOf("'/api/campaigns/:id'"),
      text.indexOf("'/api/campaigns/:id/clone'"),
    );
    assert.match(handler, /touchesTheClock &&/);
  });
});

describe('cloning a campaign needs manage', () => {
  it('is guarded, because a clone carries the original recipient list', () => {
    // A clone gets a fresh id, so the send ledger is empty and every
    // recipient would be mailed again.
    const text = crud();
    const clone = text.slice(text.indexOf("'/api/campaigns/:id/clone'"));
    assert.match(clone.slice(0, 200), /requireCampaignManage/);
    assert.match(text, /function requireCampaignManage/);
    assert.match(text, /hasLevel\(req\.user\?\.permissions, 'campaigns', 'manage'\)/);
  });
});

describe('runCampaign refuses anything that is not armed', () => {
  const base = () => ({
    id: 'c-test', status: 'draft', batches: [], contacts: [], progress: {},
  });

  it('refuses a draft, which is the shape a clone lands in', async () => {
    const campaign = base();
    const result = await runCampaign(campaign, () => {});
    assert.equal(campaign.status, 'draft', 'status must be untouched');
    assert.equal(result.status, 'draft');
  });

  it('refuses a completed campaign, so a re-run cannot mail everyone twice', async () => {
    const campaign = { ...base(), status: 'completed' };
    await runCampaign(campaign, () => {});
    assert.equal(campaign.status, 'completed');
  });

  it('refuses one already running, so a double-arm cannot double-send', async () => {
    const campaign = { ...base(), status: 'running' };
    await runCampaign(campaign, () => {});
    assert.equal(campaign.status, 'running');
  });

  it('does not call back into persistence when it refuses', async () => {
    // A refusal that still wrote would advertise itself in the campaign list.
    let called = false;
    await runCampaign(base(), () => { called = true; });
    assert.equal(called, false);
  });
});
