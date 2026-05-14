// Locks the rules → Prisma WHERE translator. Each test names the input shape
// and asserts on the structural output. We don't run anything against a real
// Prisma client. just verify the shape so a regression here surfaces fast.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterToWhere } from '../backend/lib/segmentFilter.js';

test('filterToWhere: empty filter is empty WHERE', () => {
  assert.deepEqual(filterToWhere({}), {});
  assert.deepEqual(filterToWhere(null), {});
});

test('filterToWhere: legacy search becomes an OR across email/firstname/lastname', () => {
  const where = filterToWhere({ search: 'alex' });
  assert.deepEqual(where, {
    OR: [
      { email: { contains: 'alex', mode: 'insensitive' } },
      { firstname: { contains: 'alex', mode: 'insensitive' } },
      { lastname: { contains: 'alex', mode: 'insensitive' } },
    ],
  });
});

test('filterToWhere: legacy region + consent are case-insensitive equals', () => {
  const where = filterToWhere({ region: 'US', consent: 'yes' });
  assert.deepEqual(where, {
    AND: [
      { region: { equals: 'US', mode: 'insensitive' } },
      { consent: { equals: 'yes', mode: 'insensitive' } },
    ],
  });
});

test('filterToWhere: single rule (contains)', () => {
  const where = filterToWhere({
    rules: [{ field: 'email', op: 'contains', value: 'gmail' }],
  });
  assert.deepEqual(where, { email: { contains: 'gmail', mode: 'insensitive' } });
});

test('filterToWhere: AND combinator across two rules', () => {
  const where = filterToWhere({
    rules: [
      { field: 'firstname', op: 'equals', value: 'Alex' },
      { field: 'region', op: 'equals', value: 'US' },
    ],
    combinator: 'AND',
  });
  assert.deepEqual(where, {
    AND: [
      { firstname: { equals: 'Alex', mode: 'insensitive' } },
      { region: { equals: 'US', mode: 'insensitive' } },
    ],
  });
});

test('filterToWhere: OR combinator across two rules', () => {
  const where = filterToWhere({
    rules: [
      { field: 'region', op: 'equals', value: 'US' },
      { field: 'region', op: 'equals', value: 'CA' },
    ],
    combinator: 'OR',
  });
  assert.deepEqual(where, {
    OR: [
      { region: { equals: 'US', mode: 'insensitive' } },
      { region: { equals: 'CA', mode: 'insensitive' } },
    ],
  });
});

test('filterToWhere: is_empty matches null OR empty string', () => {
  const where = filterToWhere({
    rules: [{ field: 'firstname', op: 'is_empty' }],
  });
  assert.deepEqual(where, {
    OR: [{ firstname: null }, { firstname: '' }],
  });
});

test('filterToWhere: is_not_empty matches non-null AND non-empty', () => {
  const where = filterToWhere({
    rules: [{ field: 'firstname', op: 'is_not_empty' }],
  });
  assert.deepEqual(where, {
    AND: [{ firstname: { not: null } }, { firstname: { not: '' } }],
  });
});

test('filterToWhere: not_contains becomes NOT contains', () => {
  const where = filterToWhere({
    rules: [{ field: 'email', op: 'not_contains', value: 'test' }],
  });
  assert.deepEqual(where, {
    NOT: { email: { contains: 'test', mode: 'insensitive' } },
  });
});

test('filterToWhere: rule with empty value (and an op that needs one) is ignored', () => {
  const where = filterToWhere({
    rules: [
      { field: 'email', op: 'contains', value: '' },
      { field: 'firstname', op: 'is_not_empty' },
    ],
  });
  // The empty-value rule is dropped; only the is_not_empty rule remains.
  assert.deepEqual(where, {
    AND: [{ firstname: { not: null } }, { firstname: { not: '' } }],
  });
});

test('filterToWhere: rejects unknown field and unknown op', () => {
  const where = filterToWhere({
    rules: [
      { field: 'ssn', op: 'equals', value: '123' },
      { field: 'email', op: 'matches_regex', value: '.+' },
    ],
  });
  assert.deepEqual(where, {});
});

test('filterToWhere: date range on savedAt', () => {
  const where = filterToWhere({
    addedAfter: '2026-01-01',
    addedBefore: '2026-12-31',
  });
  assert.ok(where.savedAt);
  assert.ok(where.savedAt.gte instanceof Date);
  assert.ok(where.savedAt.lte instanceof Date);
});

test('filterToWhere: invalid date strings are ignored, not errors', () => {
  const where = filterToWhere({ addedAfter: 'not-a-date' });
  assert.deepEqual(where, {});
});

test('filterToWhere: legacy + new rules combine with top-level AND', () => {
  const where = filterToWhere({
    search: 'alex',
    rules: [{ field: 'region', op: 'equals', value: 'US' }],
  });
  assert.equal(Array.isArray(where.AND), true);
  assert.equal(where.AND.length, 2);
});

test('filterToWhere: inAnyGroup is pre-resolved to email list via _inAnyGroupEmails', () => {
  const where = filterToWhere({
    _inAnyGroupEmails: ['a@x.com', 'b@x.com'],
  });
  assert.deepEqual(where, { email: { in: ['a@x.com', 'b@x.com'] } });
});

test('filterToWhere: excludeUnsubscribed only kicks in when _unsubscribedEmails is provided', () => {
  // Without the resolved list, the flag is a no-op (no leak of "everyone").
  assert.deepEqual(filterToWhere({ excludeUnsubscribed: true }), {});
  // With the list, the WHERE excludes them.
  assert.deepEqual(
    filterToWhere({ excludeUnsubscribed: true, _unsubscribedEmails: ['x@x.com'] }),
    { email: { notIn: ['x@x.com'] } },
  );
});
