// Role-based access control.
//
// This suite was rewritten with the levelled model, and the rewrite is worth
// explaining: several tests here previously asserted the OPPOSITE of what
// they now assert. "leaves unlisted utility endpoints open — GET /events →
// next" was a passing test describing a hole, and "content areas gate writes
// only" was a passing test describing the export leak. A test can pin a bug
// in place as firmly as it pins a feature; the ones that did are inverted
// below, with the old expectation named so the change is not mistaken for a
// regression later.
//
// Three layers under test:
//   1. The normaliser — every shape that can arrive from the database.
//   2. The gate — prefix→area→level, deny-by-default, and the specific
//      endpoints that were reachable before.
//   3. Resolution + seeding against a real Postgres (skips if unreachable).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

import {
  ADMIN_AREA,
  areaAllows,
  BUILT_IN_ROLES,
  GRANTABLE_AREA_KEYS,
  effectivePermissions,
  hasArea,
  hasAnyArea,
  hasLevel,
  normalizePermissions,
  topLevelFor,
} from '../shared/permissions.js';
import {
  assertEveryRouteIsGated,
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

const preset = (key) => BUILT_IN_ROLES.find((r) => r.key === key).permissions;
const EDITOR = preset('editor');
const VIEWER = preset('viewer');
const ADMIN = (() => {
  const areas = {};
  GRANTABLE_AREA_KEYS.forEach((k) => { areas[k] = topLevelFor(k); });
  areas[ADMIN_AREA] = 'manage';
  return { v: 2, areas };
})();
const NOBODY = { v: 2, areas: {} };

describe('normalizePermissions — every shape that can arrive', () => {
  it('lifts a v1 array to the TOP rung of each area, not to write', () => {
    // The migration decision. Mapping v1 `campaigns` to 'write' would
    // silently take sending away from every role that had it, on deploy day,
    // with nobody having asked for that.
    const { areas } = normalizePermissions(['campaigns', 'contacts']);
    assert.equal(areas.campaigns, 'manage');
    assert.equal(areas.contacts, 'manage');
  });

  it('fans the old `settings` key out into its three successors', () => {
    const { areas } = normalizePermissions(['settings']);
    assert.equal(areas.forms, 'read');
    assert.equal(areas.bounces, 'write');
    assert.equal(areas.unsubscribes, 'manage');
  });

  it('strips admin, from the array form and the object form alike', () => {
    assert.equal(normalizePermissions(['admin', 'contacts']).areas.admin, undefined);
    assert.equal(
      normalizePermissions({ v: 2, areas: { admin: 'manage' } }).areas.admin,
      undefined,
    );
  });

  it('drops a level the area does not offer', () => {
    // Reports is read-only. 'manage' on it would be a level nothing checks,
    // which reads as a grant to whoever looks at the row next.
    assert.equal(
      normalizePermissions({ v: 2, areas: { analytics: 'manage' } }).areas.analytics,
      undefined,
    );
    assert.equal(
      normalizePermissions({ v: 2, areas: { analytics: 'read' } }).areas.analytics,
      'read',
    );
  });

  it('denies by default on garbage', () => {
    [null, undefined, 42, 'contacts', {}, { areas: 'yes' }].forEach((value) => {
      assert.deepEqual(normalizePermissions(value).areas, {}, `for ${JSON.stringify(value)}`);
    });
  });
});

describe('effectivePermissions — implied reads', () => {
  it('gives a campaigns role read on contacts and templates', () => {
    // Not generosity: the campaign builder resolves groups to recipients and
    // lists templates. This is the case that "reads are open to everyone"
    // was quietly covering for.
    const eff = effectivePermissions({ v: 2, areas: { campaigns: 'write' } });
    assert.equal(eff.contacts, 'read');
    assert.equal(eff.templates, 'read');
  });

  it('gives an analytics role read on campaigns, so Reports can name rows', () => {
    assert.equal(effectivePermissions(VIEWER).campaigns, 'read');
  });

  it('never raises an area a role already holds higher', () => {
    const eff = effectivePermissions({ v: 2, areas: { campaigns: 'write', contacts: 'manage' } });
    assert.equal(eff.contacts, 'manage');
  });

  it('only ever grants read — implication cannot hand out write', () => {
    const eff = effectivePermissions({ v: 2, areas: { campaigns: 'manage' } });
    assert.equal(eff.templates, 'read');
    assert.equal(hasLevel({ v: 2, areas: { campaigns: 'manage' } }, 'templates', 'write'), false);
  });
});

describe('hasLevel / hasArea / hasAnyArea', () => {
  it('is ordinal: manage implies write implies read', () => {
    const p = { v: 2, areas: { contacts: 'manage' } };
    assert.equal(hasLevel(p, 'contacts', 'read'), true);
    assert.equal(hasLevel(p, 'contacts', 'write'), true);
    assert.equal(hasLevel(p, 'contacts', 'manage'), true);
  });
  it('does not run the other way', () => {
    const p = { v: 2, areas: { contacts: 'read' } };
    assert.equal(hasLevel(p, 'contacts', 'write'), false);
    assert.equal(hasLevel(p, 'contacts', 'manage'), false);
  });
  it('still understands a v1 array, so a stale JWT keeps working', () => {
    assert.equal(hasArea(['contacts', 'templates'], 'contacts'), true);
    assert.equal(hasArea(['contacts'], 'connections'), false);
  });
  it('always grants the always-on dashboard area', () => {
    assert.equal(hasArea(NOBODY, 'dashboard'), true);
    assert.equal(hasArea(undefined, 'dashboard'), true);
  });
  it('is safe with absent permissions', () => {
    assert.equal(hasArea(undefined, 'contacts'), false);
    assert.equal(hasArea(null, 'contacts'), false);
  });
  it('hasAnyArea returns true if any area matches', () => {
    assert.equal(hasAnyArea(EDITOR, ['connections', 'bounces']), true);
    assert.equal(hasAnyArea(VIEWER, ['connections', 'bounces']), false);
  });
});

describe('permissionGate — the holes this release closed', () => {
  it('GET /contacts/export needs manage, not merely a signed-in session', () => {
    // WAS: 'next' for everyone. /contacts/export is a GET, and the old rule
    // for /contacts gated writes only, so any user of any role could
    // download the entire workspace as a CSV.
    assert.equal(gate('GET', '/contacts/export', VIEWER), 403);
    assert.equal(gate('GET', '/contacts/export', EDITOR), 403); // write, not manage
    assert.equal(gate('GET', '/contacts/export', { v: 2, areas: { contacts: 'manage' } }), 'next');
  });

  it('GET /events is gated on analytics', () => {
    // WAS: 'next' for everyone — no rule matched /events at all, and an
    // unmatched path fell through to next().
    assert.equal(gate('GET', '/events', NOBODY), 403);
    assert.equal(gate('GET', '/events', VIEWER), 'next');
  });

  it('POST /assets/logo is gated on templates', () => {
    // WAS: 'next' for everyone. Any signed-in user could write files into
    // the account.
    assert.equal(gate('POST', '/assets/logo', VIEWER), 403);
    assert.equal(gate('POST', '/assets/logo', EDITOR), 'next');
  });

  it('reads of content areas are gated now', () => {
    // WAS: 'next' for everyone, deliberately, so cross-area reads did not
    // break. IMPLIED_READS declares those instead.
    assert.equal(gate('GET', '/contacts', { v: 2, areas: { analytics: 'read' } }), 403);
    assert.equal(gate('GET', '/templates', NOBODY), 403);
  });

  it('bulk delete and bulk update need manage', () => {
    assert.equal(gate('POST', '/contacts/bulk-delete', { v: 2, areas: { contacts: 'write' } }), 403);
    assert.equal(gate('POST', '/contacts/bulk-delete', { v: 2, areas: { contacts: 'manage' } }), 'next');
  });

  it('sending is separable from editing', () => {
    const builder = { v: 2, areas: { campaigns: 'write' } };
    assert.equal(gate('PATCH', '/campaigns/abc', builder), 'next');   // can build
    assert.equal(gate('POST', '/campaigns/schedule', builder), 403);   // cannot send
    assert.equal(gate('POST', '/campaigns/test-email', builder), 403);
    assert.equal(gate('POST', '/campaigns/schedule', EDITOR), 'next'); // Editor has manage
  });

  it('DELETE can demand more than other writes on the same prefix', () => {
    const writer = { v: 2, areas: { contacts: 'write' } };
    assert.equal(gate('PUT', '/contacts/a@b.com', writer), 'next');
    assert.equal(gate('DELETE', '/contacts/a@b.com', writer), 403);
  });

  it('re-subscribing someone who opted out needs manage', () => {
    const writer = { v: 2, areas: { unsubscribes: 'write' } };
    assert.equal(gate('GET', '/unsubscribes', writer), 'next');
    assert.equal(gate('DELETE', '/unsubscribes/a@b.com', writer), 403);
    assert.equal(gate('DELETE', '/unsubscribes/a@b.com', { v: 2, areas: { unsubscribes: 'manage' } }), 'next');
  });
});

describe('permissionGate — deny by default', () => {
  it('refuses a path that matches no rule, even for an admin', () => {
    // The whole point. An endpoint added without a rule is closed, not open,
    // and the boot assertion turns that into a failed start rather than a
    // silent 403 in production.
    assert.equal(gate('GET', '/something-nobody-added-a-rule-for', ADMIN), 403);
  });

  it('does not match a sibling prefix (/contacts-export vs /contacts)', () => {
    // Still denied — but now because nothing matches, not because it slipped
    // through as an unlisted path.
    assert.equal(gate('POST', '/contacts-export', ADMIN), 403);
  });

  it('keeps pre-auth endpoints open', () => {
    assert.equal(gate('POST', '/auth/login', undefined), 'next');
    assert.equal(gate('POST', '/webhooks/brevo', undefined), 'next');
    assert.equal(gate('GET', '/health', undefined), 'next');
  });

  it('does NOT keep /notifications open — it reads the account event table', () => {
    // It sat in the OPEN list justified as "per-user, already scoped to the
    // caller". The handler queries the account-wide Event table and uses the
    // caller's own timestamps only to decide what is unread, so it re-served
    // the stream that closing /api/events was meant to protect.
    assert.equal(gate('GET', '/notifications', NOBODY), 403);
    assert.equal(gate('GET', '/notifications', VIEWER), 'next');
    // Marking read is a write on your own row, so it needs no more than the
    // read that got you the list.
    assert.equal(gate('POST', '/notifications/read', VIEWER), 'next');
  });

  it('/unsubscribe (public page) is open; /unsubscribes (the list) is not', () => {
    // One character apart, opposite meanings. A prefix match that treated
    // them as the same thing would publish the suppression list.
    assert.equal(gate('GET', '/unsubscribe', undefined), 'next');
    assert.equal(gate('GET', '/unsubscribes', NOBODY), 403);
  });

  it('/super-admin is not /admin, and is guarded inline instead', () => {
    assert.equal(gate('GET', '/super-admin/accounts', VIEWER), 'next');
  });
});

describe('permissionGate — the split that was one `settings` key', () => {
  it('an Editor sees bounce handling but not the sender identity', () => {
    // The thing that had no answer before: Settings was one permission, so
    // "an Editor shouldn't see the sender identity" meant taking the whole
    // page away.
    assert.equal(gate('GET', '/integrations/bounce-sync', EDITOR), 'next');
    assert.equal(gate('GET', '/settings/sender', EDITOR), 403);
    assert.equal(gate('POST', '/settings/sender', EDITOR), 403);
  });
  it('unsubscribe categories are unsubscribes, not connections', () => {
    assert.equal(gate('PUT', '/settings/unsubscribe-categories', { v: 2, areas: { unsubscribes: 'write' } }), 'next');
    assert.equal(gate('PUT', '/settings/unsubscribe-categories', { v: 2, areas: { connections: 'write' } }), 403);
  });
  it('blocks non-admins from /admin and /roles, reads included', () => {
    assert.equal(gate('GET', '/admin/users', EDITOR), 403);
    assert.equal(gate('GET', '/roles', EDITOR), 403);
    assert.equal(gate('GET', '/admin/users', ADMIN), 'next');
    assert.equal(gate('POST', '/roles', ADMIN), 'next');
  });
});

describe('permissionGate — privilege escalation', () => {
  it('a role holding every grantable area still is not an admin', () => {
    const everything = { v: 2, areas: {} };
    GRANTABLE_AREA_KEYS.forEach((k) => { everything.areas[k] = topLevelFor(k); });
    assert.equal(gate('GET', '/roles', everything), 403);
    assert.equal(gate('POST', '/admin/users', everything), 403);
  });

  it('a hand-crafted admin grant is stripped on read', () => {
    // Simulates a tampered row or a request that got past validation: the
    // normaliser removes it regardless of where it came from.
    const forged = normalizePermissions({ v: 2, areas: { admin: 'manage', contacts: 'read' } });
    assert.equal(gate('GET', '/roles', forged), 403);
    assert.equal(gate('GET', '/contacts', forged), 'next');
  });

  it('an implied read cannot be escalated into a write', () => {
    const builder = { v: 2, areas: { campaigns: 'manage' } };
    assert.equal(gate('GET', '/contacts', builder), 'next');
    assert.equal(gate('POST', '/contacts', builder), 403);
    assert.equal(gate('GET', '/contacts/export', builder), 403);
  });
});

describe('assertEveryRouteIsGated', () => {
  // Builds a fake Express app from a list of paths. The real one is called
  // in server.js with the real router; this proves the check itself works.
  const fakeApp = (paths) => ({ _router: { stack: paths.map((p) => ({ route: { path: p } })) } });

  it('passes when every route is covered', () => {
    assert.doesNotThrow(() => assertEveryRouteIsGated(
      fakeApp(['/api/contacts', '/api/auth/login', '/api/events']),
      { logger: { log() {} } },
    ));
  });

  it('throws, naming the route, when one is not', () => {
    assert.throws(
      () => assertEveryRouteIsGated(fakeApp(['/api/brand-new-thing']), { logger: { log() {} } }),
      /brand-new-thing/,
    );
  });

  it('ignores non-API routes (the SPA fallback, static files)', () => {
    assert.doesNotThrow(() => assertEveryRouteIsGated(
      fakeApp(['*', '/unsubscribe']),
      { logger: { log() {} } },
    ));
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
    assert.deepEqual(roles.map((r) => r.key).sort(), ['admin', 'editor', 'viewer']);
    assert.equal(roles.every((r) => r.isSystem), true);
  });

  it('resolves admin to every area at its top rung (never locked out)', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'admin');
    GRANTABLE_AREA_KEYS.forEach((key) => {
      assert.equal(perms.areas[key], topLevelFor(key), `admin should hold ${key} at its top rung`);
    });
    assert.equal(hasArea(perms, ADMIN_AREA), true);
  });

  it('resolves editor to write/manage on its areas, and nothing on connections', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'editor');
    assert.equal(hasLevel(perms, 'campaigns', 'manage'), true);
    assert.equal(hasLevel(perms, 'contacts', 'write'), true);
    assert.equal(hasLevel(perms, 'contacts', 'manage'), false);
    assert.equal(hasArea(perms, 'connections'), false);
    assert.equal(hasArea(perms, ADMIN_AREA), false);
  });

  it('resolves viewer to analytics, plus the campaigns read Reports needs', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'viewer');
    assert.equal(hasLevel(perms, 'analytics', 'read'), true);
    assert.equal(hasLevel(perms, 'campaigns', 'read'), true);
    assert.equal(hasLevel(perms, 'campaigns', 'write'), false);
    assert.equal(hasArea(perms, 'contacts'), false);
  });

  it('denies an unknown role (deleted/stale) — no areas at all', async () => {
    const perms = await resolvePermissions(ACCOUNT, 'ghost-role');
    assert.deepEqual(perms.areas, {});
    assert.equal(hasArea(perms, 'contacts'), false);
  });

  it('migrates a v1 array still sitting in the database', async () => {
    // The row shape that exists in every install today. It must keep working
    // without a data migration, and at the access it had.
    await prisma.role.update({
      where: { accountId_key: { accountId: ACCOUNT, key: 'viewer' } },
      data: { permissions: ['analytics', 'contacts'] },
    });
    invalidateAccountRoles(ACCOUNT);
    const perms = await resolvePermissions(ACCOUNT, 'viewer');
    assert.equal(hasLevel(perms, 'contacts', 'manage'), true);
    assert.equal(hasLevel(perms, 'analytics', 'read'), true);
  });

  it('seeding is idempotent and does not clobber edited presets', async () => {
    await seedAccountRoles(ACCOUNT); // re-seed must not reset the edit above
    invalidateAccountRoles(ACCOUNT);
    const perms = await resolvePermissions(ACCOUNT, 'viewer');
    assert.equal(hasArea(perms, 'contacts'), true);
  });

  it('reflects a custom levelled role after cache invalidation', async () => {
    await prisma.role.create({
      data: {
        accountId: ACCOUNT,
        key: 'support',
        name: 'Support',
        permissions: { v: 2, areas: { contacts: 'read', analytics: 'read' } },
        isSystem: false,
      },
    });
    invalidateAccountRoles(ACCOUNT);
    const perms = await resolvePermissions(ACCOUNT, 'support');
    assert.equal(hasLevel(perms, 'contacts', 'read'), true);
    assert.equal(hasLevel(perms, 'contacts', 'write'), false);
  });
});

