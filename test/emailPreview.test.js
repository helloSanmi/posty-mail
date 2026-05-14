// Locks the preview document and merge helper. Each test names the property
// it's checking so a regression points at the right rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_PREVIEW_CONTACT,
  buildEmailPreviewDocument,
  mergePreview,
} from '../src/utils/emailPreview.js';

test('mergePreview: substitutes a known field', () => {
  assert.equal(mergePreview('Hi {{firstname}}', { firstname: 'Alex' }), 'Hi Alex');
});

test('mergePreview: tolerates whitespace inside braces', () => {
  assert.equal(mergePreview('Hi {{ firstname }}', { firstname: 'Alex' }), 'Hi Alex');
});

test('mergePreview: unknown fields render as empty', () => {
  assert.equal(mergePreview('Hi {{unknown}}', {}), 'Hi ');
});

test('mergePreview: defaults to SAMPLE_PREVIEW_CONTACT when no contact passed', () => {
  const result = mergePreview('Hello {{firstname}} {{lastname}}');
  assert.equal(result, `Hello ${SAMPLE_PREVIEW_CONTACT.firstname} ${SAMPLE_PREVIEW_CONTACT.lastname}`);
});

test('mergePreview: non-string input returns empty', () => {
  assert.equal(mergePreview(null), '');
  assert.equal(mergePreview(undefined), '');
  assert.equal(mergePreview(42), '');
});

test('mergePreview: ignores text that looks like a tag but is incomplete', () => {
  // No double-brace closer. Leave as-is.
  assert.equal(mergePreview('Hi {firstname}', { firstname: 'X' }), 'Hi {firstname}');
});

test('buildEmailPreviewDocument: produces a complete HTML doc with the body inlined', () => {
  const html = '<p>Body</p>';
  const doc = buildEmailPreviewDocument(html, 'gmail');
  assert.match(doc, /^<!doctype html>/i);
  assert.match(doc, /email-client-shell/);
  assert.match(doc, /<p>Body<\/p>/);
});

test('buildEmailPreviewDocument: gmail vs outlook produce different chrome', () => {
  const gmail = buildEmailPreviewDocument('<p>x</p>', 'gmail');
  const outlook = buildEmailPreviewDocument('<p>x</p>', 'outlook');
  assert.notEqual(gmail, outlook);
  assert.match(gmail, /#f1f3f4/); // gmail background
  assert.match(outlook, /#f3f6fb/); // outlook background
});

test('buildEmailPreviewDocument: dark mode swaps the chrome background', () => {
  const light = buildEmailPreviewDocument('<p>x</p>', 'gmail');
  const dark = buildEmailPreviewDocument('<p>x</p>', 'gmail', { dark: true });
  assert.notEqual(light, dark);
  assert.match(dark, /#202124/); // gmail dark background
  // Message itself stays unchanged.
  assert.match(dark, /<p>x<\/p>/);
});

test('buildEmailPreviewDocument: unknown client falls back to gmail chrome', () => {
  const fallback = buildEmailPreviewDocument('<p>x</p>', 'not-a-client');
  const gmail = buildEmailPreviewDocument('<p>x</p>', 'gmail');
  assert.equal(fallback, gmail);
});
