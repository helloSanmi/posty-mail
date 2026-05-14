// Pure rules-to-Prisma-WHERE translator. Lives outside db.js so it can be
// unit-tested without spinning up Prisma. The translator stays
// backward-compatible: any segment saved against the old flat-filter shape
// (`{ search, region, consent, excludeUnsubscribed }`) still works.
//
// New richer shape:
//   {
//     // legacy single-field shortcuts (still respected)
//     search?: string,                     // matches email/firstname/lastname
//     region?: string,
//     consent?: string,
//     excludeUnsubscribed?: boolean,
//
//     // new rules array. Each rule operates on a Contact field.
//     rules?: Array<{
//       field: 'email' | 'firstname' | 'lastname' | 'region' | 'consent',
//       op: 'equals' | 'not_equals' | 'contains' | 'not_contains'
//          | 'is_empty' | 'is_not_empty',
//       value?: string,
//     }>,
//     combinator?: 'AND' | 'OR',           // how to combine rules. default AND.
//
//     // date filters on Contact.savedAt
//     addedAfter?: string,                 // ISO date
//     addedBefore?: string,                // ISO date
//
//     // group-membership filter (any-of-these-groups). Resolved by the
//     // caller, who passes the matching emails in `_inAnyGroupEmails`
//     // because we don't want to import Prisma here.
//     inAnyGroup?: string[],               // ignored by this fn directly
//   }
//
// The function returns a Prisma-compatible `where` object. Composition with
// the unsubscribed-exclusion is done via `_unsubscribedEmails` (a list passed
// in by the caller). Same pattern as before. just keeps this module pure.

export const RULE_FIELDS = new Set([
  'email',
  'firstname',
  'lastname',
  'region',
  'consent',
]);

export const RULE_OPS = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
]);

function ruleToWhere(rule) {
  if (!rule || !RULE_FIELDS.has(rule.field) || !RULE_OPS.has(rule.op)) return null;
  const field = rule.field;
  const value = String(rule.value ?? '').trim();
  switch (rule.op) {
    case 'equals':
      if (!value) return null; // empty value → ignore rule, don't match all
      return { [field]: { equals: value, mode: 'insensitive' } };
    case 'not_equals':
      if (!value) return null;
      return { NOT: { [field]: { equals: value, mode: 'insensitive' } } };
    case 'contains':
      if (!value) return null;
      return { [field]: { contains: value, mode: 'insensitive' } };
    case 'not_contains':
      if (!value) return null;
      return { NOT: { [field]: { contains: value, mode: 'insensitive' } } };
    case 'is_empty':
      // Empty string or null both count as "empty" for our purposes.
      return { OR: [{ [field]: null }, { [field]: '' }] };
    case 'is_not_empty':
      return { AND: [{ [field]: { not: null } }, { [field]: { not: '' } }] };
    default:
      return null;
  }
}

export function filterToWhere(filter = {}) {
  if (!filter || typeof filter !== 'object') return {};

  const conjuncts = []; // pieces that always AND together at the top level

  // ---- legacy shortcuts ------------------------------------------------
  const search = filter.search?.trim?.();
  if (search) {
    conjuncts.push({
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { firstname: { contains: search, mode: 'insensitive' } },
        { lastname: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  const region = filter.region?.trim?.();
  if (region) conjuncts.push({ region: { equals: region, mode: 'insensitive' } });
  const consent = filter.consent?.trim?.();
  if (consent) conjuncts.push({ consent: { equals: consent, mode: 'insensitive' } });

  // ---- rules array -----------------------------------------------------
  if (Array.isArray(filter.rules) && filter.rules.length) {
    const compiled = filter.rules
      .map(ruleToWhere)
      .filter(Boolean);
    if (compiled.length) {
      const combinator = filter.combinator === 'OR' ? 'OR' : 'AND';
      conjuncts.push(compiled.length === 1 ? compiled[0] : { [combinator]: compiled });
    }
  }

  // ---- date range on savedAt ------------------------------------------
  const addedAfter = parseDate(filter.addedAfter);
  const addedBefore = parseDate(filter.addedBefore);
  if (addedAfter || addedBefore) {
    const savedAt = {};
    if (addedAfter) savedAt.gte = addedAfter;
    if (addedBefore) savedAt.lte = addedBefore;
    conjuncts.push({ savedAt });
  }

  // ---- inAnyGroup (handled via the caller-resolved email list) ---------
  // The caller resolves group ids to emails (one Prisma trip) and passes
  // them in via _inAnyGroupEmails. We splice those in as an extra IN clause.
  if (Array.isArray(filter._inAnyGroupEmails)) {
    conjuncts.push({ email: { in: filter._inAnyGroupEmails } });
  }

  // ---- unsubscribed exclusion -----------------------------------------
  if (filter.excludeUnsubscribed && Array.isArray(filter._unsubscribedEmails)) {
    conjuncts.push({ email: { notIn: filter._unsubscribedEmails } });
  }

  if (!conjuncts.length) return {};
  if (conjuncts.length === 1) return conjuncts[0];
  return { AND: conjuncts };
}

// Permissive YYYY-MM-DD / ISO parser. Returns a Date or null. We accept both
// "2026-05-12" (date-only) and full ISO strings, since the React date picker
// emits the former.
function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
