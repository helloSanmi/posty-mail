// Regression coverage for the event classification helpers + bot filter.
//
// These functions sit on the critical path of the Reports page:
//   - eventLabel/eventPill drive how each row in the activity feed renders.
//   - isBotEvent decides whether a "click" came from a real human or from
//     Gmail / Outlook's link-prefetch scanner. Wrong answers here directly
//     poison click-rate KPIs.
//
// Specific regressions this guards against:
//   - A new Brevo event variant (e.g., `proxy_open`) silently classified as
//     "unknown" because nobody updated the POSITIVE set. The eventLabel
//     fallback would still render something, but the KPI would skip it.
//   - Bot-filter IP ranges getting changed without updating BOTH the UI
//     filter and the notifications backend's parallel filter.
//   - The bot filter accidentally flagging real Gmail OPENS as bots
//     (Gmail loads the open-tracking pixel through Google's image proxy
//     for every legit open — filtering opens by Google IPs would zero out
//     the whole engagement signal).

import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLabel, eventPill, isBotEvent } from '../src/utils/brevoEvents.js';

// --- eventLabel ---------------------------------------------------------

test('eventLabel: collapses Brevo open variants to "Opened"', () => {
  assert.equal(eventLabel('opened'), 'Opened');
  assert.equal(eventLabel('open'), 'Opened');
  assert.equal(eventLabel('unique_opened'), 'Opened');
  assert.equal(eventLabel('proxy_open'), 'Opened');
  assert.equal(eventLabel('loadedbyproxy'), 'Opened');
});

test('eventLabel: collapses click variants to "Clicked"', () => {
  assert.equal(eventLabel('click'), 'Clicked');
  assert.equal(eventLabel('clicked'), 'Clicked');
  assert.equal(eventLabel('unique_clicked'), 'Clicked');
});

test('eventLabel: bounces + suppressions get human labels', () => {
  assert.equal(eventLabel('hard_bounce'), 'Hard bounce');
  assert.equal(eventLabel('soft_bounce'), 'Soft bounce');
  assert.equal(eventLabel('unsubscribed'), 'Unsubscribed');
  assert.equal(eventLabel('blocked'), 'Blocked');
});

test('eventLabel: unknown event names fall back to the raw key', () => {
  // Future-proofing: if Brevo adds e.g. `marked_as_safe`, we still render
  // SOMETHING readable instead of a blank cell.
  assert.equal(eventLabel('some_new_event'), 'some_new_event');
});

test('eventLabel: empty/null input returns the "Event" placeholder', () => {
  assert.equal(eventLabel(null), 'Event');
  assert.equal(eventLabel(''), 'Event');
  assert.equal(eventLabel(undefined), 'Event');
});

// --- eventPill ----------------------------------------------------------

test('eventPill: opens, clicks, deliveries are green', () => {
  assert.equal(eventPill('opened'), 'green');
  assert.equal(eventPill('unique_opened'), 'green');
  assert.equal(eventPill('proxy_open'), 'green');
  assert.equal(eventPill('click'), 'green');
  assert.equal(eventPill('delivered'), 'green');
});

test('eventPill: bounces + unsubscribes + complaints are amber', () => {
  assert.equal(eventPill('hard_bounce'), 'amber');
  assert.equal(eventPill('soft_bounce'), 'amber');
  assert.equal(eventPill('unsubscribed'), 'amber');
  assert.equal(eventPill('blocked'), 'amber');
  assert.equal(eventPill('complaint'), 'amber');
});

test('eventPill: neutral statuses (sent, deferred) are muted', () => {
  assert.equal(eventPill('sent'), 'muted');
  assert.equal(eventPill('deferred'), 'muted');
});

test('eventPill: unknown events default to muted', () => {
  assert.equal(eventPill('whatever_new_thing'), 'muted');
});

// --- isBotEvent ---------------------------------------------------------

test('isBotEvent: non-click events are never flagged as bot', () => {
  // Gmail loads open-tracking pixels through Google's image proxy on EVERY
  // legitimate open. If we filtered opens by Google IPs we'd zero out the
  // entire open-rate signal. This test locks that in.
  assert.equal(isBotEvent({ event: 'opened', sending_ip: '66.249.93.1' }), false);
  assert.equal(isBotEvent({ event: 'unique_opened', sending_ip: '209.85.21.5' }), false);
  assert.equal(isBotEvent({ event: 'delivered', sending_ip: '66.249.0.1' }), false);
  assert.equal(isBotEvent({ event: 'hard_bounce' }), false);
});

test('isBotEvent: clicks from Gmail prefetch ranges flagged as bot', () => {
  assert.equal(isBotEvent({ event: 'click', sending_ip: '66.249.93.1' }), true);
  assert.equal(isBotEvent({ event: 'click', sending_ip: '172.253.0.42' }), true);
  assert.equal(isBotEvent({ event: 'click', sending_ip: '209.85.215.2' }), true);
  assert.equal(isBotEvent({ event: 'unique_clicked', sending_ip: '66.249.83.1' }), true);
});

test('isBotEvent: clicks from outside the prefetch IP ranges pass through', () => {
  assert.equal(isBotEvent({ event: 'click', sending_ip: '8.8.8.8' }), false);
  assert.equal(isBotEvent({ event: 'click', sending_ip: '192.168.1.1' }), false);
  // 172.x range but NOT in the 172.253 prefetch block.
  assert.equal(isBotEvent({ event: 'click', sending_ip: '172.16.0.1' }), false);
});

test('isBotEvent: scanner user-agents flagged regardless of IP', () => {
  assert.equal(isBotEvent({ event: 'click', user_agent: 'GoogleImageProxy/1.0' }), true);
  assert.equal(isBotEvent({ event: 'click', user_agent: 'OutlookSafelinks v2' }), true);
  assert.equal(isBotEvent({ event: 'click', user_agent: 'Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)' }), true);
  assert.equal(isBotEvent({ event: 'click', user_agent: 'Some generic crawler/1.0' }), true);
});

test('isBotEvent: real human clicks pass through', () => {
  // Common desktop Chrome UA from a residential IP. Should NOT be flagged.
  const realClick = {
    event: 'click',
    sending_ip: '73.91.4.22',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  assert.equal(isBotEvent(realClick), false);
});

test('isBotEvent: tolerates missing / null payloads', () => {
  assert.equal(isBotEvent(null), false);
  assert.equal(isBotEvent(undefined), false);
  assert.equal(isBotEvent({}), false);
});
