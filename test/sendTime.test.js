// Locks the per-timezone send-time helpers. We can't mock Date globally
// without leaking into other tests, so isReady is tested by passing in
// hand-rolled `now` values rather than calling nowInZone() inside the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isReady, nowInZone, parseLocalTarget } from '../backend/lib/sendTime.js';

test('parseLocalTarget: extracts components from datetime-local ISO', () => {
  const t = parseLocalTarget('2026-05-13T09:00');
  assert.deepEqual(t, { year: 2026, month: 5, day: 13, hour: 9, minute: 0 });
});

test('parseLocalTarget: tolerates a full ISO with seconds and Z', () => {
  const t = parseLocalTarget('2026-05-13T09:00:00.000Z');
  assert.equal(t.year, 2026);
  assert.equal(t.hour, 9);
});

test('parseLocalTarget: rejects malformed input', () => {
  assert.equal(parseLocalTarget('not-a-date'), null);
  assert.equal(parseLocalTarget(''), null);
  assert.equal(parseLocalTarget(null), null);
});

test('isReady: contact in the future returns "later"', () => {
  const contact = { year: 2026, month: 5, day: 13, hour: 8, minute: 59 };
  const target = { year: 2026, month: 5, day: 13, hour: 9, minute: 0 };
  assert.equal(isReady(contact, target), 'later');
});

test('isReady: exact match counts as "now"', () => {
  const contact = { year: 2026, month: 5, day: 13, hour: 9, minute: 0 };
  const target = { year: 2026, month: 5, day: 13, hour: 9, minute: 0 };
  assert.equal(isReady(contact, target), 'now');
});

test('isReady: contact past the target returns "now"', () => {
  const contact = { year: 2026, month: 5, day: 13, hour: 10, minute: 30 };
  const target = { year: 2026, month: 5, day: 13, hour: 9, minute: 0 };
  assert.equal(isReady(contact, target), 'now');
});

test('isReady: date difference dominates hour difference', () => {
  // Contact is on May 14 at 02:00. Target was May 13 at 23:59. Still "now".
  const contact = { year: 2026, month: 5, day: 14, hour: 2, minute: 0 };
  const target = { year: 2026, month: 5, day: 13, hour: 23, minute: 59 };
  assert.equal(isReady(contact, target), 'now');
});

test('nowInZone: produces sensible components for UTC', () => {
  const result = nowInZone('UTC');
  assert.equal(typeof result.year, 'number');
  assert.equal(typeof result.hour, 'number');
  assert.ok(result.year >= 2025); // sanity check
  assert.ok(result.month >= 1 && result.month <= 12);
  assert.ok(result.hour >= 0 && result.hour <= 23);
});

test('nowInZone: unknown timezone falls back to UTC (no crash)', () => {
  // Should not throw. Falls back to UTC internally.
  const result = nowInZone('Not/A_Real_Zone');
  assert.equal(typeof result.year, 'number');
});

test('nowInZone: NY and Tokyo report different hours during the same instant', () => {
  const ny = nowInZone('America/New_York');
  const tokyo = nowInZone('Asia/Tokyo');
  // The two should differ in their hour component. If they happen to align
  // exactly (unlikely without DST oddities), the day component will differ.
  const same = ny.year === tokyo.year && ny.month === tokyo.month
    && ny.day === tokyo.day && ny.hour === tokyo.hour && ny.minute === tokyo.minute;
  assert.equal(same, false, 'NY and Tokyo should not share the same wall clock');
});