describe('requirePermission', () => {
  it('passes when the area is granted, 403 otherwise', () => {
    const ok = mockRes();
    let okNext = false;
    requirePermission(ADMIN_AREA)({ user: { permissions: ADMIN } }, ok, () => { okNext = true; });
    assert.equal(okNext, true);

    const denied = mockRes();
    let deniedNext = false;
    requirePermission(ADMIN_AREA)({ user: { permissions: EDITOR } }, denied, () => { deniedNext = true; });
    assert.equal(deniedNext, false);
    assert.equal(denied.statusCode, 403);
  });
});

describe('PERMISSION_READ_ENFORCE=false — the staged cutover', () => {
  // Reads have never been enforced before this release, so a custom role in
  // some install may be relying on one it was never granted. The valve keeps
  // writes closed and turns read denials into a log line, so an admin can
  // fix the role rather than lose the morning.
  //
  // Imported fresh, because the flag is read once at module load — which is
  // itself the thing worth pinning: a per-request read would let someone
  // flip enforcement off without a restart.
  it('lets reads through, still refuses writes, and never opens admin', async () => {
    process.env.PERMISSION_READ_ENFORCE = 'false';
    const { permissionGate: lenient } = await import(
      `../backend/lib/permissions.js?lenient=${run}`
    );
    delete process.env.PERMISSION_READ_ENFORCE;

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    const relaxed = (method, path, permissions) => {
      const res = mockRes();
      let passed = false;
      lenient({ method, path, user: { permissions, role: 'ops' } }, res, () => { passed = true; });
      return passed ? 'next' : res.statusCode;
    };

    try {
      assert.equal(relaxed('GET', '/contacts', NOBODY), 'next');
      assert.equal(relaxed('POST', '/contacts', NOBODY), 403);
      // The export is a GET, so this is the one place the valve is load-
      // bearing in the wrong direction — it reopens the CSV leak. Which is
      // why it is opt-in, temporary, and says so in the log.
      assert.equal(relaxed('GET', '/contacts/export', NOBODY), 'next');
      // Admin is not a read/write question, so the valve does not touch it.
      assert.equal(relaxed('GET', '/roles', NOBODY), 403);
      // And a path with no rule at all stays closed: the valve relaxes
      // levels, not the deny-by-default itself.
      assert.equal(relaxed('GET', '/no-such-thing', ADMIN), 403);
      assert.equal(warnings.length > 0, true, 'should log what it let through');
      assert.match(warnings[0], /would deny GET \/contacts for role "ops"/);
    } finally {
      console.warn = realWarn;
    }
  });
});

