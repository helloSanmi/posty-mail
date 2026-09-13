// Self-service profile: change your own name, location and password.
//
// These are the only routes where a user writes to their own User row, which
// makes them the only routes where getting the field list wrong is a
// privilege escalation rather than a bug. The tests are weighted accordingly:
// the happy path is three assertions, the things that must NOT be possible
// are most of the file.
//
// Runs against a real Postgres and skips when one is not reachable, matching
// multiTenantIsolation.test.js and rbac.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import { prisma } from '../backend/lib/db.js';
import { hashPassword, publicUser, verifyPassword } from '../backend/lib/auth.js';

let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

const run = crypto.randomUUID().slice(0, 8);
const ACCOUNT = `self-${run}`;
const OTHER_ACCOUNT = `other-${run}`;
const EMAIL = `self-${run}@example.com`;
const ORIGINAL = 'original-password-1';

let userId;

describe('self-service profile', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    await prisma.account.create({ data: { id: ACCOUNT, name: `Self ${run}` } });
    await prisma.account.create({ data: { id: OTHER_ACCOUNT, name: `Other ${run}` } });
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await hashPassword(ORIGINAL),
        name: 'Original Name',
        role: 'editor',
        accountId: ACCOUNT,
      },
    });
    userId = user.id;
    // A second workspace with an admin in it. Nothing in these tests should
    // ever be able to reach this row — its existence is the control.
    await prisma.user.create({
      data: {
        email: `victim-${run}@example.com`,
        passwordHash: await hashPassword('victim-password-1'),
        role: 'admin',
        accountId: OTHER_ACCOUNT,
      },
    });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { accountId: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
    await prisma.account.deleteMany({ where: { id: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
  });

  it('stores a location, which is nullable and starts empty', async () => {
    const before2 = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(before2.location, null, 'existing rows must survive the migration with NULL');

    await prisma.user.update({ where: { id: userId }, data: { location: 'Lagos' } });
    const after2 = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(after2.location, 'Lagos');
  });

  it('exposes location to the client, and never the password hash', async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const shaped = publicUser(user);
    assert.equal(shaped.location, 'Lagos');
    assert.equal('passwordHash' in shaped, false, 'publicUser must never carry the hash');
    assert.equal(shaped.email, EMAIL);
  });

  it('clearing a location is possible, not just setting one', async () => {
    // An empty string reaching a nullable column is how "remove this" is
    // spelled. If the handler treated empty as "leave unchanged", a location
    // would be permanent once set.
    await prisma.user.update({ where: { id: userId }, data: { location: '' } });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(user.location, '');
  });

  it('a changed password verifies, and the old one stops working', async () => {
    const next = 'a-brand-new-password-2';
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next) },
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    assert.equal(await verifyPassword(next, user.passwordHash), true);
    assert.equal(await verifyPassword(ORIGINAL, user.passwordHash), false);
    // put it back for any later test
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(ORIGINAL) },
    });
  });
});

