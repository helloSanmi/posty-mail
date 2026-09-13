// What makes password reset actually available, and what /api/auth/status is
// allowed to say about it.
//
// The flag alone is not enough, and that is the point. A "Forgot password"
// link that appears on an install with no API key, no sender, or a
// PUBLIC_BASE_URL nobody outside the box can open produces a request that
// returns 200 and an email that never arrives — and because the response is
// deliberately identical whether or not the address exists, the user has no
// way to tell that from a lost email. A hidden link is the better failure.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import { prisma } from '../backend/lib/db.js';
import { resolvePasswordResetCapability } from '../backend/lib/passwordReset.js';

let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

const SENDER_KEY = 'campaign.sender';
const ENV_KEYS = [
  'ALLOW_PASSWORD_RESET', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME', 'PUBLIC_BASE_URL', 'DEMO_MODE', 'NODE_ENV',
];
const saved = {};
let savedSenderSetting;

// The known-good configuration. Each test knocks exactly one leg out.
function configure(overrides = {}) {
  const base = {
    ALLOW_PASSWORD_RESET: 'true',
    BREVO_API_KEY: 'test-key-not-real',
    BREVO_SENDER_EMAIL: 'hello@example.com',
    BREVO_SENDER_NAME: 'Posty Test',
    PUBLIC_BASE_URL: 'https://mail.example.com',
    DEMO_MODE: undefined,
    NODE_ENV: undefined,
    ...overrides,
  };
  ENV_KEYS.forEach((key) => {
    if (base[key] === undefined) delete process.env[key];
    else process.env[key] = base[key];
  });
}

