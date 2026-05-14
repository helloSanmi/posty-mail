// Contact persistence. The Contact table is the source of truth for who
// can be emailed; audiences/segments are filters that index into this set.
//
// `buildContactWhere` is a re-export of the pure rules-to-Prisma translator
// in lib/segmentFilter.js so old call sites that took it from `db.js` keep
// working unchanged after the split.

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

export async function listContacts() {
  const rows = await prisma.contact.findMany({ orderBy: { savedAt: 'desc' } });
  return rows.map(contactFromDb);
}

export async function queryContacts({
  filter = {}, page = 1, pageSize = 50, sort = 'savedAt',
} = {}) {
  const where = filterToWhere(filter);
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

export async function deleteContacts(emails) {
  if (!emails?.length) return 0;
  const result = await prisma.contact.deleteMany({
    where: { email: { in: emails } },
  });
  return result.count;
}

export async function upsertContacts(contacts) {
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
    },
  }));
  await prisma.$transaction(ops);
}
