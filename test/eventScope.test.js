// Tag-scoping is the only thing keeping foreign Brevo events out of reports.
// Easy to regress. Lock the recognized set in tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isPostyEvent } from '../backend/lib/eventScope.js';

test('isPostyEvent: accepts the canonical posty tag', () => {
  assert.equal(isPostyEvent({ tags: ['posty'] }), true);
});

test('isPostyEvent: accepts the legacy campaign-suite tag', () => {
  assert.equal(isPostyEvent({ tags: ['campaign-suite'] }), true);
});

test('isPostyEvent: accepts the legacy campaign-suite-test tag', () => {
  assert.equal(isPostyEvent({ tags: ['campaign-suite-test'] }), true);
});

test('isPostyEvent: accepts events tagged with campaign:<id>', () => {
  assert.equal(isPostyEvent({ tags: ['campaign:abc-123'] }), true);
});

test('isPostyEvent: accepts events tagged with variant:<id>', () => {
  assert.equal(isPostyEvent({ tags: ['variant:v1'] }), true);
});

test('isPostyEvent: rejects events with no tags', () => {
  assert.equal(isPostyEvent({}), false);
  assert.equal(isPostyEvent({ tags: [] }), false);
});

test('isPostyEvent: rejects foreign tags', () => {
  assert.equal(isPostyEvent({ tags: ['other-app'] }), false);
  assert.equal(isPostyEvent({ tags: ['transactional', 'marketing'] }), false);
});

test('isPostyEvent: handles tag as a JSON-encoded string array (sync API shape)', () => {
  assert.equal(isPostyEvent({ tag: '["posty","campaign:x"]' }), true);
  assert.equal(isPostyEvent({ tag: '["other"]' }), false);
});

test('isPostyEvent: handles tag as a comma-separated string (sync API shape)', () => {
  assert.equal(isPostyEvent({ tag: 'posty,campaign:x' }), true);
  assert.equal(isPostyEvent({ tag: 'other,thing' }), false);
});

test('isPostyEvent: ignores non-string entries safely', () => {
  assert.equal(isPostyEvent({ tags: [null, 42, { not: 'a tag' }, 'posty'] }), true);
  assert.equal(isPostyEvent({ tags: [null, 42, {}] }), false);
});

test('isPostyEvent: handles null / undefined payload', () => {
  assert.equal(isPostyEvent(null), false);
  assert.equal(isPostyEvent(undefined), false);
});