describe('password reset capability', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    ENV_KEYS.forEach((key) => { saved[key] = process.env[key]; });
    // resolveSender() prefers the Setting row over env, so a row left by
    // another test (or a real dev database) would mask the env-only cases.
    savedSenderSetting = await prisma.setting.findUnique({ where: { key: SENDER_KEY } });
    if (savedSenderSetting) await prisma.setting.delete({ where: { key: SENDER_KEY } });
  });

  after(async () => {
    ENV_KEYS.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    if (savedSenderSetting) {
      await prisma.setting.upsert({
        where: { key: SENDER_KEY },
        create: { key: SENDER_KEY, value: savedSenderSetting.value },
        update: { value: savedSenderSetting.value },
      });
    }
    await prisma.$disconnect();
  });

  beforeEach(() => { configure(); });

  it('is enabled when everything is in place', async () => {
    const capability = await resolvePasswordResetCapability();
    assert.equal(capability.enabled, true);
    assert.equal(capability.reason, null);
    assert.deepEqual(capability.sender, { email: 'hello@example.com', name: 'Posty Test' });
    assert.equal(capability.baseUrl, 'https://mail.example.com');
  });

  it('is OPT-IN: only the exact string "true" turns it on', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
      configure({ ALLOW_PASSWORD_RESET: value });
       
      const capability = await resolvePasswordResetCapability();
      assert.equal(capability.enabled, false, `ALLOW_PASSWORD_RESET=${String(value)} must not enable it`);
    }
  });

  it('stays off under DEMO_MODE even with a real key', async () => {
    // isConfigured() is literally hasBrevoKey() and knows nothing about
    // DEMO_MODE, while brevoFetch short-circuits to { dryRun: true,
    // accepted: true } and RESOLVES. Without an independent check, a demo
    // instance would advertise reset, report success, and deliver nothing.
    for (const value of ['1', 'true']) {
      configure({ DEMO_MODE: value });
       
      const capability = await resolvePasswordResetCapability();
      assert.equal(capability.enabled, false);
      assert.match(capability.reason, /DEMO_MODE/);
    }
  });

  it('stays off with no provider key', async () => {
    configure({ BREVO_API_KEY: undefined });
    const capability = await resolvePasswordResetCapability();
    assert.equal(capability.enabled, false);
    assert.match(capability.reason, /API key/);
  });

  it('stays off when the sender is incomplete', async () => {
    // resolveSender() requires BOTH a name and an address: a name with no
    // address is unsendable, and an address with no name shows up as a bare
    // address in a mail client, which this app treats as misconfigured.
    for (const missing of ['BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME']) {
      configure({ [missing]: undefined });
       
      const capability = await resolvePasswordResetCapability();
      assert.equal(capability.enabled, false, `missing ${missing} should disable it`);
      assert.match(capability.reason, /sender/);
    }
  });

  it('stays off when PUBLIC_BASE_URL could not produce a working link', async () => {
    const unusable = [
      undefined,
      '',
      'not-a-url',
      'ftp://mail.example.com',
      // A base carrying a query or fragment would swallow the path we append.
      'https://mail.example.com/?utm=1',
      'https://mail.example.com/#x',
    ];
    for (const value of unusable) {
      configure({ PUBLIC_BASE_URL: value });
       
      const capability = await resolvePasswordResetCapability();
      assert.equal(capability.enabled, false, `PUBLIC_BASE_URL=${String(value)} must not enable it`);
      assert.match(capability.reason, /PUBLIC_BASE_URL/);
    }
  });

  it('refuses a localhost base URL in production, but allows it in development', async () => {
    // In dev that IS the address. In production it is a link nobody outside
    // the box can open — a person locked out with no recovery path.
    configure({ PUBLIC_BASE_URL: 'http://localhost:4010', NODE_ENV: 'production' });
    assert.equal((await resolvePasswordResetCapability()).enabled, false);

    configure({ PUBLIC_BASE_URL: 'http://localhost:4010' });
    assert.equal((await resolvePasswordResetCapability()).enabled, true);
  });

  it('trims a trailing slash so the link never doubles up', async () => {
    configure({ PUBLIC_BASE_URL: 'https://mail.example.com/' });
    const capability = await resolvePasswordResetCapability();
    assert.equal(capability.baseUrl, 'https://mail.example.com');
  });

  it('costs nothing on the default install', async () => {
    // /api/auth/status is unauthenticated and sits on every anonymous page
    // load. With the flag off, the env short-circuit must fire before any
    // database work happens at all.
    //
    // Spying on the CALL SITE, not on prisma.$on('query'): the shared client
    // is constructed as a bare `new PrismaClient()` with no `log` option, so
    // a query listener never fires and a counter built on one would sit at
    // zero no matter what the code did — an assertion that cannot fail.
    const realFindUnique = prisma.setting.findUnique;
    let settingReads = 0;
    prisma.setting.findUnique = (...args) => {
      settingReads += 1;
      return realFindUnique.apply(prisma.setting, args);
    };
    try {
      configure({ ALLOW_PASSWORD_RESET: 'false' });
      await resolvePasswordResetCapability();
      assert.equal(settingReads, 0, 'the disabled path must not read the sender setting');

      // And the same spy proves the check is live when it should be, so the
      // assertion above cannot pass merely because the spy was never wired.
      configure();
      await resolvePasswordResetCapability();
      assert.equal(settingReads, 1, 'the enabled path DOES resolve the sender');
    } finally {
      prisma.setting.findUnique = realFindUnique;
    }
  });

  it('never reaches the email provider', async () => {
    // getSetupStatus() / checkAccount() / fetchVerifiedSenders() all call
    // api.brevo.com. Wiring any of them in here would let a stranger drive
    // OUR provider rate limit — taking real campaign sends down — and add a
    // network round trip to first paint.
    const realFetch = globalThis.fetch;
    let outbound = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('brevo.com')) outbound += 1;
      return realFetch(url, options);
    };
    try {
      for (let i = 0; i < 20; i += 1) {
         
        await resolvePasswordResetCapability();
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(outbound, 0);
  });

  it('always answers with a reason when it is off', async () => {
    // The reason is for the boot log and nothing else — it must never reach
    // /api/auth/status, which reports a bare boolean.
    configure({ BREVO_API_KEY: undefined });
    const capability = await resolvePasswordResetCapability();
    assert.equal(typeof capability.reason, 'string');
    assert.ok(capability.reason.length > 0);
  });
});

