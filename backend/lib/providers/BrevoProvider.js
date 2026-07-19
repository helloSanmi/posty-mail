// Brevo implementation of the EmailProvider contract. Extracted verbatim
// from the original lib/brevoClient.js so legacy call sites that import from
// brevoClient.js keep working (it now re-exports from here).
//
// Env vars consumed:
//   BREVO_API_KEY  - if unset, every method runs in dry-run mode
//   DEMO_MODE      - forces dry-run regardless of API key (safe for demos)

const BREVO_BASE_URL = 'https://api.brevo.com/v3';

function hasBrevoKey() {
  return Boolean(process.env.BREVO_API_KEY);
}

function isDemoMode() {
  return process.env.DEMO_MODE === '1' || process.env.DEMO_MODE === 'true';
}

async function brevoFetch(path, options = {}) {
  if (!hasBrevoKey() || isDemoMode()) {
    return {
      dryRun: true,
      demoMode: isDemoMode(),
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
    // A 401/403 from Brevo means OUR API key is bad/expired ("Key not
    // found") — a server-config problem, NOT the user's session. Never
    // forward it as an app 401: the frontend treats a 401 as "your login
    // expired" and logs the user out. Map provider auth failures to 502
    // (Bad Gateway) with a message that points at the real cause, so the
    // user sees an error toast and stays signed in.
    const authFailure = response.status === 401 || response.status === 403;
    const message = authFailure
      ? `Email provider rejected the API key${body.message ? ` (${body.message})` : ''}. Check BREVO_API_KEY.`
      : (body.message || `Brevo request failed with ${response.status}`);
    const error = new Error(message);
    error.status = authFailure ? 502 : response.status;
    error.providerStatus = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

// Brevo's /smtp/email endpoint rejects a recipient whose `name` is missing or
// empty with "name is missing in to". CSV-imported contacts often only have
// an email column, so we fall back through firstname → lastname → local-part
// of the email → a generic "Subscriber" placeholder.
function buildRecipientName(contact) {
  const full = [contact.firstname, contact.lastname].filter(Boolean).join(' ').trim();
  if (full) return full;
  const local = String(contact.email || '').split('@')[0].trim();
  return local || 'Subscriber';
}

// Trim + validate a replyTo before handing it to Brevo. Brevo wants
// `{ email, name? }`, rejects payloads with malformed email. Returns
// null when the input is missing or unusable so the caller can omit
// the field cleanly.
function buildReplyTo(replyTo) {
  if (!replyTo || typeof replyTo !== 'object') return null;
  const email = String(replyTo.email || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = String(replyTo.name || '').trim();
  return name ? { email, name } : { email };
}

async function sendTransactionalEmail({
  contact,
  subject,
  htmlContent,
  textContent,
  sender,
  replyTo,
  idempotencyKey,
  campaignId,
  variantId,
}) {
  const tags = ['posty', 'campaign-suite'];
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
  const validReplyTo = buildReplyTo(replyTo);
  if (validReplyTo) payload.replyTo = validReplyTo;
  if (idempotencyKey) {
    payload.headers = { 'X-Campaign-Idempotency-Key': idempotencyKey };
  }
  return brevoFetch('/smtp/email', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function sendTestEmail({ toEmail, subject, htmlContent, textContent, sender, replyTo }) {
  // Subject is sent as-is. We used to prepend `[TEST] ` but it confused
  // admins ("the campaign I sent has TEST in the subject") and the
  // recipient already knows it's a test — they typed their own address
  // into the "Send test" box and clicked it themselves. The 'campaign-suite-
  // test' tag is enough to keep the engagement events out of real-campaign
  // reports.
  const payload = {
    sender,
    to: [{ email: toEmail, name: buildRecipientName({ email: toEmail }) }],
    subject,
    htmlContent,
    textContent,
    tags: ['posty', 'campaign-suite-test'],
  };
  const validReplyTo = buildReplyTo(replyTo);
  if (validReplyTo) payload.replyTo = validReplyTo;
  return brevoFetch('/smtp/email', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function fetchTransactionalEvents({ startDate, endDate, maxEvents = 10000 } = {}) {
  if (!hasBrevoKey()) return [];

  // Brevo's API rejects the request unless startDate + endDate are *both*
  // provided or *both* omitted. Default endDate to today if only startDate
  // is given so callers can say "from this date forward".
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
    const body = await brevoFetch(`/smtp/statistics/events?${params.toString()}`);
    const events = Array.isArray(body?.events) ? body.events : [];
    if (!events.length) break;
    collected.push(...events);
    if (events.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return collected.slice(0, maxEvents);
}

async function fetchVerifiedSenders() {
  if (!hasBrevoKey()) return [];
  const body = await brevoFetch('/senders');
  const senders = Array.isArray(body?.senders) ? body.senders : [];
  return senders.map((sender) => ({
    id: sender.id,
    email: sender.email,
    name: sender.name,
    active: sender.active === true || sender.active === 'true',
  }));
}

async function fetchMetrics(campaignId) {
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

/** @type {import('./EmailProvider.js').EmailProvider} */
export const BrevoProvider = {
  name: 'brevo',
  isConfigured: hasBrevoKey,
  sendTransactionalEmail,
  sendTestEmail,
  fetchTransactionalEvents,
  fetchVerifiedSenders,
  fetchMetrics,
};
