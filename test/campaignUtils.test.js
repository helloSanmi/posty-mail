import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkContacts,
  complianceIssues,
  estimateDurationMinutes,
  renderTemplate,
  validateContacts,
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