describe('the migration is additive', () => {
  const read = async () => {
    const fs = await import('node:fs');
    return fs.readFileSync(
      new URL('../prisma/migrations/20260913180000_add_password_reset_token/migration.sql', import.meta.url),
      'utf8',
    );
  };

  // The file documents its own rollback ("DROP TABLE …") and its lock
  // footprint, so the destructive-statement greps below have to look at the
  // statements rather than the prose explaining them.
  const readSql = async () => (await read()).replace(/--[^\n]*/g, '');

  it('sorts after the migrations that shipped before it', async () => {
    // Prisma applies in lexicographic order, so the table must be created
    // before the index migration that constrains it, and both must land after
    // the three that shipped the same day.
    const fs = await import('node:fs');
    const dirs = fs.readdirSync(new URL('../prisma/migrations', import.meta.url))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const table = dirs.indexOf('20260913180000_add_password_reset_token');
    const index = dirs.indexOf('20260913190000_one_live_reset_token');
    assert.ok(table > dirs.indexOf('20260913170000_add_token_version'));
    assert.ok(index > table, 'the index migration must run after the table exists');
  });

  it('enforces one live token per user in the database, not just in the app', async () => {
    // The backstop for the invariant issueToken's advisory lock maintains.
    // Prisma's schema language cannot express a partial index, so this is the
    // only place it is asserted.
    const fs = await import('node:fs');
    const sql = fs.readFileSync(
      new URL('../prisma/migrations/20260913190000_one_live_reset_token/migration.sql', import.meta.url),
      'utf8',
    );
    assert.match(sql, /CREATE UNIQUE INDEX "PasswordResetToken_one_live_per_user"/);
    assert.match(sql, /WHERE "usedAt" IS NULL/);
    // The de-duplicating UPDATE must come first, or creating the index would
    // fail on exactly the rows it exists to prevent.
    assert.ok(
      sql.indexOf('UPDATE "PasswordResetToken"') < sql.indexOf('CREATE UNIQUE INDEX'),
      'burn duplicates before adding the constraint',
    );
  });

  it('creates a table and touches nothing that already has rows in it', async () => {
    // deploy.sh runs db:deploy BEFORE the pm2 restart, so the OLD code runs
    // against the NEW schema for the length of the frontend build. A brand-new
    // table is invisible to old code, which is what makes that window a
    // non-event — and what an ALTER on User would not be.
    const sql = await readSql();
    assert.match(sql, /CREATE TABLE "PasswordResetToken"/);

    // Checked per STATEMENT, by its leading keyword. A bare keyword grep
    // would trip over the foreign key's own "ON DELETE CASCADE ON UPDATE
    // CASCADE", which is referential-integrity configuration rather than a
    // statement that touches a row.
    const verbs = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => statement.split(/\s+/).slice(0, 3).join(' ').toUpperCase());
    verbs.forEach((verb) => {
      assert.equal(/^(DROP|DELETE|UPDATE|TRUNCATE)\b/.test(verb), false, `destructive statement: ${verb}`);
    });
    assert.equal(verbs.some((verb) => verb.startsWith('ALTER TABLE "USER"')), false, 'must not touch the User table');
    assert.deepEqual(
      verbs.filter((verb) => verb.startsWith('ALTER TABLE')),
      ['ALTER TABLE "PASSWORDRESETTOKEN"'],
      'the only ALTER is the new table\'s own foreign key',
    );
  });

  it('cascades from the user, so a token cannot outlive the account', async () => {
    // User.email is globally unique and freed on delete. Without the cascade a
    // token issued to someone who later leaves would still be redeemable
    // against whoever is invited with that address next.
    const sql = await read();
    assert.match(sql, /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\)/);
    assert.match(sql, /ON DELETE CASCADE/);
  });

  it('indexes the hash uniquely, because the lookup IS the comparison', async () => {
    const sql = await read();
    assert.match(sql, /CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"/);
  });
});
