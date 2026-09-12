// Brevo event names, classified. One source of truth for both halves of the
// app — the UI's KPIs and the backend's metrics endpoints must agree, and
// previously each kept its own copy of these sets.
//
// THE PROBLEM THIS EXISTS TO SOLVE. Brevo names the same event differently
// depending on where you read it from:
//
//   webhook (POST to us)        API (/smtp/statistics/events, the catch-up sync)
//   ------------------------    -----------------------------------------------
//   click                       clicks
//   soft_bounce                 softBounces
//   hard_bounce                 hardBounces
//   opened                      opened
//   unique_opened               uniqueOpened
//
// Both sets were written against the webhook spellings only. Anything that
// arrived through the sync — which is every event on a deployment that does
// not own the webhook, and every event a webhook retry dropped — matched
// nothing. Clicks in particular were never reported at all: `clicks` is not
// `click`. Confirmed against a live database, where the stored names included
// `clicks`, `softBounces` and `unique_proxy_open`, none of which any set knew.
//
// Rather than list every spelling, names are reduced to a canonical form
// first: lowercased, stripped of separators, de-pluralised. `soft_bounce`,
// `softBounces` and `SOFT_BOUNCE` all become `softbounce`, so a vocabulary we
// have not seen yet still lands in the right bucket as long as it is the same
// word.

export function canonicalEventName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    // Brevo's API pluralises what its webhooks do not. No event in either
    // vocabulary ends in a meaningful "s", so this is safe.
    .replace(/s$/, '');
}

// Canonical forms. Each covers both vocabularies at once — `clicks` and
// `click` both reduce to `click`.
const OPEN = new Set([
  'opened', 'open',
  'uniqueopened',       // unique_opened, uniqueOpened
  'proxyopen',          // proxy_open
  'uniqueproxyopen',    // unique_proxy_open
  'loadedbyproxy',      // loadedByProxy — Apple Mail Privacy / Outlook proxy
]);

const CLICK = new Set([
  'click', 'clicked',
  'uniqueclicked', 'uniqueclick', // unique_clicked, uniqueClicks
]);

const BOUNCE = new Set([
  'hardbounce', 'softbounce', 'bounce',
  'blocked',
  'invalidemail', 'invalid',
]);

const UNSUBSCRIBE = new Set(['unsubscribed', 'unsubscribe']);
const SPAM = new Set(['spam', 'complaint']);
const NEUTRAL = new Set(['request', 'sent', 'delivered', 'deferred', 'error', 'listaddition']);

export const isOpenEvent = (name) => OPEN.has(canonicalEventName(name));
export const isClickEvent = (name) => CLICK.has(canonicalEventName(name));
export const isBounceEvent = (name) => BOUNCE.has(canonicalEventName(name));
export const isUnsubscribeEvent = (name) => UNSUBSCRIBE.has(canonicalEventName(name));
export const isSpamEvent = (name) => SPAM.has(canonicalEventName(name));
export const isNeutralEvent = (name) => NEUTRAL.has(canonicalEventName(name));

// Everyday verb for an event, whichever spelling arrived. Falls back to the
// raw name so a variant we do not know is still readable rather than blank.
export function eventVerb(name) {
  if (isOpenEvent(name)) return 'Opened';
  if (isClickEvent(name)) return 'Clicked';
  if (isUnsubscribeEvent(name)) return 'Unsubscribed';
  if (isSpamEvent(name)) return 'Spam';
  const canon = canonicalEventName(name);
  if (canon === 'hardbounce') return 'Hard bounce';
  if (canon === 'softbounce') return 'Soft bounce';
  if (canon === 'bounce') return 'Bounced';
  if (canon === 'blocked') return 'Blocked';
  if (canon === 'invalidemail' || canon === 'invalid') return 'Invalid email';
  if (canon === 'delivered') return 'Delivered';
  if (canon === 'request' || canon === 'sent') return 'Sent';
  if (canon === 'deferred') return 'Deferred';
  if (canon === 'listaddition') return 'Added to list';
  return name || 'Event';
}
