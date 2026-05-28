// Contact persistence. The Contact table is the source of truth for who
// can be emailed; audiences/segments are filters that index into this set.
//
// Multi-tenant scoping note: Contact still uses `email` as the global
// primary key in v1 (the migration didn't change PKs). That means two
// accounts can't both have a contact with the same email — a follow-up
// migration will switch to UUID PK + @@unique([accountId, email]).
// Until then, upsertContacts checks for cross-account collisions and
// refuses them rather than overwriting another account's row.
//
// `buildContactWhere` is a re-export of the pure rules-to-Prisma translator
// in lib/segmentFilter.js. The translator itself doesn't know about
// accounts; callers MUST AND it with `{ accountId }` at the query site.

import { filterToWhere } from '../segmentFilter.js';
import { prisma } from './prisma.js';

export { filterToWhere as buildContactWhere };

export function contactFromDb(contact) {
  return {
    ...(contact.data || {}),
    email: contact.email,
    firstname: contact.firstname || '',
    lastname: contact.lastname || '',
    consent: contact.consent || '',
    region: contact.region || '',
    timezone: contact.timezone || '',
    savedAt: contact.savedAt?.toISOString?.() || contact.savedAt,
    updatedAt: contact.updatedAt?.toISOString?.() || contact.updatedAt,
  };
}

export async function listContacts(accountId) {
  const rows = await prisma.contact.findMany({
    where: { accountId },
    orderBy: { savedAt: 'desc' },
  });
  return rows.map(contactFromDb);
}

export async function queryContacts({
  accountId,
  filter = {},
  page = 1,
  pageSize = 50,
  sort = 'savedAt',
} = {}) {
  // Tenant scope ALWAYS first — combine with the filter's own where so
  // an attacker-crafted filter can't widen the search past their account.
  const where = { AND: [{ accountId }, filterToWhere(filter)] };
  const safePageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);

  const [rows, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      orderBy: {
        [sort === 'email' ? 'email' : 'savedAt']: sort === 'email' ? 'asc' : 'desc',
      },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.contact.count({ where }),
  ]);

  return {
    rows: rows.map(contactFromDb),
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function deleteContacts(accountId, emails) {
  if (!emails?.length) return 0;
  // Delete only this account's contacts even if the email exists in
  // another account too. Prevents one tenant from nuking another's row.
  const result = await prisma.contact.deleteMany({
    where: { email: { in: emails }, accountId },
  });
  return result.count;
}

export async function upsertContacts(accountId, contacts) {
  // Pre-flight check: any email already claimed by a DIFFERENT account?
  // If so, fail fast with a clear error — the v1 schema can't hold the
  // same email in two accounts. Once Contact moves to a composite key,
  // this guard goes away.
  const emails = contacts.map((c) => c.email);
  const conflicts = await prisma.contact.findMany({
    where: { email: { in: emails }, NOT: { accountId } },
    select: { email: true },
  });
  if (conflicts.length) {
    const first = conflicts[0].email;
    const error = new Error(
      `${conflicts.length === 1 ? first : `${conflicts.length} emails`} already exist in another workspace. `
      + 'Email addresses are globally unique in this version — re-import will be supported when contact storage moves to per-account keys.',
    );
    error.status = 409;
    throw error;
  }

  const ops = contacts.map((contact) => prisma.contact.upsert({
    where: { email: contact.email },
    create: {
      email: contact.email,
      firstname: contact.firstname || '',
      lastname: contact.lastname || '',
      // Default consent to "yes" when the CSV / payload has no value. The
      // compliance gate in shared/campaignUtils.js treats "yes" as
      // affirmative opt-in, so new imports won't be held back by
      // `requireOptIn`. On UPDATE we only fill in the default for empty
      // values. Never overwrite a real value the row already has.
      consent: contact.consent || 'yes',
      region: contact.region || '',
      // Timezone is opt-in. IANA string ('America/New_York'). Empty means
      // unknown and the scheduler treats it as UTC. Never overwrite a
      // stored timezone with empty on UPDATE.
      ...(contact.timezone ? { timezone: contact.timezone } : {}),
      data: contact,
      accountId,
    },
    update: {
      firstname: contact.firstname || '',
      lastname: contact.lastname || '',
      // Only set consent when the incoming row actually has a value. If
      // consent is missing on the new payload, leave the stored value
      // alone. Re-importing a CSV with no consent column will not
      // silently re-opt-in someone who said "no".
      ...(contact.consent ? { consent: contact.consent } : {}),
      region: contact.region || '',
      ...(contact.timezone ? { timezone: contact.timezone } : {}),
      data: contact,
      // accountId intentionally NOT updated. If the row exists, it
      // already passed the conflict check above, meaning it belongs to
      // THIS account — leaving accountId alone is the no-op safe path.
    },
  }));
  await prisma.$transaction(ops);
}
