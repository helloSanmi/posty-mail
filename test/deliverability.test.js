// Classification tests for the deliverability self-check.
//
// DNS itself is hard to mock without bringing in a library, so we don't
// exercise the network code here. Instead, each classifier (classifySpf,
// classifyDkim, classifyDmarc) is a pure function we can test directly with
// the kind of strings DNS resolvers return.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDkim,
  classifyDmarc,
  classifySpf,
  domainFromEmail,
} from '../backend/lib/deliverability.js';

test('domainFromEmail: extracts the host part', () => {
  assert.equal(domainFromEmail('hello@example.com'), 'example.com');
  assert.equal(domainFromEmail('Foo.Bar+tag@Sub.Example.COM'), 'sub.example.com');
});

test('domainFromEmail: returns null for malformed input', () => {
  assert.equal(domainFromEmail(''), null);
  assert.equal(domainFromEmail(null), null);
  assert.equal(domainFromEmail('no-at-sign'), null);
  assert.equal(domainFromEmail('trailing@'), null);
});

test('classifySpf: missing SPF is fail with example record', () => {
  const result = classifySpf([]);
  assert.equal(result.status, 'fail');
  assert.match(result.example, /^v=spf1/);
});

test('classifySpf: standard ~all record passes', () => {
  const result = classifySpf(['v=spf1 include:spf.brevo.com ~all']);
  assert.equal(result.status, 'pass');
});

test('classifySpf: strict -all record passes', () => {
  const result = classifySpf(['v=spf1 include:spf.brevo.com -all']);
  assert.equal(result.status, 'pass');
});

test('classifySpf: +all is flagged as a misconfiguration', () => {
  const result = classifySpf(['v=spf1 include:_spf.example.com +all']);
  assert.equal(result.status, 'warn');
  assert.match(result.message, /\+all/);
});

test('classifySpf: multiple SPF records is fail', () => {
  const result = classifySpf([
    'v=spf1 include:a.com ~all',
    'v=spf1 include:b.com ~all',
  ]);
  assert.equal(result.status, 'fail');
  assert.match(result.message, /Multiple/i);
});

test('classifySpf: ignores non-SPF TXTs', () => {
  const result = classifySpf([
    'google-site-verification=abc',
    'v=spf1 include:spf.brevo.com ~all',
    'misc=value',
  ]);
  assert.equal(result.status, 'pass');
});

test('classifyDkim: no selectors returns fail', () => {
  const result = classifyDkim([]);
  assert.equal(result.status, 'fail');
});

test('classifyDkim: valid v=DKIM1 record passes', () => {
  const result = classifyDkim([
    { selector: 'mail', value: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQ' },
  ]);
  assert.equal(result.status, 'pass');
  assert.equal(result.selector, 'mail');
});

test('classifyDkim: legacy record without v=DKIM1 but with p= still passes', () => {
  const result = classifyDkim([
    { selector: 'mail', value: 'k=rsa; p=MIGfMA0GCSqGSIb3DQ' },
  ]);
  assert.equal(result.status, 'pass');
});

test('classifyDkim: garbage value is flagged as warn', () => {
  const result = classifyDkim([
    { selector: 'mail', value: 'this-is-not-a-dkim-record' },
  ]);
  assert.equal(result.status, 'warn');
});

test('classifyDmarc: missing record is fail with example', () => {
  const result = classifyDmarc([]);
  assert.equal(result.status, 'fail');
  assert.match(result.example, /^v=DMARC1/);
});

test('classifyDmarc: p=none is warn (monitor mode)', () => {
  const result = classifyDmarc(['v=DMARC1; p=none; rua=mailto:rua@example.com']);
  assert.equal(result.status, 'warn');
  assert.match(result.message, /monitor/i);
});

test('classifyDmarc: p=quarantine passes', () => {
  const result = classifyDmarc(['v=DMARC1; p=quarantine; rua=mailto:rua@example.com']);
  assert.equal(result.status, 'pass');
});

test('classifyDmarc: p=reject passes', () => {
  const result = classifyDmarc(['v=DMARC1; p=reject']);
  assert.equal(result.status, 'pass');
});

test('classifyDmarc: multiple DMARC records is fail', () => {
  const result = classifyDmarc([
    'v=DMARC1; p=reject',
    'v=DMARC1; p=none',
  ]);
  assert.equal(result.status, 'fail');
});

test('classifyDmarc: ignores non-DMARC TXTs', () => {
  const result = classifyDmarc([
    'random=value',
    'v=DMARC1; p=quarantine',
  ]);
  assert.equal(result.status, 'pass');
});
