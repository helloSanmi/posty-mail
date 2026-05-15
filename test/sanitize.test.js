import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEmailHtml, sanitizeSubject } from '../backend/lib/sanitize.js';

test('sanitizeEmailHtml strips <script> tags', () => {
  const html = '<p>Hi</p><script>alert(1)</script>';
  const result = sanitizeEmailHtml(html);
  assert.equal(result.includes('<script>'), false);
  assert.equal(result.includes('<p>Hi</p>'), true);
});

test('sanitizeEmailHtml strips javascript: hrefs', () => {
  const html = '<a href="javascript:alert(1)">click</a>';
  const result = sanitizeEmailHtml(html);
  assert.equal(result.includes('javascript:'), false);
});

test('sanitizeEmailHtml strips inline event handlers', () => {
  const html = '<img src="https://example.com/x.png" onerror="alert(1)" alt="x">';
  const result = sanitizeEmailHtml(html);
  assert.equal(result.includes('onerror'), false);
  assert.equal(result.includes('src="https://example.com/x.png"'), true);
});

// Regression for GHSA-rpr9-rxv7-x643 / CVE-2026-44990. sanitize-html <= 2.17.3
// had a default sanitizer bypass where the content of a disallowed <xmp> tag
// was appended unescaped to the output (raw-text element with a special
// case in ontext). Adding 'xmp' to nonTextTags closes the bypass — verify
// that markup smuggled inside <xmp> is fully discarded.
test('sanitizeEmailHtml strips <xmp> wrapper AND its content (CVE-2026-44990)', () => {
  const payloads = [
    '<xmp><script>alert(1)</script></xmp>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<xmp><svg><script>alert(1)</script></svg></xmp>',
  ];
  for (const payload of payloads) {
    const result = sanitizeEmailHtml(payload);
    assert.equal(result.includes('<script>'), false, `<script> survived in: ${payload}`);
    assert.equal(result.includes('onerror'), false, `onerror= survived in: ${payload}`);
    assert.equal(result.includes('alert(1)'), false, `alert payload survived in: ${payload}`);
  }
});

test('sanitizeEmailHtml forces rel="noopener noreferrer" on anchors', () => {
  const html = '<a href="https://example.com">link</a>';
  const result = sanitizeEmailHtml(html);
  assert.match(result, /rel="noopener noreferrer"/);
});

test('sanitizeSubject strips CR/LF (header injection)', () => {
  const result = sanitizeSubject('Hello\r\nBcc: evil@example.com');
  assert.equal(result.includes('\r'), false);
  assert.equal(result.includes('\n'), false);
  assert.equal(result, 'Hello Bcc: evil@example.com');
});

test('sanitizeSubject collapses whitespace and trims', () => {
  assert.equal(sanitizeSubject('  hello   world  '), 'hello world');
});

test('sanitizeSubject caps at 998 chars', () => {
  assert.equal(sanitizeSubject('a'.repeat(2000)).length, 998);
});

test('sanitizeEmailHtml returns empty string for non-string input', () => {
  assert.equal(sanitizeEmailHtml(null), '');
  assert.equal(sanitizeEmailHtml(undefined), '');
  assert.equal(sanitizeEmailHtml(123), '');
});

test('sanitizeEmailHtml preserves inline styles on <a>', () => {
  const html = '<a href="https://example.com" style="background:#4f46e5;color:#fff;padding:12px 24px;">Sign up</a>';
  const result = sanitizeEmailHtml(html);
  assert.match(result, /style="[^"]*background:#4f46e5/);
  assert.match(result, /padding:12px 24px/);
});

test('sanitizeEmailHtml preserves inline styles on <img>, <table>, <td>', () => {
  const html = '<table style="margin:0 auto"><tr><td style="background:#fff" valign="top"><img src="https://example.com/x.png" style="max-width:140px"></td></tr></table>';
  const result = sanitizeEmailHtml(html);
  assert.match(result, /<table style="margin:0 auto"/);
  assert.match(result, /<td style="background:#fff" valign="top"/);
  assert.match(result, /<img[^>]+style="max-width:140px"/);
});

test('sanitizeEmailHtml drops <title> contents (no leakage)', () => {
  const html = '<!DOCTYPE html><html><head><title>Cloud/DevOps Masterclass</title><meta charset="UTF-8"></head><body><p>Hi</p></body></html>';
  const result = sanitizeEmailHtml(html);
  assert.equal(result.includes('Cloud/DevOps Masterclass'), false);
  assert.match(result, /<p>Hi<\/p>/);
});

test('sanitizeEmailHtml does not leave a stack of blank lines from <html>/<head>/<body>', () => {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>X</title>
    <meta charset="UTF-8">
  </head>
  <body>
    <table><tr><td>Hi</td></tr></table>
  </body>
</html>`;
  const result = sanitizeEmailHtml(html);
  // Output must start at the first real tag, not with leading whitespace.
  assert.equal(/^\s/.test(result), false);
  // No run of 3+ consecutive newlines.
  assert.equal(/\n{3,}/.test(result), false);
  assert.match(result, /<table><tr><td>Hi<\/td><\/tr><\/table>/);
});