describe('the roles route accepts the v1 arrays it promises to', () => {
  // The schema and the comment above it both name the back-compat case —
  // "an older tab left open overnight" — and the validator rejected three of
  // that vocabulary's own keys. It mapped every array entry to the level
  // 'write' and then checked it against the area's ladder, so `analytics`,
  // `forms` and the old `settings` key (which have no write rung) came back
  // 400. Validating the NORMALISED form asks the real question: a v1 entry
  // means the top rung its area offers.
  it('normalises a v1 array to levels its areas actually have', () => {
    const { areas } = normalizePermissions(['analytics', 'forms', 'settings']);
    assert.equal(areas.analytics, 'read');
    assert.equal(areas.forms, 'read');
    // `settings` fans out to the three areas that replaced it.
    assert.equal(areas.bounces, 'write');
    assert.equal(areas.unsubscribes, 'manage');
  });

  it('and every level it produces is one the area declares', () => {
    // The property the validator is really asserting. If this holds for the
    // normalised form, a v1 array can never be rejected for a level.
    const { areas } = normalizePermissions([...GRANTABLE_AREA_KEYS, 'settings']);
    Object.entries(areas).forEach(([key, level]) => {
      assert.equal(
        areaAllows(key, level),
        true,
        `${key} normalised to "${level}", which it does not offer`,
      );
    });
  });
});
