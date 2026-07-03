// Thin re-export shim. The real persistence helpers live in `lib/db/*.js`
// split by domain (contacts, audiences, campaigns, segments, sequences,
// drafts, unsubscribes, events, assets, templates). This file exists so
// the 21 existing import sites that say `from '../lib/db.js'` keep
// working without touching every consumer.
//
// When you add a new helper, drop it into the right domain file under
// db/ and add the export here. Re-exports are listed in the same order
// as the domain files for easy scanning.

export { prisma } from './db/prisma.js';

// Contacts (people you can email).
export {
  buildContactWhere,
  contactFromDb,
  deleteContacts,
  listContacts,
  queryContacts,
  upsertContacts,
} from './db/contacts.js';

// Audiences (groups). Holds the exclusive-membership invariant and fires
// the drip-sequence trigger when emails get added to a group.
export {
  addEmailsToAudience,
  audienceFromDb,
  deleteAudience,
  findOrCreateAudienceByName,
  getAudience,
  listAudienceContacts,
  listAudiences,
  patchAudienceMembers,
  removeEmailsFromAllAudiences,
  renameAudience,
  setAudienceDisabled,
  upsertAudience,
} from './db/audiences.js';

// Segments (dynamic recipient filters).
export {
  deleteSegment,
  listSegments,
  upsertSegment,
} from './db/segments.js';

// Templates (reusable subject + HTML + text shells).
export {
  deleteTemplate,
  listTemplates,
  templateFromDb,
  upsertTemplate,
} from './db/templates.js';

// Drafts (autosaved in-progress campaigns).
export {
  draftFromDb,
  listDrafts,
  upsertDraft,
} from './db/drafts.js';

// Unsubscribes (suppression list + Contact.consent mirror).
export {
  listUnsubscribes,
  restoreContactSubscription,
  unsubscribedEmailSet,
  unsubscribeFromDb,
  upsertUnsubscribe,
} from './db/unsubscribes.js';

// Events (webhook + sync history feed for Reports).
export {
  eventFromDb,
  getLatestEventDate,
  listEvents,
  listEventsForCampaign,
  pruneEventsToLatest,
  recordEvent,
  resolveEventAccountId,
} from './db/events.js';

// Campaigns + CampaignSend ledger.
export {
  campaignFromDb,
  getCampaign,
  getSendRecord,
  listCampaigns,
  listCampaignSends,
  listCampaignsPaged,
  listScheduledOrRunningCampaigns,
  markSendAttempt,
  markSendFailed,
  markSendSkipped,
  markSendSucceeded,
  upsertCampaign,
} from './db/campaigns.js';

// Assets (uploaded logos, banner images).
export {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
} from './db/assets.js';

// Drip sequences + per-contact enrollments.
export {
  advanceEnrollment,
  deleteSequence,
  enrollInSequence,
  getSequence,
  listDueEnrollments,
  listEnrollmentsForSequence,
  listSequences,
  sequenceFromDb,
  upsertSequence,
} from './db/sequences.js';
