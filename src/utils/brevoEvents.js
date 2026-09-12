// Pill colour and human label for an event.
//
// The classification itself lives in shared/eventNames.js, which both this
// file and the backend's metrics pipeline read — Brevo names the same event
// differently over its webhook and its API, and that belongs in exactly one
// place. This module is only about how an event is PRESENTED.
import {
  canonicalEventName, eventVerb, isBounceEvent, isClickEvent, isOpenEvent,
  isSpamEvent, isUnsubscribeEvent,
} from '../../shared/eventNames.js';

export function eventPill(eventName) {
  if (isOpenEvent(eventName) || isClickEvent(eventName)) return 'green';
  if (canonDelivered(eventName)) return 'green';
  if (isBounceEvent(eventName) || isSpamEvent(eventName) || isUnsubscribeEvent(eventName)) return 'amber';
  return 'muted';
}

function canonDelivered(name) {
  return canonicalEventName(name) === 'delivered';
}

export function eventLabel(eventName) {
  return eventVerb(eventName);
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
