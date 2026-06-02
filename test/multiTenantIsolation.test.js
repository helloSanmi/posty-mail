// Cross-account data isolation — the load-bearing test for multi-tenancy.
//
// Creates two throwaway accounts (A and B), seeds each with its own
// contacts / campaigns / segments / templates / drafts / audiences via the
// real db helpers, then asserts that every read scoped to A excludes B's
// rows and vice versa. A single un-scoped query anywhere would surface
// here as one account seeing another's data.
//
// This is an INTEGRATION test — it hits a real Postgres via the actual
// Prisma client. It creates its own accounts with random UUID ids and
// tears them down with a cascade delete in the `after` hook, so it never
// touches the 'default' workspace or any real data. If no database is
// reachable (CI without Postgres, a fresh clone before `db:migrate`), the
// whole suite skips cleanly instead of failing.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

const db = await import('../backend/lib/db.js');
const {
  prisma,
  listContacts,
  queryContacts,
  upsertContacts,
  listCampaigns,
  getCampaign,
  upsertCampaign,
  listSegments,
  upsertSegment,
  deleteSegment,
  listTemplates,
  upsertTemplate,
  deleteTemplate,
  listDrafts,
  upsertDraft,
  listAudiences,
  getAudience,
  upsertAudience,
} = db;

// Probe the database once. If it's unreachable, register a single skipped
// test so the run stays green without Postgres.
let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

// Unique ids per run so parallel / repeated runs never collide.
const run = crypto.randomUUID().slice(0, 8);
const ACCOUNT_A = `iso-a-${run}`;
const ACCOUNT_B = `iso-b-${run}`;
const emailA = `iso-a-${run}@example.com`;
const emailB = `iso-b-${run}@example.com`;
const ids = {
  campA: crypto.randomUUID(),
  campB: crypto.randomUUID(),
  segA: crypto.randomUUID(),
  segB: crypto.randomUUID(),
  tplA: `custom-${crypto.randomUUID()}`,
  tplB: `custom-${crypto.randomUUID()}`,
  draftA: crypto.randomUUID(),
  draftB: crypto.randomUUID(),
  audA: crypto.randomUUID(),
  audB: crypto.randomUUID(),
};

