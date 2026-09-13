// Tokenised password reset.
//
// The route this replaces took { email, newPassword } from an unauthenticated
// caller and set that password. So the weight here is deliberately not on the
// happy path — it is on the things that must be impossible: aiming a token at
// somebody else, spending one twice, surviving a password change, outliving
// the account it belongs to, or telling a stranger which addresses exist.
//
// These run the REAL routes on a real Express app against a real Postgres,
// because the invariants that matter (the conditional claim, the detached
// send, the uniform failure body) live in the handlers rather than in the
// library underneath them. Skips when no database is reachable, matching
// sessionRevocation.test.js.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
// The capability gate demands all four. A fake key is enough because every
// outbound call goes through the stubbed global fetch below.
process.env.ALLOW_PASSWORD_RESET = 'true';
process.env.BREVO_API_KEY = 'test-key-not-real';
process.env.BREVO_SENDER_EMAIL = 'hello@example.com';
process.env.BREVO_SENDER_NAME = 'Posty Test';
process.env.PUBLIC_BASE_URL = 'https://mail.example.com';
delete process.env.DEMO_MODE;

import { prisma } from '../backend/lib/db.js';
import { hashPassword, requireAuth, signToken, verifyPassword } from '../backend/lib/auth.js';
import { clearSessionCache } from '../backend/lib/sessions.js';
import { hashToken } from '../backend/lib/passwordReset.js';
import { registerAuthRoutes } from '../backend/routes/auth.js';

let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

const run = crypto.randomUUID().slice(0, 8);
const ACCOUNT = `reset-${run}`;
const OTHER_ACCOUNT = `reset-other-${run}`;

// Every send the app attempts, captured. The provider talks to api.brevo.com
// through the global fetch, so stubbing it is both the least invasive seam and
// the one that proves no real request would have left the box.
let sends = [];
const realFetch = globalThis.fetch;
let sendShouldThrow = false;

let server;
let baseUrl;

function startServer() {
  const app = express();
  // Mirrors backend/server.js. It also gives the tests a seam: with trust
  // proxy on, express-rate-limit keys on the forwarded address, so a distinct
  // X-Forwarded-For per request keeps the shared 20/15min budget from turning
  // every later assertion in this file into a 429. The limiters themselves are
  // asserted deliberately, from one fixed address, further down.
  app.set('trust proxy', 1);
  app.use(express.json());
  registerAuthRoutes(app);
  // Mirrors backend/server.js's handler: without it an asyncRoute rejection
  // would hang the request instead of answering 500, and a test would time out
  // where the app would have failed loudly.
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  return new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
}

let callerSeq = 0;

