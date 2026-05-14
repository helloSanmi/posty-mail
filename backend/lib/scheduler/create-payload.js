// Normalizes the POST /api/campaigns/schedule body into the in-memory
// campaign object the scheduler operates on (batches, snapshot sender,
// unsubscribe URL, A/B variants with defaults, etc.). Kept side-effect-free
// — the actual scheduling happens in schedule-job.js.
import { chunkContacts } from '../../../shared/campaignUtils.js';

export function createCampaignPayload(body) {
  const batchSize = Math.min(Math.max(Number(body.batchSize) || 300, 1), 1000);
  const delayMinutes = Math.min(Math.max(Number(body.delayMinutes) || 1, 0), 60);
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const variants = Array.isArray(body.variants) && body.variants.length
    ? body.variants.map((variant, index) => ({
      id: variant.id || `v${index + 1}`,
      label: variant.label || `Variant ${index + 1}`,
      subject: variant.subject ?? null,
      html: variant.html ?? null,
      text: variant.text ?? null,
      weight: Number(variant.weight) || 1,
    }))
    : null;

  return {
    id: crypto.randomUUID(),
    name: body.name || 'Untitled campaign',
    createdAt: new Date().toISOString(),
    scheduledAt: body.scheduledAt || new Date().toISOString(),
    schedule: {
      frequency: body.schedule?.frequency || body.frequency || 'once',
      timezone: body.schedule?.timezone || body.timezone || 'local',
    },
    batchSize,
    delayMinutes,
    contacts,
    batches: chunkContacts(contacts, batchSize),
    template: body.template,
    variants,
    compliance: body.compliance || { requireOptIn: true, gdprMode: true },
    // Sender SNAPSHOT for audit only. Real sends re-resolve at fire time via
    // runCampaign() so a Settings change between schedule and run takes
    // effect. If the caller (e.g. /api/campaigns/schedule) didn't supply one,
    // we fall back to env. We DO NOT inject a dummy placeholder. runCampaign
    // refuses to send when nothing is configured.
    sender: body.sender || (
      process.env.BREVO_SENDER_EMAIL && process.env.BREVO_SENDER_NAME
        ? { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME }
        : null
    ),
    // Default the unsubscribe link to the self-hosted page on PUBLIC_BASE_URL.
    // Falls back to the example.com placeholder only if neither is set, which
    // means the link will be visibly broken. That's intentional, so the dev
    // notices and configures PUBLIC_BASE_URL before sending real campaigns.
    unsubscribeBaseUrl: body.unsubscribeBaseUrl
      || (process.env.PUBLIC_BASE_URL
        ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/unsubscribe`
        : 'https://example.com/unsubscribe'),
    // Flag for per-recipient-timezone mode. The runner reads this and
    // defers contacts whose local clock hasn't reached the target yet,
    // re-checking on a 15-minute timer until done.
    useRecipientTimezone: Boolean(body.useRecipientTimezone),
    status: 'scheduled',
    logs: [],
    progress: { sent: 0, failed: 0, skipped: 0, currentBatch: 0, totalBatches: 0 },
  };
}