describe('multi-tenant data isolation', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    await prisma.account.create({ data: { id: ACCOUNT_A, name: 'ISO Test A' } });
    await prisma.account.create({ data: { id: ACCOUNT_B, name: 'ISO Test B' } });

    // Seed both accounts through the real helpers — the same code paths
    // the routes use — so the test exercises actual scoping, not a mock.
    await upsertContacts(ACCOUNT_A, [{ email: emailA, firstname: 'Ada' }]);
    await upsertContacts(ACCOUNT_B, [{ email: emailB, firstname: 'Bob' }]);

    await upsertCampaign(ACCOUNT_A, { id: ids.campA, name: 'A campaign', status: 'scheduled' });
    await upsertCampaign(ACCOUNT_B, { id: ids.campB, name: 'B campaign', status: 'scheduled' });

    await upsertSegment(ACCOUNT_A, { id: ids.segA, name: 'A segment', filter: {} });
    await upsertSegment(ACCOUNT_B, { id: ids.segB, name: 'B segment', filter: {} });

    const tpl = { subject: 's', html: '<p>h</p>', text: 't' };
    await upsertTemplate(ACCOUNT_A, { id: ids.tplA, name: 'A template', ...tpl });
    await upsertTemplate(ACCOUNT_B, { id: ids.tplB, name: 'B template', ...tpl });

    await upsertDraft(ACCOUNT_A, { id: ids.draftA, name: 'A draft' });
    await upsertDraft(ACCOUNT_B, { id: ids.draftB, name: 'B draft' });

    await upsertAudience(ACCOUNT_A, { id: ids.audA, name: 'A audience', contactEmails: [emailA] });
    await upsertAudience(ACCOUNT_B, { id: ids.audB, name: 'B audience', contactEmails: [emailB] });
  });

  after(async () => {
    // Cascade delete wipes every row tagged with each account id. Wrapped
    // in try/deleteMany so a failed `before` (partial seed) still cleans up.
    await prisma.account.deleteMany({ where: { id: { in: [ACCOUNT_A, ACCOUNT_B] } } });
  });

  it('contacts: each account sees only its own', async () => {
    const aEmails = (await listContacts(ACCOUNT_A)).map((c) => c.email);
    const bEmails = (await listContacts(ACCOUNT_B)).map((c) => c.email);
    assert.ok(aEmails.includes(emailA), 'A should see its own contact');
    assert.ok(!aEmails.includes(emailB), "A must NOT see B's contact");
    assert.ok(bEmails.includes(emailB), 'B should see its own contact');
    assert.ok(!bEmails.includes(emailA), "B must NOT see A's contact");
  });

  it('contacts: queryContacts is scoped', async () => {
    const aResult = await queryContacts({ accountId: ACCOUNT_A, page: 1, pageSize: 100 });
    const emails = aResult.rows.map((c) => c.email);
    assert.ok(emails.includes(emailA));
    assert.ok(!emails.includes(emailB), "queryContacts(A) must NOT return B's contact");
  });

  it('campaigns: list + getCampaign are scoped', async () => {
    const aIds = (await listCampaigns(ACCOUNT_A)).map((c) => c.id);
    assert.ok(aIds.includes(ids.campA));
    assert.ok(!aIds.includes(ids.campB), "A's campaign list must exclude B's campaign");

    // Cross-account direct fetch by id must come back null, not the row.
    const crossFetch = await getCampaign(ACCOUNT_A, ids.campB);
    assert.equal(crossFetch, null, "getCampaign(A, B's id) must return null");

    // Sanity: A can fetch its own.
    const ownFetch = await getCampaign(ACCOUNT_A, ids.campA);
    assert.ok(ownFetch, 'A should fetch its own campaign');
  });

  it('segments: list is scoped + cross-account delete is a no-op', async () => {
    const aIds = (await listSegments(ACCOUNT_A)).map((s) => s.id);
    assert.ok(aIds.includes(ids.segA));
    assert.ok(!aIds.includes(ids.segB));

    // A trying to delete B's segment by id must delete nothing.
    const result = await deleteSegment(ACCOUNT_A, ids.segB);
    assert.equal(result.count, 0, "A must not be able to delete B's segment");
    // Confirm B's segment still exists for B.
    const stillThere = (await listSegments(ACCOUNT_B)).map((s) => s.id);
    assert.ok(stillThere.includes(ids.segB), "B's segment must survive A's delete attempt");
  });

  it('templates: list is scoped + cross-account delete is a no-op', async () => {
    const aIds = (await listTemplates(ACCOUNT_A)).map((t) => t.id);
    assert.ok(aIds.includes(ids.tplA));
    assert.ok(!aIds.includes(ids.tplB));

    const result = await deleteTemplate(ACCOUNT_A, ids.tplB);
    assert.equal(result.count, 0, "A must not be able to delete B's template");
  });

  it('drafts: list is scoped', async () => {
    const aIds = (await listDrafts(ACCOUNT_A)).map((d) => d.id);
    assert.ok(aIds.includes(ids.draftA));
    assert.ok(!aIds.includes(ids.draftB));
  });

  it('audiences: list + getAudience are scoped', async () => {
    const aIds = (await listAudiences(ACCOUNT_A)).map((a) => a.id);
    assert.ok(aIds.includes(ids.audA));
    assert.ok(!aIds.includes(ids.audB));

    const crossFetch = await getAudience(ACCOUNT_A, ids.audB);
    assert.equal(crossFetch, null, "getAudience(A, B's id) must return null");
  });

  it('cascade delete removes all of an account\'s data', async () => {
    // Delete a THIRD scratch account with one contact, confirm the contact
    // row is gone afterwards (FK onDelete: Cascade). Uses its own ids so it
    // doesn't disturb the A/B assertions above.
    const tmp = `iso-tmp-${crypto.randomUUID().slice(0, 8)}`;
    const tmpEmail = `iso-tmp-${run}@example.com`;
    await prisma.account.create({ data: { id: tmp, name: 'ISO Temp' } });
    await upsertContacts(tmp, [{ email: tmpEmail }]);
    assert.equal((await listContacts(tmp)).length, 1);

    await prisma.account.delete({ where: { id: tmp } });
    const orphan = await prisma.contact.findUnique({ where: { email: tmpEmail } });
    assert.equal(orphan, null, 'contact row must cascade-delete with its account');
  });
});
