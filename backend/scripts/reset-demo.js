// One-shot reset for a public demo instance.
//
// Wipes the user-facing tables and reseeds with a small, realistic data set:
// ~30 contacts in 3 groups, a saved segment, one completed campaign with a
// handful of fake engagement events, two custom templates.
//
// Intended cadence: hourly cron on the demo host. Run via:
//   node backend/scripts/reset-demo.js
//
// SAFETY: refuses to run unless `DEMO_MODE=1` is set in the environment. This
// is deliberately strict so an admin can't fat-finger this against a real
// install. Auth users (`User` table) are NOT wiped; the demo admin account
// stays intact across resets so visitors can sign in.

import crypto from 'node:crypto';
import { prisma } from '../lib/db.js';

if (process.env.DEMO_MODE !== '1' && process.env.DEMO_MODE !== 'true') {
  console.error('Refusing to run. Set DEMO_MODE=1 to confirm this is a demo instance.');
  process.exit(1);
}

const FIRST_NAMES = ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Avery', 'Quinn', 'Reese', 'Sage', 'Drew', 'Morgan', 'Taylor'];
const LAST_NAMES = ['Lee', 'Chen', 'Patel', 'Kim', 'Garcia', 'Singh', 'Cohen', 'Nguyen', 'Hassan', 'Müller', 'Sato', 'Ali'];
const REGIONS = ['US', 'UK', 'NG', 'CA', 'AU'];

function makeContacts(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[i % LAST_NAMES.length];
    const email = `${first.toLowerCase()}.${last.toLowerCase()}+${i + 1}@example.com`;
    out.push({
      email,
      firstname: first,
      lastname: last,
      region: REGIONS[i % REGIONS.length],
      consent: 'yes',
    });
  }
  return out;
}

async function main() {
  console.log('Wiping demo data…');
  // Order matters: clear leaves before their references.
  await prisma.event.deleteMany({});
  await prisma.campaignSend.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.draft.deleteMany({});
  await prisma.unsubscribe.deleteMany({});
  await prisma.segment.deleteMany({});
  await prisma.audience.deleteMany({});
  await prisma.contact.deleteMany({});
  // Keep User rows (the demo admin signs in across resets) and keep Setting
  // (sender config, hidden built-ins) so each reset doesn't re-prompt setup.
  // If a demo install wants those wiped too, add prisma.user.deleteMany() and
  // prisma.setting.deleteMany() here.

  console.log('Seeding contacts…');
  const contacts = makeContacts(30);
  await prisma.contact.createMany({ data: contacts });

  console.log('Seeding groups…');
  const groups = [
    { id: crypto.randomUUID(), name: 'Newsletter subscribers', emails: contacts.slice(0, 18).map((c) => c.email) },
    { id: crypto.randomUUID(), name: 'VIP customers', emails: contacts.slice(0, 6).map((c) => c.email) },
    { id: crypto.randomUUID(), name: 'Beta testers', emails: contacts.slice(18, 26).map((c) => c.email) },
  ];
  for (const group of groups) {
    await prisma.audience.create({
      data: { id: group.id, name: group.name, contactEmails: group.emails },
    });
  }

  console.log('Seeding segment…');
  await prisma.segment.create({
    data: {
      id: crypto.randomUUID(),
      name: 'US subscribers',
      filter: {
        rules: [{ field: 'region', op: 'equals', value: 'US' }],
        combinator: 'AND',
        excludeUnsubscribed: true,
      },
    },
  });

  console.log('Seeding a completed campaign with engagement events…');
  const campaignId = crypto.randomUUID();
  const sentAt = new Date(Date.now() - 6 * 60 * 60 * 1000);
  await prisma.campaign.create({
    data: {
      id: campaignId,
      name: 'Demo: Welcome to Posty',
      status: 'completed',
      createdAt: sentAt,
      scheduledAt: sentAt,
      data: {
        contacts: contacts.slice(0, 20),
        template: {
          subject: 'Welcome to Posty',
          html: '<p>Hi {{firstname}}, thanks for trying the demo.</p>',
          text: 'Hi {{firstname}}, thanks for trying the demo.',
        },
        progress: { sent: 20, failed: 0, skipped: 0, currentBatch: 1, totalBatches: 1 },
        schedule: { frequency: 'once' },
        sender: { email: 'demo@posty.dev', name: 'Posty Demo' },
      },
    },
  });
  // Fake events: 12 opens, 5 clicks against the same campaign.
  const fakeEvents = [];
  for (let i = 0; i < 12; i += 1) {
    fakeEvents.push({
      provider: 'brevo',
      payload: {
        event: 'opened',
        email: contacts[i].email,
        tags: ['posty', `campaign:${campaignId}`],
        date: new Date(sentAt.getTime() + i * 60_000).toISOString(),
      },
      receivedAt: new Date(sentAt.getTime() + i * 60_000),
    });
  }
  for (let i = 0; i < 5; i += 1) {
    fakeEvents.push({
      provider: 'brevo',
      payload: {
        event: 'clicked',
        email: contacts[i].email,
        link: 'https://example.com',
        tags: ['posty', `campaign:${campaignId}`],
        date: new Date(sentAt.getTime() + (i + 5) * 60_000).toISOString(),
      },
      receivedAt: new Date(sentAt.getTime() + (i + 5) * 60_000),
    });
  }
  await prisma.event.createMany({ data: fakeEvents });

  console.log('Done. Reset complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
