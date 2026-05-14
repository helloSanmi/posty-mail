// Frontend ↔ backend event-name parity.
//
// The UI classifies events (open / click / bounce) using sets in
// src/utils/brevoEvents.js. The backend's metrics pipeline uses parallel sets
// in backend/routes/campaigns.js. If someone adds a new event variant to one
// side without the other, KPIs and the per-campaign metrics endpoint silently
// disagree.
//
// Rather than refactor to share a single source of truth (which would require
// awkward cross-module imports given the UI imports map and backend uses
// node:test), we parse the backend file once and assert the UI is a superset
// of every event name it knows. The UI's superset is allowed — the UI's
// `eventLabel` shows them, and unmatched names fall through to "muted" pills
// gracefully. The dangerous direction is the OTHER way: backend has a new
// variant the UI's classification doesn't know about, so the KPI cards skip it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(
  path.resolve(import.meta.dirname, '../backend/routes/campaigns.js'),
  'utf8',
);
const UI_SOURCE = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/utils/brevoEvents.js'),
  'utf8',
);

function extractSet(name, source) {
  const re = new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([^\\]]+)\\]\\)`);
  const match = source.match(re);
  if (!match) return null;
  // Pull out quoted strings from the captured body.
  const literals = match[1].match(/'[^']+'/g) || [];
  return new Set(literals.map((s) => s.slice(1, -1)));
}

const backendOpen = extractSet('OPEN_EVENTS', SOURCE);
const backendClick = extractSet('CLICK_EVENTS', SOURCE);
const backendBounce = extractSet('BOUNCE_EVENTS_METRICS', SOURCE);

const uiPositive = extractSet('POSITIVE', UI_SOURCE);
const uiNegative = extractSet('NEGATIVE', UI_SOURCE);

test('backend OPEN_EVENTS is non-empty and was parsed', () => {
  assert.ok(backendOpen, 'Could not parse OPEN_EVENTS from backend/routes/campaigns.js');
  assert.ok(backendOpen.size > 0);
});

test('UI POSITIVE set contains every backend open variant', () => {
  for (const name of backendOpen) {
    assert.ok(
      uiPositive.has(name),
      `Backend treats "${name}" as an open, but UI POSITIVE set doesn't know about it. ` +
      `Add it to src/utils/brevoEvents.js POSITIVE + LABELS, or both KPI cards and the ` +
      `activity feed will skip this event type.`,
    );
  }
});

test('UI POSITIVE set contains every backend click variant', () => {
  for (const name of backendClick) {
    assert.ok(
      uiPositive.has(name),
      `Backend treats "${name}" as a click, but UI POSITIVE set doesn't know about it.`,
    );
  }
});

test('UI NEGATIVE set contains every backend bounce variant', () => {
  for (const name of backendBounce) {
    assert.ok(
      uiNegative.has(name),
      `Backend treats "${name}" as a bounce, but UI NEGATIVE set doesn't know about it.`,
    );
  }
});
