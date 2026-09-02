// Deliverability self-check for the sender domain.
//
// Resolves SPF / DKIM / DMARC TXT records and classifies each one as
// 'pass' / 'warn' / 'fail'. Used by the Settings page so admins can see
// (and fix) DNS problems before sending. No write side. Read-only DNS.
//
// Notes on the three records:
//   - SPF lives at the apex domain. Identified by `v=spf1` in any TXT.
//   - DKIM uses a selector. The full record sits at <selector>._domainkey.<domain>.
//     We probe a list of common selectors. anything beyond that is provider-
//     specific and the admin will know their selector if it isn't here.
//   - DMARC always sits at _dmarc.<domain>. Identified by `v=DMARC1`.
//
// DMARC and DKIM tags are matched with whitespace allowed around the `=`,
// which their RFCs permit and real providers emit. SPF's version term does
// not permit it, so that one stays an exact prefix match.

import dns from 'node:dns/promises';

// Common DKIM selectors. Order matters. We stop at the first hit so a domain
// with multiple selectors only reports one. Add more here if you adopt a new
// provider that uses a different selector.
export const DKIM_SELECTORS = [
  'brevo1',   // Brevo (current): CNAMEs to a Brevo-hosted TXT
  'brevo2',   // Brevo (current): second key, rotated alongside brevo1
  'mail',     // Brevo/Sendinblue (legacy) — still live on older domains
  'default',
  'google',   // Google Workspace
  'selector1',
  'selector2',
  'k1',       // Mailchimp / Mandrill
  's1',
  's2',
  'mxvault',
  'brevo',
  'sendgrid',
  'mta',
];

const DNS_TIMEOUT_MS = 4000;

// DMARC (RFC 7489 6.4) and DKIM (RFC 6376 3.2) records are tag-value lists
// where whitespace is permitted around the "=". Brevo publishes DMARC as
// "v=DMARC1; p= quarantine; ..." — valid, and honoured by receivers — which
// a bare /\bp=(none|quarantine|reject)\b/ silently failed to read. That left
// the policy reported as "unspecified", and worse: "p= none" skipped the
// monitor-only branch entirely and reported PASS on a domain enforcing
// nothing. `tag` builds a matcher that tolerates the whitespace the RFCs
// allow.
//
// SPF is deliberately NOT built this way. RFC 7208 defines its version term
// as the literal "v=spf1" with no whitespace inside it, so classifySpf keeps
// its exact prefix check.
function tag(name, value) {
  return new RegExp(`\\b${name}\\s*=\\s*${value}`, 'i');
}

const DMARC_VERSION = tag('v', 'DMARC1\\b');
const DMARC_POLICY = tag('p', '(none|quarantine|reject)\\b');
const DKIM_VERSION = tag('v', 'DKIM1\\b');
const DKIM_KEY = tag('p', '[A-Za-z0-9+/]');

// dns.resolveTxt returns string[][]: one entry per TXT record, each split
// into the 255-byte chunks the wire format uses. Join each record's chunks
// with no separator, matching how resolvers reassemble them. Exported so the
// reassembly is testable without mocking DNS.
export function flattenTxtRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((parts) => (Array.isArray(parts) ? parts.join('') : String(parts ?? '')));
}

// Wrap dns.resolveTxt with a soft timeout. Without it a slow / blackholed
// resolver can hang the request for the full system DNS timeout. The catch
// block downstream treats both "no record" and "timeout" the same (FAIL).
async function resolveTxtFlat(hostname) {
  const promise = dns.resolveTxt(hostname);
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS);
  });
  try {
    const records = await Promise.race([promise, timeout]);
    return flattenTxtRecords(records);
  } finally {
    clearTimeout(timer);
  }
}

// Extract the host part of an email address. Returns null on malformed input
// so the caller can short-circuit with a "configure sender first" message.
export function domainFromEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const idx = email.lastIndexOf('@');
  if (idx < 0 || idx === email.length - 1) return null;
  return email.slice(idx + 1).trim().toLowerCase();
}

// ---- per-record classifiers ---------------------------------------------

