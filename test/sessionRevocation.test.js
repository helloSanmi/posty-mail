// "Sign out my other devices", on a stateless token.
//
// There is no session table: a JWT is valid because it verifies. So each
// token carries the `tokenVersion` its user held when it was minted, and
// requireAuth refuses any token whose version is behind. Bumping the column
// invalidates every token for that user everywhere, at once.
//
// The test that matters most is the last one in the first block: the
// replacement token issued by the very request that performs the revocation
// must SURVIVE it. Get the ordering wrong and "sign out my other devices"
// signs you out of the device you are sitting at.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import { prisma } from '../backend/lib/db.js';
import { hashPassword, requireAuth, signToken } from '../backend/lib/auth.js';
import {
  clearSessionCache, currentTokenVersion, revokeOtherSessions,
} from '../backend/lib/sessions.js';

let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

const run = crypto.randomUUID().slice(0, 8);
const ACCOUNT = `sess-${run}`;
let user;

// requireAuth answers asynchronously now, so the harness waits for whichever
// of next()/res comes first.
function callRequireAuth(token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { resolve({ outcome: 'rejected', status: this.statusCode }); return this; },
    };
    requireAuth(req, res, () => resolve({ outcome: 'next', user: req.user }));
  });
}

describe('session revocation', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    await prisma.account.create({ data: { id: ACCOUNT, name: `Sess ${run}` } });
    user = await prisma.user.create({
      data: {
        email: `sess-${run}@example.com`,
        passwordHash: await hashPassword('original-password-1'),
        role: 'admin',
        accountId: ACCOUNT,
      },
    });
    clearSessionCache();
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { accountId: ACCOUNT } });
    await prisma.account.deleteMany({ where: { id: ACCOUNT } });
    clearSessionCache();
  });

  it('a freshly signed token is accepted', async () => {
    const token = signToken(user);
    const result = await callRequireAuth(token);
    assert.equal(result.outcome, 'next');
    assert.equal(result.user.id, user.id);
  });

  it('every existing token stops working once the version is bumped', async () => {
    const phone = signToken(user);
    const laptop = signToken(user);
    assert.equal((await callRequireAuth(phone)).outcome, 'next');

    await revokeOtherSessions(user.id);

    assert.equal((await callRequireAuth(phone)).status, 401, 'the phone must be signed out');
    assert.equal((await callRequireAuth(laptop)).status, 401, 'the laptop too');
  });

  it('the replacement token issued BY the revocation survives it', async () => {
    // The one that matters. Mint before the bump and you revoke the token you
    // are about to hand back, signing the person out of the device they are
    // sitting at — which looks exactly like the feature being broken.
    const stale = signToken(user);
    const version = await revokeOtherSessions(user.id);
    const replacement = signToken(user, version);

    assert.equal((await callRequireAuth(stale)).status, 401);
    assert.equal((await callRequireAuth(replacement)).outcome, 'next');
  });

  it('a second revocation invalidates the first replacement', async () => {
    // Revoking twice is not a no-op: each bump is a clean sweep.
    const first = signToken(user, await revokeOtherSessions(user.id));
    assert.equal((await callRequireAuth(first)).outcome, 'next');
    const second = signToken(user, await revokeOtherSessions(user.id));
    assert.equal((await callRequireAuth(first)).status, 401);
    assert.equal((await callRequireAuth(second)).outcome, 'next');
  });


  it('a token with no version claim is read as 0 and still works', async () => {
    // The deploy that adds this must not sign everybody out. Existing tokens
    // carry no `tv`; every existing row defaults to 0; the two match.
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: 0 } });
    clearSessionCache();

    const jwt = (await import('jsonwebtoken')).default;
    const legacy = jwt.sign(
      {
        sub: user.id, email: user.email, role: user.role, accountId: ACCOUNT,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );
    assert.equal((await callRequireAuth(legacy)).outcome, 'next');
  });

  it('but is swept by the first revocation, like any other', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const legacy = jwt.sign(
      {
        sub: user.id, email: user.email, role: user.role, accountId: ACCOUNT,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' },
    );
    await revokeOtherSessions(user.id);
    assert.equal((await callRequireAuth(legacy)).status, 401);
  });
});

describe('a deleted account cannot keep using its token', { skip: dbReachable ? false : 'no database reachable' }, () => {
  it('rejects once the row is gone, rather than defaulting to 0', async () => {
    // A JWT lives 7 days. Without this, an admin deleting a user leaves them
    // a working token for the rest of the week.
    const ghostAccount = `ghost-${run}`;
    await prisma.account.create({ data: { id: ghostAccount, name: 'Ghost' } });
    const ghost = await prisma.user.create({
      data: {
        email: `ghost-${run}@example.com`,
        passwordHash: await hashPassword('ghost-password-1'),
        role: 'admin',
        accountId: ghostAccount,
      },
    });
    const token = signToken(ghost);
    clearSessionCache();
    assert.equal((await callRequireAuth(token)).outcome, 'next');

    await prisma.user.delete({ where: { id: ghost.id } });
    clearSessionCache();
    assert.equal(await currentTokenVersion(ghost.id), null);
    assert.equal((await callRequireAuth(token)).status, 401);

    await prisma.account.delete({ where: { id: ghostAccount } });
  });
});
