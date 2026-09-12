// Brevo names the same event two different ways, and it cost us clicks.
//
// Its webhooks send `click`, `soft_bounce`, `unique_opened`. Its API — which
// the catch-up sync reads, and which is the ONLY source on a deployment that
// does not own the webhook — sends `clicks`, `softBounces`, `uniqueOpened`.
// Every classification set in this app was written against the webhook
// spellings, so anything that arrived through the sync matched nothing:
// clicks were never reported at all.
//
// The names below are not invented. They were read out of a live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEventName, eventVerb, isBounceEvent, isClickEvent, isOpenEvent,
  isUnsubscribeEvent,
} from '../shared/eventNames.js';

// Observed in production: `select payload->>'event', count(*) from "Event"`.
const OBSERVED = [
  'delivered', 'requests', 'request', 'opened', 'loadedByProxy',
  'unsubscribed', 'unique_proxy_open', 'softBounces', 'clicks',
  'proxy_open', 'soft_bounce',
];

test('every name seen in the wild classifies as something', () => {
  const unclassified = OBSERVED.filter((name) => (
    !isOpenEvent(name) && !isClickEvent(name) && !isBounceEvent(name)
    && !isUnsubscribeEvent(name)
    && !['delivered', 'requests', 'request'].includes(name)
  ));
  assert.deepEqual(unclassified, [], `unclassified: ${unclassified.join(', ')}`);
});

test('clicks — the bug — counts as a click in BOTH vocabularies', () => {
  assert.ok(isClickEvent('click'), 'webhook spelling');
  assert.ok(isClickEvent('clicks'), 'API spelling — this is the one that was missed');
  assert.ok(isClickEvent('unique_clicked'));
  assert.ok(isClickEvent('uniqueClicks'));
});

test('bounces count in both vocabularies', () => {
  ['hard_bounce', 'hardBounces', 'soft_bounce', 'softBounces', 'bounces', 'blocked', 'invalid_email']
    .forEach((name) => assert.ok(isBounceEvent(name), name));
});

test('opens count in both vocabularies, including the proxy variants', () => {
  ['opened', 'unique_opened', 'uniqueOpened', 'proxy_open', 'unique_proxy_open', 'loadedByProxy']
    .forEach((name) => assert.ok(isOpenEvent(name), name));
});

test('the buckets do not overlap', () => {
  // A name landing in two buckets would double-count in the KPIs.
  OBSERVED.concat(['hardBounces', 'uniqueOpened', 'uniqueClicks']).forEach((name) => {
    const hits = [isOpenEvent, isClickEvent, isBounceEvent, isUnsubscribeEvent]
      .filter((fn) => fn(name)).length;
    assert.ok(hits <= 1, `${name} matched ${hits} buckets`);
  });
});

test('canonicalisation collapses separators, case and plurals', () => {
  assert.equal(canonicalEventName('soft_bounce'), 'softbounce');
  assert.equal(canonicalEventName('softBounces'), 'softbounce');
  assert.equal(canonicalEventName('SOFT_BOUNCE'), 'softbounce');
  assert.equal(canonicalEventName('clicks'), 'click');
  assert.equal(canonicalEventName(null), '');
});

test('an unknown event is readable rather than blank', () => {
  assert.equal(eventVerb('some_future_thing'), 'some_future_thing');
  assert.equal(eventVerb('clicks'), 'Clicked');
  assert.equal(eventVerb('softBounces'), 'Soft bounce');
});
