import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkContacts,
  complianceIssues,
  estimateDurationMinutes,
  renderTemplate,
  validateContacts,
  withPreheader,
} from '../shared/campaignUtils.js';

test('validates contacts and reports duplicates', () => {
  const result = validateContacts([
    { email: 'Avery@example.com', firstname: 'Avery' },
    { email: 'avery@example.com', firstname: 'Duplicate' },
    { email: 'broken', firstname: 'Invalid' },
    { Email: 'sam@example.com', FirstName: 'Sam' },
  ]);

  assert.equal(result.valid.length, 2);
  assert.equal(result.valid[0].email, 'avery@example.com');
  assert.equal(result.invalid.length, 2);
  assert.equal(result.invalid[0].errors[0], 'Duplicate email');
});

test('chunks contacts by configured batch size', () => {
  const contacts = Array.from({ length: 7 }, (_, index) => ({ email: `${index}@example.com` }));
  assert.deepEqual(chunkContacts(contacts, 3).map((batch) => batch.length), [3, 3, 1]);
});

test('renders merge tags from contact fields', () => {
  assert.equal(renderTemplate('Hello {{ firstname }} {{missing}}', { firstname: 'Avery' }), 'Hello Avery ');
});

test('flags missing consent for GDPR contacts', () => {
  const issues = complianceIssues({ email: 'casey@example.com', region: 'DE', consent: '' }, { requireOptIn: true, gdprMode: true });
  assert.equal(issues.length, 2);
});

test('estimates campaign duration from batches and delay', () => {
  assert.equal(estimateDurationMinutes(650, 300, 2), 4);
});

test('withPreheader prepends a hidden div containing the preview text', () => {
  const result = withPreheader('<p>Hi</p>', 'See you tonight');
  assert.match(result, /^<div style="display:none/);
  assert.match(result, /See you tonight<\/div><p>Hi<\/p>$/);
});

test('withPreheader no-ops on empty / whitespace-only preview text', () => {
  assert.equal(withPreheader('<p>Hi</p>', ''), '<p>Hi</p>');
  assert.equal(withPreheader('<p>Hi</p>', '   '), '<p>Hi</p>');
  assert.equal(withPreheader('<p>Hi</p>', null), '<p>Hi</p>');
});

test('withPreheader escapes HTML in the preview text', () => {
  // A <script> in the preview text must not become a live script tag.
  const result = withPreheader('<p>Hi</p>', '<script>alert(1)</script>');
  assert.equal(result.includes('<script>alert(1)</script>'), false);
  assert.match(result, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
