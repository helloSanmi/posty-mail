// One-shot cleanup: removes any email from the "Unspecified" audience that
// is already a member of another audience. This restores the invariant that
// "Unspecified" means "in no other group". Counts in the Groups sidebar
// will sum to the total contact count after this runs.
//
// Why: an earlier version of the import flow auto-tagged every contact with
// `group: 'Unspecified'` when the CSV had no group column. Later additions
// to real groups (via patchAudienceMembers, or a re-import with a group
// column) didn't scrub the old Unspecified entry, so contacts ended up
// double-counted.
//
// Usage:
//   node backend/scripts/dedupe-unspecified-group.js --dry   # preview
//   node backend/scripts/dedupe-unspecified-group.js         # apply
//
// Safe to run multiple times. Idempotent.

import { prisma } from '../lib/db.js';

const dryRun = process.argv.includes('--dry');

async function main() {
  const unspecified = await prisma.audience.findFirst({
    where: { name: { equals: 'Unspecified', mode: 'insensitive' } },
  });
  if (!unspecified) {
    console.log('No "Unspecified" audience found. Nothing to do.');
    return;
  }

  // Collect every email that lives in any audience other than Unspecified.
  const otherAudiences = await prisma.audience.findMany({
    where: { id: { not: unspecified.id } },
    select: { name: true, contactEmails: true },
  });
  const inAnotherGroup = new Set();
  for (const a of otherAudiences) {
    for (const email of a.contactEmails || []) inAnotherGroup.add(email);
  }

  const before = unspecified.contactEmails || [];
  const after = before.filter((email) => !inAnotherGroup.has(email));
  const removed = before.length - after.length;

  console.log(`Unspecified members: ${before.length} → ${after.length}  (would remove ${removed})`);
  console.log(`Other audiences referenced ${inAnotherGroup.size} distinct emails.`);

  if (!removed) {
    console.log('Already clean.');
    return;
  }

  if (dryRun) {
    console.log('Dry run. No writes.');
    return;
  }

  await prisma.audience.update({
    where: { id: unspecified.id },
    data: { contactEmails: after },
  });
  console.log(`Updated. Unspecified now holds ${after.length} truly-ungrouped contacts.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