async function post(path, body, headers = {}) {
  callerSeq += 1;
  const response = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Each call arrives from its own address unless a test pins one.
      'x-forwarded-for': `10.0.${Math.floor(callerSeq / 250) % 250}.${callerSeq % 250}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is itself a finding */ }
  return { status: response.status, body: json, raw: text };
}

// The app detaches delivery so the response cannot be timed against it. Tests
// that need the email therefore have to wait for work that is deliberately not
// awaited by the request.
async function settle(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
     
    await new Promise((resolve) => { setTimeout(resolve, 25); });
    if (sends.length > 0) return;
  }
}

async function makeUser(email, password = 'original-password-1', accountId = ACCOUNT) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      accountId,
    },
  });
}

// Drives the real flow end to end and returns the token out of the email,
// which is the only place it exists in plaintext.
async function requestTokenFor(email) {
  sends = [];
  const response = await post('/api/auth/forgot-password', { email });
  await settle();
  if (sends.length === 0) return { response, token: null };
  const match = /https:\/\/mail\.example\.com\/reset-password\/([A-Za-z0-9_-]+)/
    .exec(sends[sends.length - 1].textContent);
  return { response, token: match ? match[1] : null };
}

function callRequireAuth(token) {
  return new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { resolve({ outcome: 'rejected', status: this.statusCode }); return this; },
    };
    requireAuth(req, res, () => resolve({ outcome: 'next' }));
  });
}

describe('tokenised password reset', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('api.brevo.com')) {
        if (sendShouldThrow) {
          const error = new Error('Brevo rejected the send');
          error.providerStatus = 401;
          throw error;
        }
        sends.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ messageId: 'stub' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(url, options);
    };
    await prisma.account.create({ data: { id: ACCOUNT, name: `Reset ${run}` } });
    await prisma.account.create({ data: { id: OTHER_ACCOUNT, name: `Other ${run}` } });
    server = await startServer();
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (server) await new Promise((resolve) => { server.close(resolve); });
    await prisma.passwordResetToken.deleteMany({ where: { user: { accountId: { in: [ACCOUNT, OTHER_ACCOUNT] } } } });
    await prisma.user.deleteMany({ where: { accountId: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
    await prisma.auditLog.deleteMany({ where: { accountId: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
    await prisma.account.deleteMany({ where: { id: { in: [ACCOUNT, OTHER_ACCOUNT] } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sends = [];
    sendShouldThrow = false;
    clearSessionCache();
  });

  describe('the token itself', () => {
    it('never exists in the database in a form that can be replayed', async () => {
      const user = await makeUser(`store-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      assert.ok(token, 'a token should have been mailed');

      const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      assert.equal(rows.length, 1);
      // The plaintext appears in no column.
      const serialised = JSON.stringify(rows[0]);
      assert.equal(serialised.includes(token), false, 'the raw token must not be stored');
      // It is sha256 of the token, not bcrypt — bcrypt salts per row, which
      // would break the indexed lookup this design depends on.
      assert.equal(rows[0].tokenHash, hashToken(token));
      assert.match(rows[0].tokenHash, /^[0-9a-f]{64}$/);
      assert.equal(/^\$2[aby]\$/.test(rows[0].tokenHash), false, 'bcrypt would lose the index');
    });

    it('is 256 bits of base64url, not a UUID', async () => {
      // Fails loudly the day someone swaps randomBytes for randomUUID (~122
      // bits, and hex-with-dashes needs no encoding thought, which is exactly
      // why people reach for it).
      const user = await makeUser(`shape-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token, 'base64url').length, 32);
    });
  });

  describe('single use', () => {
    it('cannot be redeemed twice, and the second password never lands', async () => {
      const user = await makeUser(`once-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);

      const first = await post('/api/auth/reset-password', { token, newPassword: 'first-new-password' });
      assert.equal(first.status, 200);

      const second = await post('/api/auth/reset-password', { token, newPassword: 'second-new-password' });
      assert.equal(second.status, 400);

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(await verifyPassword('first-new-password', after.passwordHash));
      assert.equal(await verifyPassword('second-new-password', after.passwordHash), false);
    });

    it('survives two simultaneous redemptions: exactly one wins', async () => {
      // The load-bearing test. A findUnique-then-update implementation passes
      // the sequential test above and fails this one: both readers see
      // usedAt: null, both write a DIFFERENT password, both are told success,
      // and whoever commits last owns the account. That is the real attack the
      // moment a link reaches a link-scanner or a shared inbox.
      //
      // Looped, because a racy implementation can win a single round by luck.
      for (let i = 0; i < 8; i += 1) {
         
        const user = await makeUser(`race-${i}-${run}@example.com`);
         
        const { token } = await requestTokenFor(user.email);
         
        const [a, b] = await Promise.all([
          post('/api/auth/reset-password', { token, newPassword: `alpha-password-${i}` }),
          post('/api/auth/reset-password', { token, newPassword: `bravo-password-${i}` }),
        ]);
        const statuses = [a.status, b.status].sort();
        assert.deepEqual(statuses, [200, 400], `round ${i}: exactly one redemption may succeed`);

         
        const after = await prisma.user.findUnique({ where: { id: user.id } });
        const winner = a.status === 200 ? `alpha-password-${i}` : `bravo-password-${i}`;
        const loser = a.status === 200 ? `bravo-password-${i}` : `alpha-password-${i}`;
         
        assert.ok(await verifyPassword(winner, after.passwordHash), `round ${i}: winner's password`);
         
        assert.equal(await verifyPassword(loser, after.passwordHash), false, `round ${i}: loser's password must not land`);
      }
    });

    it('an expired token is refused without being burned or changing anything', async () => {
      const user = await makeUser(`expired-${run}@example.com`, 'original-password-1');
      const { token } = await requestTokenFor(user.email);
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await post('/api/auth/reset-password', { token, newPassword: 'should-not-land' });
      assert.equal(response.status, 400);

      const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
      assert.equal(row.usedAt, null, 'a rejected attempt must not burn the row');
      const after = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(await verifyPassword('original-password-1', after.passwordHash));
    });
  });

  describe('invalidation', () => {
    it('requesting again kills the previous link', async () => {
      // Exactly one live token per user. Two live links is two live takeover
      // credentials for one account.
      const user = await makeUser(`super-${run}@example.com`);
      const first = await requestTokenFor(user.email);
      // The per-address cooldown is a minute, so reach past the route and mint
      // directly — the invariant under test is "issuing burns", not the clock.
      const { issueToken } = await import('../backend/lib/passwordReset.js');
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { createdAt: new Date(Date.now() - 120_000) },
      });
      const second = await issueToken(user.id);
      assert.ok(second, 'the second issue should not have been capped');

      const live = await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } });
      assert.equal(live, 1);

      const stale = await post('/api/auth/reset-password', { token: first.token, newPassword: 'stale-token-password' });
      assert.equal(stale.status, 400);
      const fresh = await post('/api/auth/reset-password', { token: second.token, newPassword: 'fresh-token-password' });
      assert.equal(fresh.status, 200);
    });

    it('concurrent requests for one address still mint exactly one live link', async () => {
      // The throttles used to be a check-then-act: the hourly count and the
      // cooldown were read outside the transaction that burns and creates, so
      // N simultaneous requests all saw the pre-insert state, all passed, and
      // all inserted. Measured before the fix: four live tokens and four
      // emails for one address inside a window that permits one — defeating
      // both the "exactly one live link" invariant and the mailbox-flood
      // protection, and letting two different redeemers each be told success
      // while only one password survived.
      //
      // burnOutstanding could not fix it: under READ COMMITTED it is an UPDATE
      // matching zero committed rows against an uncommitted sibling INSERT, so
      // it takes no lock. The per-user advisory lock is what serialises them.
      for (let round = 0; round < 4; round += 1) {
        const user = await makeUser(`swarm-${round}-${run}@example.com`);
        sends = [];
        await Promise.all([
          post('/api/auth/forgot-password', { email: user.email }),
          post('/api/auth/forgot-password', { email: user.email }),
          post('/api/auth/forgot-password', { email: user.email }),
          post('/api/auth/forgot-password', { email: user.email }),
        ]);
        await new Promise((resolve) => { setTimeout(resolve, 400); });

        const live = await prisma.passwordResetToken.count({
          where: { userId: user.id, usedAt: null },
        });
        assert.equal(live, 1, `round ${round}: exactly one live token per user`);
        assert.ok(
          sends.length <= 1,
          `round ${round}: the cooldown permits one email, ${sends.length} were sent`,
        );
      }
    });

    it('changing your password from inside the app burns outstanding links', async () => {
      // The attacker holds a link from a mailbox they compromised; the owner
      // notices and changes their password. A surviving token would let the
      // attacker undo that fix — which would make the current-password check
      // on /api/auth/password meaningless.
      const user = await makeUser(`burn-${run}@example.com`, 'original-password-1');
      const { token } = await requestTokenFor(user.email);

      const { setUserPassword } = await import('../backend/lib/passwordReset.js');
      await setUserPassword({ userId: user.id, newPassword: 'owner-took-it-back', bumpTokenVersion: false });

      const live = await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } });
      assert.equal(live, 0);
      const response = await post('/api/auth/reset-password', { token, newPassword: 'attacker-password-1' });
      assert.equal(response.status, 400);
      const after = await prisma.user.findUnique({ where: { id: user.id } });
      assert.ok(await verifyPassword('owner-took-it-back', after.passwordHash));
    });

    it('an admin reset burns them too, and signs the target out', async () => {
      const user = await makeUser(`admin-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      const before = await prisma.user.findUnique({ where: { id: user.id } });
      const staleJwt = signToken(before);

      const { setUserPassword } = await import('../backend/lib/passwordReset.js');
      await setUserPassword({ userId: user.id, newPassword: 'admin-set-this-one', bumpTokenVersion: true });

      assert.equal(
        await prisma.passwordResetToken.count({ where: { userId: user.id, usedAt: null } }),
        0,
      );
      assert.equal((await post('/api/auth/reset-password', { token, newPassword: 'nope-password-1' })).status, 400);
      // Deliberately no clearSessionCache(): the bump must invalidate the
      // cache itself, or the process that performed it keeps honouring the old
      // token for up to a minute.
      const check = await callRequireAuth(staleJwt);
      assert.equal(check.outcome, 'rejected');
      assert.equal(check.status, 401);
    });

    it('redeeming signs every session out', async () => {
      const user = await makeUser(`sessions-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      const staleJwt = signToken(await prisma.user.findUnique({ where: { id: user.id } }));

      const response = await post('/api/auth/reset-password', { token, newPassword: 'brand-new-password' });
      assert.equal(response.status, 200);

      const check = await callRequireAuth(staleJwt);
      assert.equal(check.outcome, 'rejected');
    });

    it('redeeming hands back no session of its own', async () => {
      // A mailed link must never become a session: anything that reads URLs —
      // a forwarded mail, a shared inbox, a prefetcher, browser history — would
      // otherwise upgrade from "can set a password the owner will notice" to
      // "is signed in".
      const user = await makeUser(`nosession-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      const response = await post('/api/auth/reset-password', { token, newPassword: 'still-no-session-1' });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { ok: true });
      assert.equal('token' in response.body, false);
      assert.equal('user' in response.body, false);
    });
  });

  describe('a token cannot be aimed somewhere else', () => {
    it('rejects a body that names another user', async () => {
      const victim = await makeUser(`victim-${run}@example.com`, 'victim-password-1', OTHER_ACCOUNT);
      const holder = await makeUser(`holder-${run}@example.com`);
      const { token } = await requestTokenFor(holder.email);
      const victimBefore = await prisma.user.findUnique({ where: { id: victim.id } });

      const response = await post('/api/auth/reset-password', {
        token,
        newPassword: 'aimed-at-the-victim',
        email: victim.email,
        userId: victim.id,
      });
      assert.equal(response.status, 400, '.strict() must reject unknown keys');

      const victimAfter = await prisma.user.findUnique({ where: { id: victim.id } });
      assert.equal(victimAfter.passwordHash, victimBefore.passwordHash, "the victim's password must be untouched");
      const holderAfter = await prisma.user.findUnique({ where: { id: holder.id } });
      assert.equal(await verifyPassword('aimed-at-the-victim', holderAfter.passwordHash), false);
    });

    it('does not outlive the account it belongs to, even when the address is reused', async () => {
      // User.email is globally unique and FREED on delete. An email-keyed token
      // would survive routine offboarding and reset whoever is invited with
      // that address next. The foreign key is what stops that.
      const address = `recycled-${run}@example.com`;
      const first = await makeUser(address);
      const { token } = await requestTokenFor(address);

      await prisma.passwordResetToken.deleteMany({ where: { userId: first.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: first.id } });
      const second = await makeUser(address, 'second-person-password');
      const secondBefore = await prisma.user.findUnique({ where: { id: second.id } });

      const response = await post('/api/auth/reset-password', { token, newPassword: 'took-over-the-seat' });
      assert.equal(response.status, 400);
      const secondAfter = await prisma.user.findUnique({ where: { id: second.id } });
      assert.equal(secondAfter.passwordHash, secondBefore.passwordHash);
    });

    it('answers 400 rather than 500 when the user vanishes mid-flight', async () => {
      const user = await makeUser(`vanish-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      // Cascade removes the rows with the user; re-insert one pointing nowhere
      // is impossible (the FK forbids it), so this asserts the cascade instead.
      await prisma.user.delete({ where: { id: user.id } });
      assert.equal(await prisma.passwordResetToken.count({ where: { userId: user.id } }), 0);
      const response = await post('/api/auth/reset-password', { token, newPassword: 'gone-already-1234' });
      assert.equal(response.status, 400, 'a dangling token must not surface as a 500');
    });
  });

  describe('failures are indistinguishable', () => {
    it('every dead-token shape answers with the same status and body', async () => {
      // Distinguishable errors confirm a guessed token was once real, and
      // confirm an account exists. "Expired" on its own also mis-teaches the
      // user into clicking the same dead link again.
      const user = await makeUser(`uniform-${run}@example.com`);
      const live = await requestTokenFor(user.email);
      await post('/api/auth/reset-password', { token: live.token, newPassword: 'consumed-this-one' });

      const expiredUser = await makeUser(`uniform2-${run}@example.com`);
      const expired = await requestTokenFor(expiredUser.email);
      await prisma.passwordResetToken.updateMany({
        where: { userId: expiredUser.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const candidates = [
        'a'.repeat(42),
        'a'.repeat(44),
        `${'a'.repeat(41)}+/`,
        '',
        crypto.randomBytes(32).toString('base64url'),
        live.token,
        expired.token,
      ];

      const results = [];
      for (const token of candidates) {
         
        results.push(await post('/api/auth/reset-password', { token, newPassword: 'uniform-probe-pass' }));
      }
      const first = JSON.stringify({ status: results[0].status, body: results[0].body });
      results.forEach((result, index) => {
        assert.equal(
          JSON.stringify({ status: result.status, body: result.body }),
          first,
          `candidate ${index} answered differently`,
        );
      });
      assert.equal(results[0].status, 400);
    });

    it('the check endpoint says only yes or no, and does not consume', async () => {
      const user = await makeUser(`check-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);

      for (let i = 0; i < 3; i += 1) {
         
        const response = await post('/api/auth/reset-password/check', { token });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { valid: true }, 'no user fields may leak from a link probe');
      }
      const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
      assert.equal(row.usedAt, null, 'probing must not burn the token');

      const redeemed = await post('/api/auth/reset-password', { token, newPassword: 'after-three-probes' });
      assert.equal(redeemed.status, 200);

      const dead = await post('/api/auth/reset-password/check', { token });
      assert.deepEqual(dead.body, { valid: false });
    });
  });

  describe('the issue endpoint', () => {
    it('answers identically for a real and an unknown address, and mails only the real one', async () => {
      const user = await makeUser(`known-${run}@example.com`);

      sends = [];
      const known = await post('/api/auth/forgot-password', { email: user.email });
      await settle();
      const knownSends = sends.length;

      sends = [];
      const unknown = await post('/api/auth/forgot-password', { email: `nobody-${run}@example.com` });
      await settle(8);
      const unknownSends = sends.length;

      assert.equal(known.status, unknown.status);
      assert.deepEqual(known.body, unknown.body);
      assert.deepEqual(known.body, { ok: true });
      assert.equal(knownSends, 1);
      assert.equal(unknownSends, 0, 'an address with no account must never be mailed');
    });

    it('mails the address on the row, not the one in the request', async () => {
      const user = await makeUser(`rowaddr-${run}@example.com`);
      // Same address in different case: the schema lowercases, so the row is
      // found, and the send must use the row's own value.
      const { token } = await requestTokenFor(user.email.toUpperCase());
      assert.ok(token);
      assert.equal(sends[0].to[0].email, user.email);
    });

    it('refuses the old client payload outright, and writes no password', async () => {
      // Zod strips unknown keys by default, which would have meant the OLD
      // frontend's { email, newPassword } parsed to { email }, returned ok and
      // mailed a link — while the user's screen said the password was reset.
      const user = await makeUser(`oldclient-${run}@example.com`, 'original-password-1');
      const before = await prisma.user.findUnique({ where: { id: user.id } });

      const response = await post('/api/auth/forgot-password', {
        email: user.email,
        newPassword: 'the-old-takeover-1',
      });
      assert.equal(response.status, 400);

      const after = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(after.passwordHash, before.passwordHash);
      assert.equal(after.passwordChangedAt?.getTime() ?? null, before.passwordChangedAt?.getTime() ?? null);
    });

    it('suppresses a capped request invisibly, without burning the live link', async () => {
      // An address with no User row can never trip a per-user cap, so a 429 —
      // or any distinguishable response — would rebuild the enumeration oracle
      // the endpoint exists to close. And a cap that burned the outstanding
      // token before declining to send would lock the user out.
      const user = await makeUser(`capped-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      assert.ok(token);

      sends = [];
      const capped = await post('/api/auth/forgot-password', { email: user.email });
      await settle(8);

      assert.equal(capped.status, 200);
      assert.deepEqual(capped.body, { ok: true });
      assert.equal(sends.length, 0, 'the cooldown should have suppressed the send');

      const stillWorks = await post('/api/auth/reset-password', { token, newPassword: 'link-still-good-1' });
      assert.equal(stillWorks.status, 200, 'a suppressed request must not burn the live link');
    });

    it('a provider failure still answers 200, so it cannot be used to probe', async () => {
      const user = await makeUser(`provfail-${run}@example.com`);
      sendShouldThrow = true;
      const response = await post('/api/auth/forgot-password', { email: user.email });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { ok: true });
      // And the process is still alive to answer the next one — the detached
      // delivery's .catch is what makes that true.
      const followUp = await post('/api/auth/reset-password/check', { token: 'a'.repeat(43) });
      assert.equal(followUp.status, 200);
      sendShouldThrow = false;
    });
  });

  describe('the email', () => {
    it('carries the link built from PUBLIC_BASE_URL, ignoring the Host header', async () => {
      // trust proxy is on, which makes X-Forwarded-Host authoritative for
      // req.hostname — which is exactly why nothing on this path may read it.
      const user = await makeUser(`host-${run}@example.com`);
      sends = [];
      await post('/api/auth/forgot-password', { email: user.email }, {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-for': '10.9.9.9',
      });
      await settle();
      assert.equal(sends.length, 1);
      const { htmlContent, textContent, subject } = sends[0];
      for (const body of [htmlContent, textContent]) {
        assert.match(body, /https:\/\/mail\.example\.com\/reset-password\//);
        assert.equal(body.includes('evil.example'), false);
      }
      assert.equal(/reset-password|http/.test(subject), false, 'the subject must carry no link');
    });

    it('says the same thing in both parts, and carries nothing it should not', async () => {
      const user = await makeUser(`body-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      const { htmlContent, textContent } = sends[0];

      const fromHtml = /https:\/\/mail\.example\.com\/reset-password\/[A-Za-z0-9_-]+/.exec(htmlContent)[0];
      const fromText = /https:\/\/mail\.example\.com\/reset-password\/[A-Za-z0-9_-]+/.exec(textContent)[0];
      assert.equal(fromHtml, fromText);
      assert.ok(fromHtml.endsWith(token));

      // 60 minutes, from the one constant, in both parts.
      assert.match(htmlContent, /60 minutes/);
      assert.match(textContent, /60 minutes/);

      // No images, no tracking pixel, no remote resource but the link itself.
      assert.equal(/<img/i.test(htmlContent), false);
      const urls = htmlContent.match(/https?:\/\/[^"'\s)]+/g) || [];
      urls.forEach((url) => assert.ok(
        url.startsWith('https://mail.example.com/reset-password/'),
        `unexpected remote URL in the email: ${url}`,
      ));
    });

    it('escapes a workspace name, so it cannot smuggle markup into its own reset email', async () => {
      const hostile = `hostile-${run}`;
      await prisma.account.create({ data: { id: hostile, name: '<script>alert(1)</script>Acme' } });
      try {
        const user = await makeUser(`hostile-${run}@example.com`, 'original-password-1', hostile);
        await requestTokenFor(user.email);
        const { htmlContent, textContent } = sends[0];
        assert.match(htmlContent, /&lt;script&gt;/);
        assert.equal(htmlContent.includes('<script>alert(1)</script>'), false);
        // The text part is NOT escaped — escaping there would render "&amp;"
        // to the reader.
        assert.match(textContent, /<script>alert\(1\)<\/script>Acme/);
      } finally {
        await prisma.passwordResetToken.deleteMany({ where: { user: { accountId: hostile } } });
        await prisma.user.deleteMany({ where: { accountId: hostile } });
        await prisma.auditLog.deleteMany({ where: { accountId: hostile } });
        await prisma.account.delete({ where: { id: hostile } });
      }
    });
  });

  describe('audit', () => {
    it('records the request and the redeem against the right workspace, with no secrets', async () => {
      const user = await makeUser(`audit-${run}@example.com`);
      const { token } = await requestTokenFor(user.email);
      await post('/api/auth/reset-password', { token, newPassword: 'audited-password-1' });
      // The request-side row is written by the detached delivery.
      await new Promise((resolve) => { setTimeout(resolve, 200); });

      const rows = await prisma.auditLog.findMany({
        where: { resourceId: user.id, action: { startsWith: 'user.password.reset' } },
      });
      const actions = rows.map((row) => row.action).sort();
      assert.ok(actions.includes('user.password.reset_completed'), `expected a completed row, saw ${actions}`);

      rows.forEach((row) => {
        // accountId is what listAuditLogs filters on — a null here means the
        // workspace admin never sees that a reset happened.
        assert.equal(row.accountId, ACCOUNT, 'the row must land in the affected workspace');
        // The actor genuinely is unknown: whoever held the link.
        assert.equal(row.userId, null);
        assert.equal(row.userEmail, null);
        const blob = JSON.stringify(row.metadata ?? {});
        assert.equal(blob.includes(token), false, 'a token in the audit UI is takeover by colleague');
        assert.equal(blob.includes(hashToken(token)), false);
        assert.equal(blob.includes('audited-password-1'), false, 'the new password must never be audited');
      });
    });

    it('writes nothing at all for an address with no account', async () => {
      // recordAudit has no rate or size bound, so auditing unknown addresses
      // would hand an anonymous stranger an unbounded INSERT primitive.
      const before = await prisma.auditLog.count();
      for (let i = 0; i < 5; i += 1) {
         
        await post('/api/auth/forgot-password', { email: `ghost-${i}-${run}@example.com` });
      }
      await new Promise((resolve) => { setTimeout(resolve, 200); });
      assert.equal(await prisma.auditLog.count(), before);
    });
  });

  describe('the limiters are real', () => {
    it('the issue endpoint stops answering from one address', async () => {
      // Bypassed elsewhere in this file on purpose, so it has to be asserted
      // somewhere. authLimiter is 20 per 15 minutes, keyed on the caller.
      const caller = { 'x-forwarded-for': '198.51.100.7' };
      let sawLimit = false;
      for (let i = 0; i < 25; i += 1) {
         
        const response = await post('/api/auth/forgot-password', { email: `flood-${i}-${run}@example.com` }, caller);
        if (response.status === 429) { sawLimit = true; break; }
      }
      assert.ok(sawLimit, 'authLimiter must stop a flood from one address');
    });

    it('the redeem endpoint stops answering sooner, because it is a guessing oracle', async () => {
      const caller = { 'x-forwarded-for': '198.51.100.8' };
      let attempts = 0;
      let sawLimit = false;
      for (let i = 0; i < 15; i += 1) {
         
        const response = await post('/api/auth/reset-password', {
          token: crypto.randomBytes(32).toString('base64url'),
          newPassword: 'guessing-at-tokens-1',
        }, caller);
        attempts += 1;
        if (response.status === 429) { sawLimit = true; break; }
      }
      assert.ok(sawLimit, 'passwordChangeLimiter must bound token guessing');
      assert.ok(attempts <= 11, `expected the tighter limit to bite by ~10, took ${attempts}`);
    });
  });
});
