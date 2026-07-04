// Role-based access control. Two layers under test:
//   1. Pure gate logic — hasArea/hasAnyArea + the permissionGate middleware
//      (prefix→area, read-vs-write). No DB; always runs.
//   2. Resolution + seeding against a real Postgres (skips if unreachable,
//      same pattern as multiTenantIsolation.test.js). Creates a throwaway
//      account and tears it down, never touching real data.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import {
  hasArea,
  hasAnyArea,
  ALL_AREA_KEYS,
  GRANTABLE_AREA_KEYS,
} from '../shared/permissions.js';
import {
  permissionGate,
  requirePermission,
  resolvePermissions,
  seedAccountRoles,
  invalidateAccountRoles,
} from '../backend/lib/permissions.js';
import { prisma } from '../backend/lib/db.js';

// --- Test doubles for Express req/res/next -------------------------------
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

// Run the gate for a method+path+permissions; return 'next' if it passed
// through, or the HTTP status it rejected with.
function gate(method, path, permissions) {
  const req = { method, path, user: { permissions } };
  const res = mockRes();
  let passed = false;
  permissionGate(req, res, () => { passed = true; });
  return passed ? 'next' : res.statusCode;
}

const EDITOR = GRANTABLE_AREA_KEYS.filter((k) => k !== 'connections'); // no connections/admin
const VIEWER = ['analytics'];

describe('hasArea / hasAnyArea', () => {
  it('grants an area in the list', () => {
    assert.equal(hasArea(['contacts', 'templates'], 'contacts'), true);
  });
  it('denies an area not in the list', () => {
    assert.equal(hasArea(['contacts'], 'campaigns'), false);
  });
  it('always grants the always-on dashboard area', () => {
    assert.equal(hasArea([], 'dashboard'), true);
    assert.equal(hasArea(undefined, 'dashboard'), true);
  });
  it('is safe with non-array permissions', () => {
    assert.equal(hasArea(undefined, 'contacts'), false);
    assert.equal(hasArea(null, 'contacts'), false);
  });
  it('hasAnyArea returns true if any area matches', () => {
    assert.equal(hasAnyArea(['connections'], ['settings', 'connections']), true);
    assert.equal(hasAnyArea(['analytics'], ['settings', 'connections']), false);
  });
});

describe('permissionGate — connections + admin gate all methods', () => {
  it('blocks a reader without connections from GET /settings/sender', () => {
    assert.equal(gate('GET', '/settings/sender', EDITOR), 403);
  });
  it('blocks a writer without connections from POST /settings/sender', () => {
    assert.equal(gate('POST', '/settings/sender', EDITOR), 403);
  });
  it('allows a connections-granted role to read + write sender', () => {
    assert.equal(gate('GET', '/settings/sender', ['connections']), 'next');
    assert.equal(gate('POST', '/settings/sender', ['connections']), 'next');
  });
  it('gates the provider webhook on connections too', () => {
    assert.equal(gate('GET', '/integrations/webhook', EDITOR), 403);
    assert.equal(gate('POST', '/integrations/webhook', ['connections']), 'next');
  });
  it('blocks non-admins from /admin and /roles (reads included)', () => {
    assert.equal(gate('GET', '/admin/users', EDITOR), 403);
    assert.equal(gate('GET', '/roles', EDITOR), 403);
    assert.equal(gate('GET', '/admin/users', ALL_AREA_KEYS), 'next');
    assert.equal(gate('POST', '/roles', ALL_AREA_KEYS), 'next');
  });
});

describe('permissionGate — content areas gate writes only', () => {
  it('lets any signed-in user READ content (cross-area reads)', () => {
    // A viewer (analytics only) can still GET contacts/templates so the
    // campaign builder etc. do not break.
    assert.equal(gate('GET', '/contacts', VIEWER), 'next');
    assert.equal(gate('GET', '/templates', VIEWER), 'next');
    assert.equal(gate('GET', '/campaigns', VIEWER), 'next');
  });
  it('blocks WRITES to an area the role lacks', () => {
    assert.equal(gate('POST', '/contacts', VIEWER), 403);
    assert.equal(gate('DELETE', '/templates/abc', VIEWER), 403);
    assert.equal(gate('PATCH', '/campaigns/abc', VIEWER), 403);
  });
  it('allows writes to a granted area', () => {
    assert.equal(gate('POST', '/contacts', EDITOR), 'next');
    assert.equal(gate('PUT', '/segments/abc', EDITOR), 'next');
  });
  it('maps /audiences to the contacts area', () => {
    assert.equal(gate('POST', '/audiences', VIEWER), 403);
    assert.equal(gate('POST', '/audiences', ['contacts']), 'next');
  });
});

