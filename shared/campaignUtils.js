export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Case-insensitive lookup across CSV header variants. Handles `Firstname`,
// `FirstName`, `first_name`, `FIRSTNAME`, etc.. Any capitalization or
// underscoring of the canonical names below.
function pickField(row, ...names) {
  if (!row || typeof row !== 'object') return '';
  const wanted = new Set(names.map((n) => n.toLowerCase().replace(/[_\s-]/g, '')));
  for (const key of Object.keys(row)) {
    const norm = key.toLowerCase().replace(/[_\s-]/g, '');
    if (wanted.has(norm)) {
      const value = row[key];
      if (value != null && String(value).trim() !== '') return String(value);
    }
  }
  return '';
}

export function normalizeContact(row) {
  const email = pickField(row, 'email').trim().toLowerCase();
  const firstname = pickField(row, 'firstname', 'name', 'givenname').trim();
  const lastname = pickField(row, 'lastname', 'surname', 'familyname').trim();
  const consent = pickField(row, 'consent', 'optin').trim().toLowerCase();
  const region = pickField(row, 'region', 'country').trim().toUpperCase();

  return {
    ...row,
    email,
    firstname,
    lastname,
    consent,
    region,
  };
}

export function validateContacts(rows) {
  const seen = new Set();
  const valid = [];
  const invalid = [];

  rows.forEach((row, index) => {
    const contact = normalizeContact(row);
    const errors = [];

    if (!contact.email) errors.push('Missing email');
    if (contact.email && !EMAIL_PATTERN.test(contact.email)) errors.push('Invalid email format');
    if (seen.has(contact.email)) errors.push('Duplicate email');

    if (!errors.length) {
      seen.add(contact.email);
      valid.push(contact);
    } else {
      invalid.push({ row: index + 2, contact, errors });
    }
  });

  return { valid, invalid };
}

export function chunkContacts(contacts, size = 300) {
  const batchSize = Math.max(1, Number(size) || 300);
  const batches = [];

  for (let i = 0; i < contacts.length; i += batchSize) {
    batches.push(contacts.slice(i, i + batchSize));
  }

  return batches;
}

export function renderTemplate(template, contact) {
  return String(template || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((source, part) => source?.[part], contact);
    return value == null || value === '' ? '' : String(value);
  });
}

export function complianceIssues(contact, settings = {}) {
  const issues = [];
  const euRegions = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
    'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
    'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE', 'EU', 'UK', 'GB',
  ]);
  const affirmativeConsent = ['yes', 'true', '1', 'opted-in', 'opted in', 'subscribed'];

  if (settings.requireOptIn && !affirmativeConsent.includes(contact.consent)) {
    issues.push('Missing affirmative opt-in');
  }

  if (settings.gdprMode && euRegions.has(contact.region) && !affirmativeConsent.includes(contact.consent)) {
    issues.push('GDPR contact requires documented consent');
  }

  return issues;
}

export function estimateDurationMinutes(totalContacts, batchSize, delayMinutes) {
  const batches = chunkContacts(Array.from({ length: totalContacts }), batchSize).length;
  return Math.max(0, (batches - 1) * Number(delayMinutes || 0));
}
