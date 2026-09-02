// Classification tests for the deliverability self-check.
//
// DNS itself is hard to mock without bringing in a library, so we don't
// exercise the network code here. Instead, each classifier (classifySpf,
// classifyDkim, classifyDmarc) is a pure function we can test directly with
// the kind of strings DNS resolvers return.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DKIM_SELECTORS,
  classifyDkim,
  classifyDmarc,
  classifySpf,
  domainFromEmail,
  flattenTxtRecords,
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

// ---- SPF parsing regressions --------------------------------------------
//
// These pin the shape dns.resolveTxt actually hands back: an array of
// records, each an array of 255-byte chunks. The apex of a Brevo-verified
// domain carries a provider verification TXT alongside the SPF, and which
// one comes first is not ours to choose — so the SPF must be found wherever
// it sits in the list, and however it happens to be chunked.

test('flattenTxtRecords: joins each record\'s chunks, one string per record', () => {
  assert.deepEqual(
    flattenTxtRecords([['abc', 'def'], ['ghi']]),
    ['abcdef', 'ghi'],
  );
});

test('flattenTxtRecords: tolerates a non-array argument', () => {
  assert.deepEqual(flattenTxtRecords(undefined), []);
  assert.deepEqual(flattenTxtRecords(null), []);
});

test('classifySpf: finds the SPF when it is not the first TXT record', () => {
  // Real apex of bloomnbecome.org.uk: the Brevo verification code sorts
  // ahead of the SPF, and only looking at records[0] reported a false FAIL.
  const apex = flattenTxtRecords([
    ['brevo-code:5a64a70c94308544bbbd8ad4de07f22f'],
    ['v=spf1 include:spf.brevo.com ~all'],
  ]);
  const result = classifySpf(apex);
  assert.equal(result.status, 'pass');
  assert.equal(result.found, 'v=spf1 include:spf.brevo.com ~all');
});

test('classifySpf: finds an SPF split across multiple chunks', () => {
  const apex = flattenTxtRecords([
    ['some-other-verification=xyz'],
    ['v=spf1 include:spf.brevo.com include:_spf.exam', 'ple.com include:mail.example.net ~all'],
  ]);
  const result = classifySpf(apex);
  assert.equal(result.status, 'pass');
  assert.equal(
    result.found,
    'v=spf1 include:spf.brevo.com include:_spf.example.com include:mail.example.net ~all',
  );
});

test('classifySpf: no SPF among several non-SPF records is fail', () => {
  const apex = flattenTxtRecords([
    ['brevo-code:5a64a70c94308544bbbd8ad4de07f22f'],
    ['google-site-verification=abc'],
    ['MS=ms12345678'],
  ]);
  const result = classifySpf(apex);
  assert.equal(result.status, 'fail');
  assert.match(result.message, /No SPF record found/i);
  assert.match(result.example, /^v=spf1/);
});

test('classifySpf: surrounding whitespace does not hide the record', () => {
  const result = classifySpf(['  v=spf1 include:spf.brevo.com ~all  ']);
  assert.equal(result.status, 'pass');
  assert.equal(result.found, 'v=spf1 include:spf.brevo.com ~all');
});

test('classifySpf: matches v=SPF1 case-insensitively', () => {
  assert.equal(classifySpf(['V=SPF1 include:spf.brevo.com ~all']).status, 'pass');
});

// ---- DKIM selector coverage ---------------------------------------------

test('DKIM_SELECTORS: probes the selectors Brevo actually publishes', () => {
  // Brevo publishes two keys, at brevo1._domainkey and brevo2._domainkey.
  // mail._domainkey is the Sendinblue-era selector and stays for old domains.
  assert.ok(DKIM_SELECTORS.includes('brevo1'));
  assert.ok(DKIM_SELECTORS.includes('brevo2'));
  assert.ok(DKIM_SELECTORS.includes('mail'));
});

test('classifyDkim: accepts a chunked Brevo key with no v=DKIM1 tag', () => {
  // Brevo's TXT starts at k=rsa and the key is long enough to be chunked.
  const [value] = flattenTxtRecords([[
    'k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuH2LOIKSuLY',
    '/rmNTUfIPG7iNV4BcI0NO9IbyaniURDlOcRmy7Hy9eoGoIDAQAB',
  ]]);
  const result = classifyDkim([{ selector: 'brevo1', value }]);
  assert.equal(result.status, 'pass');
  assert.equal(result.selector, 'brevo1');
});

// ---- Whitespace around "=" ----------------------------------------------
//
// DMARC (RFC 7489 6.4) and DKIM (RFC 6376 3.2) are tag-value lists that
// permit whitespace around the "=", and providers emit it: Brevo publishes
// "v=DMARC1; p= quarantine; ...". Matching on a bare "p=" read that as no
// policy at all.

test('classifyDmarc: p= quarantine (space after =) is read as quarantine', () => {
  const result = classifyDmarc(['v=DMARC1; p= quarantine; adkim=r; aspf=r; rua=mailto:x@y.com']);
  assert.equal(result.status, 'pass');
  assert.match(result.message, /p=quarantine/);
  assert.doesNotMatch(result.message, /unspecified/);
});

test('classifyDmarc: p= none (space after =) still warns, not passes', () => {
  // The dangerous case. Skipping the monitor-only branch reported PASS on a
  // domain enforcing nothing at all.
  const result = classifyDmarc(['v=DMARC1; p= none; rua=mailto:x@y.com']);
  assert.equal(result.status, 'warn');
  assert.match(result.message, /monitor/i);
});

test('classifyDmarc: whitespace before the = is tolerated too', () => {
  assert.equal(classifyDmarc(['v=DMARC1; p =reject']).status, 'pass');
  assert.equal(classifyDmarc(['v=DMARC1; p = none']).status, 'warn');
});

test('classifyDmarc: a spaced v= tag still identifies the record', () => {
  const result = classifyDmarc(['v = DMARC1; p=reject']);
  assert.equal(result.status, 'pass');
  assert.match(result.message, /p=reject/);
});

test('classifyDmarc: sp= and pct= are not mistaken for the policy', () => {
  // \b keeps "sp=" out, and "pct=" has no "=" straight after the p.
  const result = classifyDmarc(['v=DMARC1; pct=100; sp=reject; p=quarantine']);
  assert.equal(result.status, 'pass');
  assert.match(result.message, /p=quarantine/);
});

test('classifyDkim: a spaced p= key is accepted', () => {
  const result = classifyDkim([{ selector: 'brevo1', value: 'k=rsa; p = MIGfMA0GCSqGSIb3DQ' }]);
  assert.equal(result.status, 'pass');
});

test('classifyDkim: a spaced v= tag is accepted', () => {
  const result = classifyDkim([{ selector: 'mail', value: 'v = DKIM1; k=rsa; p=MIGfMA0' }]);
  assert.equal(result.status, 'pass');
});

test('classifyDkim: still rejects a record with neither tag', () => {
  assert.equal(classifyDkim([{ selector: 'mail', value: 'k = rsa; note = nope' }]).status, 'warn');
});

test('classifySpf: keeps an exact v=spf1 prefix (RFC 7208 allows no space)', () => {
  // Unlike DMARC/DKIM, "v = spf1" is not a valid SPF record and must not
  // start passing as one.
  assert.equal(classifySpf(['v = spf1 include:spf.brevo.com ~all']).status, 'fail');
});
