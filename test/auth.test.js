import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

const { hashPassword, verifyPassword, signToken, verifyToken, publicUser } = await import('../backend/lib/auth.js');

test('hashPassword + verifyPassword round-trip', async () => {
  const hash = await hashPassword('hunter2-correct');
  assert.notEqual(hash, 'hunter2-correct');
  assert.equal(await verifyPassword('hunter2-correct', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('signToken + verifyToken round-trip', () => {
  const user = { id: 'u-1', email: 'a@b.com', role: 'admin' };
  const token = signToken(user);
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'u-1');
  assert.equal(payload.email, 'a@b.com');
  assert.equal(payload.role, 'admin');
});

test('verifyToken rejects garbage', () => {
  assert.throws(() => verifyToken('not-a-token'));
});

test('publicUser strips passwordHash', () => {
  const user = {
    id: 'u-1',
    email: 'a@b.com',
    name: 'A',
    role: 'admin',
    passwordHash: 'should-not-leak',
  };
  const safe = publicUser(user);
  assert.equal(safe.passwordHash, undefined);
  assert.equal(safe.email, 'a@b.com');
});
