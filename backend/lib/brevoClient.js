const BREVO_BASE_URL = 'https://api.brevo.com/v3';

function hasBrevoKey() {
  return Boolean(process.env.BREVO_API_KEY);
}

async function brevoFetch(path, options = {}) {
  if (!hasBrevoKey()) {
    return {
      dryRun: true,
      path,
      method: options.method || 'GET',
      accepted: true,
    };
  }

  const response = await fetch(`${BREVO_BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.message || `Brevo request failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export async function sendTransactionalEmail({
  contact,
  subject,
  htmlContent,
  textContent,
  sender,
  idempotencyKey,
  campaignId,
  variantId,
}) {
  const tags = ['campaign-suite'];
  if (campaignId) tags.push(`campaign:${campaignId}`);
  if (variantId) tags.push(`variant:${variantId}`);

  const payload = {
    sender,
    to: [{ email: contact.email, name: buildRecipientName(contact) }],
    subject,
    htmlContent,
    textContent,
    tags,
  };
  if (idempotencyKey) {
    payload.headers = { 'X-Campaign-Idempotency-Key': idempotencyKey };
  }
  return brevoFetch('/smtp/email', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function sendTestEmail({ toEmail, subject, htmlContent, textContent, sender }) {
  return brevoFetch('/smtp/email', {
    method: 'POST',
    body: JSON.stringify({
      sender,
      to: [{ email: toEmail, name: buildRecipientName({ email: toEmail }) }],
      subject: `[TEST] ${subject}`,
      htmlContent,
      textContent,
      tags: ['campaign-suite-test'],
    }),
  });
}

// Brevo's /smtp/email endpoint rejects a recipient whose `name` is missing or
// empty with "name is missing in to". CSV-imported contacts often only have
// an email column, so we fall back through firstname → lastname → local-part
// of the email → a generic "Subscriber" placeholder. Result: every send has
// a non-empty `name`, no matter how thin the contact data.
function buildRecipientName(contact) {
  const full = [contact.firstname, contact.lastname].filter(Boolean).join(' ').trim();
  if (full) return full;
  const local = String(contact.email || '').split('@')[0].trim();
  return local || 'Subscriber';
}

// Pull transactional events from Brevo's stored history. Used at startup to
// catch up on anything we missed while the backend was down. Brevo retains
// transactional events for ~30 days; older missed events are unrecoverable.
//
// Pages through results via `offset` until either we run out of events or we
// hit a sensible cap (10k events = ~6 months of low-volume sending).
export async function fetchTransactionalEvents({ startDate, endDate, maxEvents = 10000 } = {}) {
  if (!hasBrevoKey()) return [];

  // Brevo's API rejects the request unless startDate + endDate are *both*
  // provided or *both* omitted. If only startDate is given, default endDate
  // to today (UTC) so the caller's intent. "from this date forward". Works.
  let resolvedEnd = endDate;
  if (startDate && !resolvedEnd) {
    resolvedEnd = new Date().toISOString().slice(0, 10);
  }

  const PAGE_SIZE = 100; // Brevo's API max per page
  const collected = [];
  let offset = 0;

  while (collected.length < maxEvents) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (startDate) {
      params.set('startDate', startDate);
      params.set('endDate', resolvedEnd);
    }

    // brevoFetch throws on transport / non-OK responses. That bubbles up to
    // syncBrevoEvents, which logs and bails without crashing startup.
    const body = await brevoFetch(`/smtp/statistics/events?${params.toString()}`);
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!events.length) break;
    collected.push(...events);
    if (events.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  return collected.slice(0, maxEvents);
}

// Brevo's account-level list of verified senders. Drives the UI dropdown so
// admins can only pick from addresses that will actually deliver. Returns
// `[]` in dry-run mode so the UI degrades to a free-text input.
export async function fetchVerifiedSenders() {
  if (!hasBrevoKey()) return [];
  const body = await brevoFetch('/senders');
  const senders = Array.isArray(body?.senders) ? body.senders : [];
  return senders.map((sender) => ({
    id: sender.id,
    email: sender.email,
    name: sender.name,
    // `active` is true once Brevo has verified the address (DNS records ok
    // or the verification email was clicked). Inactive senders can't be used
    // even though they're on the list. UI should disable / warn on these.
    active: sender.active === true || sender.active === 'true',
  }));
}

export async function fetchMetrics(campaignId) {
  if (!hasBrevoKey()) {
    return {
      campaignId,
      sent: 1240,
      delivered: 1198,
      opens: 613,
      clicks: 178,
      bounces: 21,
      unsubscribes: 9,
      dryRun: true,
    };
  }

  return brevoFetch(`/emailCampaigns/${campaignId}`);
}