// --- the shape of the route, checked without a live HTTP server -----------
//
// What a reader of this file most wants to know is "can I change my own role
// through this?". That is answered by the handler's field list, so the field
// list is asserted directly from the source rather than inferred from a
// round-trip that happens not to send a role.
describe('the profile route cannot be used to escalate', () => {
  const source = () => import('node:fs').then((fs) => fs.readFileSync(
    new URL('../backend/routes/auth.js', import.meta.url),
    'utf8',
  ));

  it('never spreads the request body into the update', async () => {
    const text = await source();
    const handler = text.slice(
      text.indexOf("'/api/auth/profile'"),
      text.indexOf("'/api/auth/password'"),
    );
    assert.ok(handler.length > 0, 'profile handler not found');
    assert.equal(
      /data:\s*\{\s*\.\.\.req\.body/.test(handler),
      false,
      'spreading req.body makes every future User column self-writable',
    );
    assert.match(handler, /data\.name = req\.body\.name/);
    assert.match(handler, /data\.location = req\.body\.location/);
  });

  it('does not mention the fields that would be an escalation', async () => {
    const text = await source();
    const handler = text.slice(
      text.indexOf("'/api/auth/profile'"),
      text.indexOf("'/api/auth/password'"),
    );
    ['role', 'isSuperAdmin', 'accountId', 'passwordHash'].forEach((field) => {
      assert.equal(
        new RegExp(`data\\.${field}\\s*=`).test(handler),
        false,
        `${field} must not be writable through the profile route`,
      );
    });
  });

  it('always scopes the update to the caller, never to an id from the body', async () => {
    const text = await source();
    const handler = text.slice(
      text.indexOf("'/api/auth/profile'"),
      text.indexOf("'/api/auth/password'"),
    );
    assert.match(handler, /where:\s*\{\s*id:\s*req\.user\.id\s*\}/);
    assert.equal(
      /req\.body\.id|req\.params\.id/.test(handler),
      false,
      'an id from the request would let anyone edit anyone',
    );
  });

  it('the password route verifies the CURRENT password before changing it', async () => {
    // Without this, a leaked session token becomes a permanent account
    // takeover: whoever holds it sets a new password and locks the owner out.
    const text = await source();
    const handler = text.slice(text.indexOf("'/api/auth/password'"));
    assert.match(handler, /verifyPassword\(req\.body\.currentPassword/);
    assert.match(handler, /where:\s*\{\s*id:\s*req\.user\.id\s*\}/);
  });

  it('both self-service routes require authentication', async () => {
    // They are registered in registerAuthRoutes, which runs BEFORE the
    // app-wide `app.use('/api', requireAuth)` in server.js — so the inline
    // requireAuth is the only thing standing in front of them. Removing it
    // would publish them to the internet, unauthenticated.
    const text = await source();
    const profile = text.slice(
      text.indexOf("'/api/auth/profile'"),
      text.indexOf("'/api/auth/password'"),
    );
    const password = text.slice(
      text.indexOf("'/api/auth/password'"),
      text.indexOf("'/api/auth/me'"),
    );
    assert.match(profile, /requireAuth/, 'PATCH /api/auth/profile is unauthenticated');
    assert.match(password, /requireAuth/, 'POST /api/auth/password is unauthenticated');
  });

  it('the password route is rate limited', async () => {
    // It verifies a password on demand, which makes it an oracle for anyone
    // holding a session.
    const text = await source();
    const password = text.slice(
      text.indexOf("'/api/auth/password'"),
      text.indexOf("'/api/auth/me'"),
    );
    assert.match(password, /Limiter/);
  });
});

describe('every password write goes through the one writer', () => {
  // Three routes write a passwordHash: the self-service change, the admin
  // reset, and redeeming a reset token. They used to each stamp
  // passwordChangedAt by hand, which is how a field ends up being a half-truth
  // that depends on which route happened to be used.
  //
  // That convention is now structural: lib/passwordReset.js owns the write, so
  // the stamp — and the tokenVersion bump, and burning any outstanding reset
  // tokens — cannot be forgotten by a fourth caller added later. These
  // assertions pin the convergence, not the old count.
  //
  // User CREATION deliberately does not stamp it. "Never changed" is the
  // honest answer for someone still on the password an admin set for them,
  // and that is exactly the person worth nudging.
  const read = (path) => import('node:fs').then((fs) => fs.readFileSync(
    new URL(`../backend/${path}`, import.meta.url),
    'utf8',
  ));

  it('the stamp lives in exactly one place', async () => {
    const text = await read('lib/passwordReset.js');
    assert.equal(
      (text.match(/passwordChangedAt: new Date\(\)/g) || []).length,
      1,
      'setUserPassword is the only thing that should stamp passwordChangedAt',
    );
  });

  it('no route stamps it by hand any more', async () => {
    for (const path of ['routes/auth.js', 'routes/admin.js']) {
      const text = await read(path);
      assert.equal(
        /passwordChangedAt: new Date\(\)/.test(text),
        false,
        `${path} should delegate to setUserPassword rather than stamping itself`,
      );
      assert.match(
        text,
        /setUserPassword\(/,
        `${path} writes a password, so it must go through the shared writer`,
      );
    }
  });

  it('the writer also burns outstanding reset tokens, in the same transaction', async () => {
    // Not tidiness. An attacker requests a reset and reads the link from a
    // mailbox they control; the owner notices and changes their password from
    // inside the app; a surviving token lets the attacker undo that fix. A
    // password write that does not kill outstanding tokens makes the
    // current-password check on /api/auth/password mean nothing.
    const text = await read('lib/passwordReset.js');
    const writer = text.slice(text.indexOf('export async function setUserPassword'));
    const body = writer.slice(0, writer.indexOf('\n}\n'));
    assert.match(body, /\$transaction/);
    assert.match(body, /burnOutstanding\(tx, userId\)/);
  });

  it('creating a user does NOT stamp it', async () => {
    const text = await read('routes/admin.js');
    const create = text.slice(
      text.indexOf("app.post(\n    '/api/admin/users'"),
      text.indexOf("'/api/admin/users/:id'"),
    );
    if (create.length > 0) {
      assert.equal(
        /passwordChangedAt/.test(create),
        false,
        'a freshly created user has never changed their password',
      );
    }
  });
});

// Comments in this codebase explain the bugs they replaced, by design, so a
// grep for the old shape has to look at code only.
const stripComments = (text) => text.replace(/\/\/[^\n]*/g, '');

describe('password reset is OPT-IN and tokenised', () => {
  // It was once opt-OUT (`!== 'false'`), which meant every install that had
  // not thought about it shipped an endpoint that set ANY user's password from
  // their email address alone: no token, no email sent, no proof the caller
  // owned the mailbox.
  //
  // It is now a tokenised, emailed flow — but the flag must stay opt-in and
  // the issue endpoint must never accept a password again, so both are pinned
  // here. A red grep in this file is a design question, not a flake.
  const read = (path) => import('node:fs').then((fs) => fs.readFileSync(
    new URL(`../backend/${path}`, import.meta.url),
    'utf8',
  ));

  it('the capability check demands exactly "true"', async () => {
    const text = await read('lib/passwordReset.js');
    assert.match(
      text,
      /process\.env\.ALLOW_PASSWORD_RESET !== 'true'/,
      'the reset must be opt-in; `!== "false"` ships it on by default',
    );
  });

  it('the opt-out spelling appears nowhere in the backend', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const root = new URL('../backend/', import.meta.url).pathname;
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = `${dir}/${entry}`;
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.js')) {
          const text = readFileSync(full, 'utf8');
          // Only the CODE form matters; the comments explain the old bug on
          // purpose and must stay readable.
          const code = text.replace(/\/\/[^\n]*/g, '');
          if (/ALLOW_PASSWORD_RESET\s*[!=]==\s*'false'/.test(code)) {
            offenders.push(full.replace(root, ''));
          }
        }
      }
    };
    walk(root.replace(/\/$/, ''));
    assert.deepEqual(offenders, [], 'the opt-out form is the bug');
  });

  it('the issue endpoint no longer accepts a password', async () => {
    // This is the takeover itself. Any path that still takes newPassword on
    // forgot-password is the original hole regardless of what sits beside it.
    //
    // Comments are stripped first: the block above forgotSchema names the old
    // { email, newPassword } shape deliberately, and that explanation must
    // stay readable without failing the grep that guards against it.
    const text = await read('routes/auth.js');
    const schema = stripComments(text.slice(
      text.indexOf('const forgotSchema'),
      text.indexOf('const redeemSchema'),
    ));
    assert.ok(schema.length > 0, 'forgotSchema should still exist');
    assert.equal(/newPassword/.test(schema), false);
    // .strict() so the OLD frontend's { email, newPassword } is rejected
    // rather than silently stripped to { email } and quietly succeeding.
    assert.match(schema, /\.strict\(/);
  });

  it('the redeem endpoint takes no email and no user id', async () => {
    // The replaced route trusted an email in the body, and that WAS the
    // takeover. The subject must come from the token row alone.
    const text = await read('routes/auth.js');
    const schema = stripComments(text.slice(
      text.indexOf('const redeemSchema'),
      text.indexOf('const checkSchema'),
    ));
    assert.ok(schema.length > 0);
    assert.equal(/email|userId|accountId/.test(schema), false);
    assert.match(schema, /\.strict\(\)/);
  });

  it('and the status endpoint advertises the real capability', async () => {
    // If /auth/status reported the bare flag, the login page would offer a
    // "forgot password" link on an install with no API key or no sender —
    // where the request 200s and no email ever arrives.
    const text = await read('routes/auth.js');
    assert.match(
      text,
      /passwordResetEnabled: \(await resolvePasswordResetCapability\(\)\)\.enabled/,
    );
  });
});