export function classifySpf(records) {
  // Match against the trimmed record: resolvers hand back whatever the zone
  // file holds, and a stray leading space would otherwise hide a valid SPF.
  const spfs = records
    .map((record) => (typeof record === 'string' ? record.trim() : ''))
    .filter((record) => record.toLowerCase().startsWith('v=spf1'));
  if (spfs.length === 0) {
    return {
      status: 'fail',
      message: 'No SPF record found.',
      hint: 'Add a TXT record at your apex domain with v=spf1.',
      example: 'v=spf1 include:spf.brevo.com ~all',
    };
  }
  if (spfs.length > 1) {
    return {
      status: 'fail',
      message: 'Multiple SPF records present. Receivers will use the first and may reject the rest.',
      hint: 'Merge into a single TXT containing one v=spf1 declaration.',
      found: spfs,
    };
  }
  const spf = spfs[0];
  // Detect overly-permissive "+all" which effectively disables SPF.
  if (/\s\+all\b/i.test(spf)) {
    return {
      status: 'warn',
      message: 'SPF ends in +all, which permits any sender. That defeats the point of SPF.',
      hint: 'Use -all (hard fail) or ~all (soft fail) at the end of the record.',
      found: spf,
    };
  }
  // ~all is the conservative default; -all is stricter and ideal. Both pass.
  return {
    status: 'pass',
    message: 'SPF record found.',
    found: spf,
  };
}

export function classifyDkim(hits) {
  if (!hits.length) {
    return {
      status: 'fail',
      message: 'No DKIM record found at any common selector.',
      hint: 'Add the DKIM records your sending provider gave you. Brevo uses two, at brevo1._domainkey.<your-domain> and brevo2._domainkey.<your-domain> (older Brevo/Sendinblue domains use mail._domainkey instead).',
    };
  }
  // hits is [{ selector, value }]. Take the first that looks valid.
  const valid = hits.find(({ value }) => DKIM_VERSION.test(value) || DKIM_KEY.test(value));
  if (!valid) {
    return {
      status: 'warn',
      message: 'DKIM record present but malformed.',
      hint: 'The record should include v=DKIM1 and a non-empty p= public key.',
      found: hits[0].value,
      selector: hits[0].selector,
    };
  }
  return {
    status: 'pass',
    message: `DKIM record found at selector "${valid.selector}".`,
    found: valid.value,
    selector: valid.selector,
  };
}

export function classifyDmarc(records) {
  const dmarcs = records.filter((r) => DMARC_VERSION.test(r));
  if (dmarcs.length === 0) {
    return {
      status: 'fail',
      message: 'No DMARC record found.',
      hint: 'Add a TXT record at _dmarc.<your-domain>. Start in monitor mode so legitimate mail isn\'t rejected while you tune SPF/DKIM.',
      example: 'v=DMARC1; p=none; rua=mailto:you@yourdomain.com',
    };
  }
  if (dmarcs.length > 1) {
    return {
      status: 'fail',
      message: 'Multiple DMARC records present. Receivers ignore the policy when this happens.',
      hint: 'Keep exactly one TXT at _dmarc.<your-domain>.',
      found: dmarcs,
    };
  }
  const dmarc = dmarcs[0];
  const policy = dmarc.match(DMARC_POLICY)?.[1]?.toLowerCase();
  if (policy === 'none') {
    return {
      status: 'warn',
      message: 'DMARC policy is p=none (monitor only). Reports are collected but nothing is enforced.',
      hint: 'Once SPF and DKIM are passing, move to p=quarantine, then p=reject for full protection.',
      found: dmarc,
    };
  }
  return {
    status: 'pass',
    message: `DMARC record found with policy p=${policy || 'unspecified'}.`,
    found: dmarc,
  };
}

// ---- orchestration ------------------------------------------------------

export async function checkDeliverability(senderEmail, { selectors = DKIM_SELECTORS } = {}) {
  const domain = domainFromEmail(senderEmail);
  if (!domain) {
    const err = new Error('Sender email is missing or malformed; cannot run deliverability check.');
    err.status = 400;
    throw err;
  }

  // SPF: apex domain TXTs.
  let spf;
  try {
    const apex = await resolveTxtFlat(domain);
    spf = classifySpf(apex);
  } catch (error) {
    spf = { status: 'fail', message: `Could not resolve TXT for ${domain}: ${error.code || error.message}.` };
  }

  // DKIM: probe common selectors in parallel; collect hits.
  const dkimAttempts = await Promise.allSettled(
    selectors.map(async (selector) => {
      const value = await resolveTxtFlat(`${selector}._domainkey.${domain}`);
      return { selector, value: value[0] || '' };
    }),
  );
  const dkimHits = dkimAttempts
    .filter((r) => r.status === 'fulfilled' && r.value.value)
    .map((r) => r.value);
  const dkim = classifyDkim(dkimHits);

  // DMARC: _dmarc.<domain>.
  let dmarc;
  try {
    const records = await resolveTxtFlat(`_dmarc.${domain}`);
    dmarc = classifyDmarc(records);
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      dmarc = classifyDmarc([]);
    } else {
      dmarc = { status: 'fail', message: `Could not resolve TXT for _dmarc.${domain}: ${error.code || error.message}.` };
    }
  }

  return { domain, spf, dkim, dmarc };
}
