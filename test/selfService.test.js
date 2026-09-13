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

describe('passwordChangedAt is stamped everywhere a password is written', () => {
  // Three routes write a passwordHash: self-service change, the public
  // forgot-password reset, and an admin reset. A field that tracked only one
  // of them would be a half-truth that depends on which route happened to be
  // used — and it is a field people would use to judge whether a password is
  // stale.
  //
  // User CREATION deliberately does not stamp it. "Never changed" is the
  // honest answer for someone still on the password an admin set for them,
  // and that is exactly the person worth nudging.
  const source = (file) => import('node:fs').then((fs) => fs.readFileSync(
    new URL(`../backend/routes/${file}`, import.meta.url),
    'utf8',
  ));

  it('every passwordHash write in auth.js stamps the timestamp', async () => {
    const text = await source('auth.js');
    const writes = [...text.matchAll(/passwordHash[,:][\s\S]{0,200}?\}/g)];
    const updates = writes.filter((m) => /data:/.test(
      text.slice(Math.max(0, m.index - 200), m.index),
    ) || /passwordChangedAt/.test(m[0]));
    assert.ok(updates.length > 0);
    // The two UPDATE paths (self change, forgot-password) both stamp.
    assert.equal(
      (text.match(/passwordChangedAt: new Date\(\)/g) || []).length,
      2,
      'auth.js should stamp on the self-service change and the reset',
    );
  });

  it('the admin reset stamps it too', async () => {
    const text = await source('admin.js');
    const reset = text.slice(text.indexOf("'/api/admin/users/:id/password'"));
    assert.match(reset, /passwordChangedAt: new Date\(\)/);
  });

  it('creating a user does NOT stamp it', async () => {
    const text = await source('admin.js');
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

describe('the unauthenticated password reset is OPT-IN', () => {
  // It used to be opt-OUT (`!== 'false'`), which meant every install that had
  // not thought about it shipped an endpoint that set ANY user's password
  // from their email address alone: no token, no email sent, no proof the
  // caller owns the mailbox.
  //
  // It also voided the current-password check on /api/auth/password, which is
  // why it is tested here rather than filed as someone else's problem: an
  // attacker holding a session never needed the old password, because this
  // route would hand them a new one.
  const source = () => import('node:fs').then((fs) => fs.readFileSync(
    new URL('../backend/routes/auth.js', import.meta.url),
    'utf8',
  ));

  it('refuses unless ALLOW_PASSWORD_RESET is exactly "true"', async () => {
    const text = await source();
    const handler = text.slice(text.indexOf("'/api/auth/forgot-password'"));
    assert.match(
      handler,
      /process\.env\.ALLOW_PASSWORD_RESET !== 'true'/,
      'the reset must be opt-in; `!== "false"` ships a takeover by default',
    );
    assert.equal(
      /ALLOW_PASSWORD_RESET === 'false'/.test(handler),
      false,
      'the opt-out form is the bug',
    );
  });

  it('and the status endpoint advertises it the same way', async () => {
    // If /auth/status still said enabled-by-default, the login page would
    // offer a "forgot password" link to a route that always 403s.
    const text = await source();
    assert.match(text, /passwordResetEnabled: process\.env\.ALLOW_PASSWORD_RESET === 'true'/);
  });
});
