// Event-name classifiers for the metrics endpoints. Mirrors the UI's
// classification sets in src/utils/brevoEvents.js — both halves are kept
// in lockstep by the parity test in test/eventParity.test.js so a new
// Brevo event variant can't be silently dropped from one side.
//
// Brevo's webhook event names come in variants. We need all of them to
// resolve to the same KPI so counts don't disagree between the activity
// feed and the per-campaign metrics endpoint.
export const OPEN_EVENTS = new Set([
  'opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy',
]);
export const CLICK_EVENTS = new Set([
  'click', 'clicked', 'unique_clicked',
]);
export const BOUNCE_EVENTS_METRICS = new Set([
  'hard_bounce', 'soft_bounce', 'blocked', 'invalid_email',
]);

export const isOpen = (e) => OPEN_EVENTS.has(e);
export const isClick = (e) => CLICK_EVENTS.has(e);
export const isBounce = (e) => BOUNCE_EVENTS_METRICS.has(e);
