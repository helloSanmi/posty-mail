// Brevo's webhook event names are inconsistent: some come as `opened`, others
// as `unique_opened` / `proxy_open`. The UI shouldn't care about the variants
// Show one pill color per "kind of thing", and one human label per event.

const POSITIVE = new Set([
  'delivered',
  // Brevo emits a small zoo of open variants depending on the mailbox provider:
  // `opened` = standard pixel load, `unique_opened` = first open per recipient,
  // `proxy_open` / `loadedbyproxy` = Apple Mail Privacy or Outlook image proxy.
  'opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy',
  'click', 'clicked', 'unique_clicked',
]);

const NEGATIVE = new Set([
  'hard_bounce', 'soft_bounce', 'spam', 'blocked', 'invalid_email',
  'unsubscribed', 'complaint', 'list_addition',
]);

const NEUTRAL = new Set([
  'request', 'sent', 'deferred',
]);

// Human label for the event. Collapses Brevo's `unique_*` / `proxy_*` flavors
// down to the everyday verb. Falls back to the raw key if we don't recognize
// it (so new event types Brevo adds are still readable).
const LABELS = {
  delivered: 'Delivered',
  opened: 'Opened',
  open: 'Opened',
  unique_opened: 'Opened',
  proxy_open: 'Opened',
  loadedbyproxy: 'Opened',
  click: 'Clicked',
  clicked: 'Clicked',
  unique_clicked: 'Clicked',
  hard_bounce: 'Hard bounce',
  soft_bounce: 'Soft bounce',
  spam: 'Spam',
  blocked: 'Blocked',
  invalid_email: 'Invalid email',
  unsubscribed: 'Unsubscribed',
  complaint: 'Complaint',
  list_addition: 'Added to list',
  request: 'Sent',
  sent: 'Sent',
  deferred: 'Deferred',
};

export function eventPill(eventName) {
  const e = String(eventName || '').toLowerCase();
  if (POSITIVE.has(e)) return 'green';
  if (NEGATIVE.has(e)) return 'amber';
  if (NEUTRAL.has(e)) return 'muted';
  return 'muted';
}

export function eventLabel(eventName) {
  const e = String(eventName || '').toLowerCase();
  return LABELS[e] || eventName || 'Event';
}

// Mailbox providers (Gmail, Outlook, security gateways) prefetch every link in
// every email for malware / phishing scanning the moment the message lands.
// That fires as a "click" event with no human involved. And inflates click
// counts unless we filter it. Heuristic: user-agent string that mentions a
// known scanner, or sending IP from a mailbox provider's prefetch range.
const BOT_USER_AGENT_RE = /GoogleImageProxy|YahooMailProxy|OutlookSafelinks|MicrosoftPreview|Slackbot|bot\b|spider|crawler/i;

export function isBotEvent(payload) {
  if (!payload) return false;
  // Only flag click events as bot. Gmail registers OPENS through Google's
  // image proxy. Every legitimate Gmail open has a Google IP + a proxy UA
  // string. Filtering opens by these signals would zero out our open count.
  const ev = String(payload.event || '').toLowerCase();
  if (!ev.includes('click')) return false;

  const ua = String(payload.user_agent || '');
  if (BOT_USER_AGENT_RE.test(ua)) return true;
  // Gmail's link-prefetch / safety-scan traffic lands from these Google ranges
  // with a generic "real browser" UA. Combined with the click event type, it's
  // a reliable signal it's a scanner, not a human.
  const ip = String(payload.sending_ip || '');
  if (/^(66\.249|172\.253|209\.85)\./.test(ip)) return true;
  return false;
}
