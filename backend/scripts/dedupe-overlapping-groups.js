// One-shot cleanup: collapses contact-in-multiple-groups overlap so each
// contact ends up in exactly one named group. Default rule: keep them in the
// most recently created audience (latest `createdAt`), drop from older ones.
//
// Skips the "Unspecified" audience entirely — that one is handled by
// dedupe-unspecified-group.js and represents "in no other group."
//
// Usage:
//   node backend/scripts/dedupe-overlapping-groups.js --dry          # preview, latest-wins (default)
//   node backend/scripts/dedupe-overlapping-groups.js                # apply, latest-wins
//   node backend/scripts/dedupe-overlapping-groups.js --keep first   # apply, oldest-wins
//
// Idempotent. Safe to re-run.

import { prisma } from '../lib/db.js';

const dryRun = process.argv.includes('--dry');
const keepArgIndex = process.argv.indexOf('--keep');
const keep = keepArgIndex !== -1 ? process.argv[keepArgIndex + 1] : 'last';
if (!['first', 'last'].includes(keep)) {
  console.error(`--keep must be "first" or "last" (got "${keep}")`);
  process.exit(1);
}

async function main() {
  // Order audiences by createdAt so the first / last entry in each email's
  // membership list maps to oldest / newest.
  const all = await prisma.audience.findMany({ orderBy: { createdAt: 'asc' } });
  const named = all.filter((a) => a.name?.toLowerCase() !== 'unspecified');

  // For each email, collect the list of named-audience ids it belongs to,
  // in createdAt order (oldest → newest).
  const memberships = new Map(); // email -> [audience, audience, ...]
  for (const audience of named) {
    for (const email of audience.contactEmails || []) {
      if (!memberships.has(email)) memberships.set(email, []);
      memberships.get(email).push(audience);
    }
  }

  // Decide who to remove from where.
  // For each email with multiple memberships: keep one, remove from the rest.
  const removalsByAudience = new Map(); // audienceId -> Set<email>
  let conflicts = 0;
  for (const [email, audiences] of memberships) {
    if (audiences.length < 2) continue;
    conflicts += 1;
    const keeper = keep === 'last' ? audiences[audiences.length - 1] : audiences[0];
    for (const audience of audiences) {
      if (audience.id === keeper.id) continue;
      if (!removalsByAudience.has(audience.id)) removalsByAudience.set(audience.id, new Set());
      removalsByAudience.get(audience.id).add(email);
    }
  }

  console.log(`Inspected ${named.length} named audience(s). ${conflicts} contact(s) appeared in 2+ groups.`);
  console.log(`Rule: keep ${keep === 'last' ? 'most recently created' : 'oldest'} membership.\n`);

  if (!removalsByAudience.size) {
    console.log('Nothing to clean up.');
    return;
  }

  for (const audience of named) {
    const toRemove = removalsByAudience.get(audience.id);
    if (!toRemove?.size) continue;
    const before = audience.contactEmails || [];
    const after = before.filter((email) => !toRemove.has(email));
    console.log(`${audience.name.padEnd(28)} ${before.length} → ${after.length}  (-${toRemove.size})`);
    if (dryRun) continue;
    await prisma.audience.update({
      where: { id: audience.id },
      data: { contactEmails: after },
    });
  }

  if (dryRun) {
    console.log('\nDry run — no writes.');
  } else {
    console.log('\nDone.');
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
