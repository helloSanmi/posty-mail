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
  const valid = hits.find(({ value }) => /v=DKIM1/i.test(value) || /\bp=[A-Za-z0-9+/]/.test(value));
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
  const dmarcs = records.filter((r) => /v=DMARC1/i.test(r));
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
  const policy = dmarc.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
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
