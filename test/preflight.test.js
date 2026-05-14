// Locks the pre-send checklist so regressions in a single rule don't ship
// silently. Each test names the failing check by code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { runSendChecks } from '../backend/lib/preflight.js';

function template(overrides = {}) {
  return {
    subject: 'Hello there',
    html: '<p>Hi {{firstname}}. <a href="https://example.com">Visit</a></p><p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',
    text: 'Hi {{firstname}}. Visit https://example.com',
    ...overrides,
  };
}

function codes(checks) {
  return checks.map((c) => c.code);
}

test('runSendChecks: a well-formed template returns ok=true with no errors', () => {
  const { ok, checks } = runSendChecks({ template: template() });
  assert.equal(ok, true);
  assert.ok(!checks.some((c) => c.severity === 'error'));
});

test('runSendChecks: missing subject is an error', () => {
  const { ok, checks } = runSendChecks({ template: template({ subject: '' }) });
  assert.equal(ok, false);
  assert.ok(codes(checks).includes('subject_missing'));
});

test('runSendChecks: missing unsubscribe link is an error', () => {
  const html = '<p>No unsub here</p>';
  const text = 'No unsub here either';
  const { ok, checks } = runSendChecks({ template: template({ html, text }) });
  assert.equal(ok, false);
  assert.ok(codes(checks).includes('unsubscribe_missing'));
});

test('runSendChecks: literal /unsubscribe URL also satisfies the unsubscribe check', () => {
  const html = '<p>Hi <a href="https://my.site/unsubscribe?email=x">Unsub</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(!codes(checks).includes('unsubscribe_missing'));
});

test('runSendChecks: Brevo-style {{ unsubscribe }} merge tag satisfies the check', () => {
  const html = '<p><a href="{{ unsubscribe }}">Unsub</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(!codes(checks).includes('unsubscribe_missing'));
});

test('runSendChecks: Brevo namespaced merge tag with filter is NOT flagged as broken', () => {
  // Real-world AI-generated template that Brevo accepts but a strict
  // {{identifier}} check would (falsely) flag.
  const html = '<p>Hi {{ contact.FIRSTNAME|default:\'there\' }}<a href="{{unsubscribeUrl}}">x</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  const hit = checks.find((c) => c.code === 'merge_tag_suspicious');
  assert.equal(hit, undefined, `Expected no merge_tag_suspicious; got: ${JSON.stringify(hit)}`);
});

test('runSendChecks: malformed {{ first name }} (space in identifier) IS flagged', () => {
  // Negative case to make sure we still catch real typos.
  const html = '<p>Hi {{ first name }}<a href="{{unsubscribeUrl}}">x</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(codes(checks).includes('merge_tag_suspicious'));
});

test('runSendChecks: Brevo chained filters {{ x|upper|default:"y" }} are valid', () => {
  const html = '<p>{{ contact.NAME|upper|default:"there" }}<a href="{{unsubscribeUrl}}">x</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(!codes(checks).includes('merge_tag_suspicious'));
});

test('runSendChecks: long subject triggers a warning, not an error', () => {
  const subject = 'a'.repeat(120);
  const { ok, checks } = runSendChecks({ template: template({ subject }) });
  assert.equal(ok, true);
  const hit = checks.find((c) => c.code === 'subject_truncated');
  assert.ok(hit);
  assert.equal(hit.severity, 'warn');
});

test('runSendChecks: SMTP-cap subject (998+) is an error', () => {
  const subject = 'a'.repeat(1100);
  const { ok, checks } = runSendChecks({ template: template({ subject }) });
  assert.equal(ok, false);
  assert.ok(codes(checks).includes('subject_too_long'));
});

test('runSendChecks: all-caps subject flagged', () => {
  const { checks } = runSendChecks({ template: template({ subject: 'BIG NEWS TODAY ONLY' }) });
  assert.ok(codes(checks).includes('subject_caps'));
});

test('runSendChecks: spam phrases in subject flagged', () => {
  const { checks } = runSendChecks({ template: template({ subject: 'Act now for free money!' }) });
  assert.ok(codes(checks).includes('subject_spam_phrases'));
});

test('runSendChecks: repeated !!! in subject flagged', () => {
  const { checks } = runSendChecks({ template: template({ subject: 'Big news!!!' }) });
  assert.ok(codes(checks).includes('subject_punctuation'));
});

test('runSendChecks: HTML over 102KB warns about Gmail clipping', () => {
  const big = '<p>{{unsubscribeUrl}}</p>' + 'x'.repeat(110 * 1024);
  const { checks } = runSendChecks({ template: template({ html: big }) });
  assert.ok(codes(checks).includes('html_too_large'));
});

test('runSendChecks: empty plain text emits an info row (not blocking)', () => {
  const { ok, checks } = runSendChecks({ template: template({ text: '' }) });
  assert.equal(ok, true);
  const hit = checks.find((c) => c.code === 'plain_text_missing');
  assert.ok(hit);
  assert.equal(hit.severity, 'info');
});

test('runSendChecks: image-only email flagged', () => {
  const html = '<img src="https://example.com/banner.png"><a href="{{unsubscribeUrl}}">x</a>';
  const { checks } = runSendChecks({ template: template({ html, text: '' }) });
  assert.ok(codes(checks).includes('image_only'));
});

test('runSendChecks: too many links flagged', () => {
  const links = Array.from({ length: 30 }, (_, i) => `<a href="https://e.com/${i}">L${i}</a>`).join(' ');
  const html = `<p>${links}<a href="{{unsubscribeUrl}}">u</a></p>`;
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(codes(checks).includes('too_many_links'));
});

test('runSendChecks: unreachable image URLs flagged', () => {
  const html = '<p><img src="http://localhost:4010/logo.png"><a href="{{unsubscribeUrl}}">u</a></p>';
  const { checks } = runSendChecks({ template: template({ html }) });
  assert.ok(codes(checks).includes('unreachable_images'));
});

test('runSendChecks: empty html is an error', () => {
  const { ok, checks } = runSendChecks({ template: template({ html: '' }) });
  assert.equal(ok, false);
  assert.ok(codes(checks).includes('html_missing'));
});

test('runSendChecks: never throws on bad input', () => {
  assert.doesNotThrow(() => runSendChecks(null));
  assert.doesNotThrow(() => runSendChecks({}));
  assert.doesNotThrow(() => runSendChecks({ template: null }));
});