describe('permissionGate — matching boundaries + open endpoints', () => {
  it('does not match a sibling prefix (/contacts-export vs /contacts)', () => {
    assert.equal(gate('POST', '/contacts-export', VIEWER), 'next');
  });
  it('does not treat /super-admin as /admin', () => {
    assert.equal(gate('GET', '/super-admin/accounts', VIEWER), 'next');
  });
  it('leaves unlisted utility endpoints open', () => {
    assert.equal(gate('GET', '/events', VIEWER), 'next');
    assert.equal(gate('GET', '/notifications', VIEWER), 'next');
    assert.equal(gate('POST', '/assets/logos', VIEWER), 'next');
  });
  it('more-specific /settings/sender wins over general /settings', () => {
    // A settings-granted role reaches general settings writes...
    assert.equal(gate('PUT', '/settings/unsubscribe-categories', ['settings']), 'next');
    // ...but NOT the connections-only sender endpoint.
    assert.equal(gate('POST', '/settings/sender', ['settings']), 403);
  });
});

describe('requirePermission', () => {
  it('passes when the area is granted, 403 otherwise', () => {
    const ok = mockRes();
    let okNext = false;
    requirePermission('admin')({ user: { permissions: ALL_AREA_KEYS } }, ok, () => { okNext = true; });
    assert.equal(okNext, true);

    const denied = mockRes();
    let deniedNext = false;
    requirePermission('admin')({ user: { permissions: EDITOR } }, denied, () => { deniedNext = true; });
    assert.equal(deniedNext, false);
    assert.equal(denied.statusCode, 403);
  });
});

// --- DB-backed resolution + seeding --------------------------------------
let dbReachable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbReachable = false;
}

const run = crypto.randomUUID().slice(0, 8);
const ACCOUNT = `rbac-${run}`;

describe('role resolution + seeding (DB)', { skip: dbReachable ? false : 'no database reachable' }, () => {
  before(async () => {
    await prisma.account.create({ data: { id: ACCOUNT, name: `RBAC test ${run}` } });
    await seedAccountRoles(ACCOUNT);
  });

  after(async () => {
    await prisma.account.delete({ where: { id: ACCOUNT } }).catch(() => {});
    invalidateAccountRoles(ACCOUNT);
  });

  it('seeds the three built-in roles', async () => {
    const roles = await prisma.role.findMany({ where: { accountId: ACCOUNT } });
    const keys = roles.map((r) => r.key).sort();
    assert.deepEqual(keys, ['admin', 'editor', 'viewer']);
    assert.equal(roles.every((r) => r.isSystem), true);
  });

  it('resolves admin to the full area set (never locked out)', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'admin');
    assert.deepEqual(perms.sort(), [...ALL_AREA_KEYS].sort());
  });

  it('resolves editor to everything except connections + admin', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'editor');
    assert.equal(perms.includes('connections'), false);
    assert.equal(perms.includes('admin'), false);
    assert.equal(perms.includes('campaigns'), true);
  });

  it('resolves viewer to analytics only', async () => {
    assert.deepEqual(await resolvePermissions(ACCOUNT, 'viewer'), ['analytics']);
  });

  it('denies an unknown role (deleted/stale) — empty permissions', async () => {
    assert.deepEqual(await resolvePermissions(ACCOUNT, 'ghost-role'), []);
  });

  it('seeding is idempotent and does not clobber edited presets', async () => {
    await prisma.role.update({
      where: { accountId_key: { accountId: ACCOUNT, key: 'viewer' } },
      data: { permissions: ['analytics', 'contacts'] },
    });
    invalidateAccountRoles(ACCOUNT);
    await seedAccountRoles(ACCOUNT); // re-seed must not reset viewer
    assert.deepEqual(
      (await resolvePermissions(ACCOUNT, 'viewer')).sort(),
      ['analytics', 'contacts'],
    );
  });

  it('reflects a custom role after cache invalidation', async () => {
    await prisma.role.create({
      data: {
        accountId: ACCOUNT,
        key: 'support',
        name: 'Support',
        permissions: ['contacts', 'analytics'],
        isSystem: false,
      },
    });
    invalidateAccountRoles(ACCOUNT);
    assert.deepEqual(
      (await resolvePermissions(ACCOUNT, 'support')).sort(),
      ['analytics', 'contacts'],
    );
  });
});
