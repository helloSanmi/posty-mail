// One-shot cleanup: deletes Event rows for emails NOT sent by Posty.
//
// Background: until eventScope.js landed, the webhook handler and the catch-up
// sync ingested every event Brevo emitted for the account, including events
// for emails sent by other systems on the same API key (or sent manually from
// Brevo's UI). Those rows now pollute reports / dashboards.
//
// This script applies the same isPostyEvent filter retroactively and deletes
// anything that doesn't pass.
//
// Usage:
//   node backend/scripts/purge-foreign-events.js [--dry]
//     --dry   print what would be deleted, without writing
//
// Safe to run multiple times: idempotent once foreign rows are gone.

import { prisma } from '../lib/db.js';
import { isPostyEvent } from '../lib/eventScope.js';

const dryRun = process.argv.includes('--dry');

async function main() {
  const events = await prisma.event.findMany({
    select: { id: true, payload: true, receivedAt: true },
  });

  const foreignIds = [];
  let kept = 0;
  for (const row of events) {
    if (isPostyEvent(row.payload)) {
      kept += 1;
    } else {
      foreignIds.push(row.id);
    }
  }

  console.log(`Total events: ${events.length}`);
  console.log(`Posty-tagged: ${kept}`);
  console.log(`Foreign (would delete): ${foreignIds.length}`);

  if (!foreignIds.length) {
    console.log('Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('--dry: not deleting. Re-run without --dry to apply.');
    return;
  }

  // Chunked delete so a huge backlog doesn't hit Postgres parameter limits.
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < foreignIds.length; i += BATCH) {
    const slice = foreignIds.slice(i, i + BATCH);
    const result = await prisma.event.deleteMany({ where: { id: { in: slice } } });
    deleted += result.count;
  }
  console.log(`Deleted ${deleted} foreign event row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
