// Backend RBAC: resolve a user's role into a levelled map of granted areas,
// cache it, and enforce it. The area catalog + built-in role presets live in
// shared/permissions.js so the frontend uses the exact same definitions.
//
// Enforcement has two layers:
//   1. permissionGate — a central prefix→area middleware mounted once in
//      server.js. This is the source of truth; individual route files don't
//      sprinkle their own role checks.
//   2. requirePermission(area) — for the rare route that needs an explicit
//      guard on top (e.g. super-admin).
//
// READS ARE NOW GATED TOO. They were not, and that was the bug: the gate
// only looked at writes for content areas, so every signed-in user could GET
// contacts, campaigns, templates and settings whatever their role — most
// visibly GET /api/contacts/export, the entire workspace as a CSV. Reads
// were left open because cross-area reads are real (the campaign builder
// needs contacts and templates); IMPLIED_READS in shared/permissions.js
// names those explicitly instead, so the legitimate case is declared and the
// rest is closed.
import { prisma } from './db.js';
import {
  ADMIN_AREA,
  BUILT_IN_ROLES,
  GRANTABLE_AREA_KEYS,
  effectivePermissions,
  hasArea,
  hasLevel,
  normalizePermissions,
  topLevelFor,
} from '../../shared/permissions.js';

// accountId -> Map(roleKey -> stored permissions, in whatever shape the row
// holds; normalising happens in resolvePermissions). Roles change rarely, so
// we cache per account and blow the whole account's entry away on any role
// write (see invalidateAccountRoles, called from the roles routes + seeder).
const cache = new Map();

export function invalidateAccountRoles(accountId) {
  cache.delete(accountId);
}

export function invalidateAllRoles() {
  cache.clear();
}

async function loadAccountRoles(accountId) {
  const cached = cache.get(accountId);
  if (cached) return cached;
  const byKey = new Map();
  const roles = await prisma.role.findMany({ where: { accountId } });
  for (const role of roles) {
    // Stored as-is; normalising happens in resolvePermissions so every
    // shape still in the database — the v1 array, the v2 object, a corrupt
    // row — converges on one canonical map.
    byKey.set(role.key, role.permissions);
  }
  cache.set(accountId, byKey);
  return byKey;
}

// Resolve a user's granted areas as a LEVELLED MAP. The Admin role ALWAYS
// resolves to the full set — it can never be locked out, even if its DB row
// were somehow tampered with. An unknown role key (e.g. a deleted custom
// role still referenced by a stale JWT) grants nothing: deny by default.
export async function resolvePermissions(accountId, roleKey) {
  if (roleKey === 'admin') {
    // The built-in Admin holds every area at its top rung, plus the admin
    // area itself. Not stored, not editable, not reachable from a role.
    const areas = {};
    GRANTABLE_AREA_KEYS.forEach((key) => { areas[key] = topLevelFor(key); });
    areas[ADMIN_AREA] = 'manage';
    return { v: 2, areas, __effective: { ...areas } };
  }
  const byKey = await loadAccountRoles(accountId);
  const stored = byKey.get(roleKey);
  const normalized = normalizePermissions(stored);
  // The effective map is cached on the object so the gate does not
  // recompute implied reads on every request.
  return { ...normalized, __effective: effectivePermissions(stored) };
}

// Middleware: attach the caller's resolved permissions to req.user so the
// gate (and downstream handlers) can read them. Mounted after requireAuth.
export async function attachPermissions(req, _res, next) {
  try {
    if (req.user) {
      req.user.permissions = await resolvePermissions(req.user.accountId, req.user.role);
    }
    next();
  } catch (error) {
    next(error);
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that are deliberately reachable by any AUTHENTICATED user, or by
// nobody because they are pre-auth. This list is the other half of
// deny-by-default: anything not matched by a rule and not named here fails
// the boot assertion below, so a route added next year cannot be silently
// open the way /api/events and /api/assets were.
const OPEN = [
  // login, signup, me, status, and the three unauthenticated password-reset
  // endpoints (forgot-password, reset-password, reset-password/check).
  //
  // isOpen() prefix-matches, so those three were covered by this one entry the
  // moment they were written — assertEveryRouteIsGated will NOT flag a mistake
  // under /auth. Each of them gates itself in its own handler. Documenting
  // them here, never widening: any addition to this array in service of
  // password reset is wrong by definition.
  '/auth',

  '/health',
  '/webhooks',        // provider callbacks, signature-checked
  '/public',          // the embeddable subscribe endpoint
  '/unsubscribe',     // the public one-click page, not /unsubscribes
  '/super-admin',     // guarded inline by requireSuperAdmin on every route
];

// Ordered MOST-SPECIFIC FIRST. Paths are matched WITHOUT the /api prefix,
// because the gate is mounted with app.use('/api', permissionGate) and
// Express strips the mount path from req.path.
//
// Each rule declares the level a READ needs and the level a WRITE needs.
// Omitting one side means that side is not gated; `null` means it is
// forbidden outright. Defaults are read:'read', write:'write', so an
// ordinary rule is one line.
const RW = { read: 'read', write: 'write' };
const RULES = [
  // --- contacts ---------------------------------------------------------
  // export is a GET that hands over the entire workspace as a CSV. It was
  // sitting under a writes-only rule, so any signed-in user could take it.
  ['/contacts/export', 'contacts', { read: 'manage' }],
  ['/contacts/bulk-delete', 'contacts', { write: 'manage' }],
  ['/contacts/bulk-update', 'contacts', { write: 'manage' }],
  ['/contacts', 'contacts', { read: 'read', write: 'write', delete: 'manage' }],
  ['/audiences', 'contacts', RW],
  // A POST that reads: the filter is too big for a query string, but
  // previewing who a segment would match is not an edit.
  ['/segments/preview', 'contacts', { read: 'read', write: 'read' }],
  ['/segments', 'contacts', RW],

  // --- templates --------------------------------------------------------
  ['/templates', 'templates', RW],
  // Logo upload and asset deletion had no rule at all: any signed-in user
  // could write files into the account. They belong to the editor that
  // uses them.
  ['/assets', 'templates', { read: 'read', write: 'write' }],

  // --- campaigns --------------------------------------------------------
  // Sending is not editing. These three reach real people or cannot be
  // undone.
  ['/campaigns/schedule', 'campaigns', { write: 'manage' }],
  ['/campaigns/test-email', 'campaigns', { write: 'manage' }],
  ['/campaigns', 'campaigns', { read: 'read', write: 'write', delete: 'manage' }],

  // --- reports ----------------------------------------------------------
  // /events had no rule whatsoever: the entire event stream was readable by
  // a role holding nothing.
  ['/events', 'analytics', { read: 'read' }],
  // Was in the OPEN list, justified as "per-user, already scoped to the
  // caller". It is not: the handler reads the account-wide Event table and
  // uses the caller's own timestamps only to decide what counts as unread.
  // So it re-served the same event stream /events had just been closed for,
  // through a door nobody thought to look at.
  ['/notifications', 'analytics', { read: 'read', write: 'read' }],
  ['/analytics', 'analytics', { read: 'read' }],

  // --- what used to be one `settings` key -------------------------------
  // Settings was ONE permission covering the sender identity, bounce
  // handling, the preference centre and the suppression list. That is four
  // different jobs, and "an Editor shouldn't see all of Settings" had no
  // answer short of taking the whole page away.
  ['/settings/sender', 'connections', RW],
  ['/settings/status', 'connections', { read: 'read' }],
  ['/integrations/webhook', 'connections', RW],
  ['/integrations/bounce-sync', 'bounces', RW],
  ['/integrations', 'bounces', RW],
  ['/settings/unsubscribe-categories', 'unsubscribes', RW],
  // Re-subscribing someone who opted out is a compliance act, not an edit,
  // so DELETE asks for more than PUT does.
  ['/unsubscribes', 'unsubscribes', { read: 'read', write: 'write', delete: 'manage' }],
  // NOTE: `forms` has no rule because it has no endpoints of its own — the
  // subscribe-form builder is a snippet generator that reads groups (covered
  // by IMPLIED_READS) and posts to the public /api/public/subscribe. It is a
  // real area all the same: it gates a Settings section. If a /settings/forms
  // route is ever added, the boot assertion below will refuse to start until
  // it gets a rule here, which is the point.
  // There is deliberately NO catch-all '/settings' rule. A new settings
  // endpoint should fail the boot assertion, not quietly inherit whatever
  // area happened to be last in the list.

  // --- the reserved area ------------------------------------------------
  ['/admin', ADMIN_AREA, { read: 'read', write: 'write' }],
  ['/roles', ADMIN_AREA, { read: 'read', write: 'write' }],
];

function matchRule(path) {
  return RULES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
}

function isOpen(path) {
  return OPEN.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Reads have never been enforced before this release, so there is a real
// chance that some custom role in some install was quietly relying on a read
// it was never granted. On a self-hosted app with no rollback button, that
// is an outage someone discovers at 9am.
//
// PERMISSION_READ_ENFORCE=false keeps WRITES enforced (they always were) and
// turns read denials into a log line naming the role and the path, so an
// admin can fix the role and then switch it back on. It defaults to ON: an
// escape hatch nobody has to find is worth having, an escape hatch that is
// the default is just the old behaviour with extra steps.
const ENFORCE_READS = process.env.PERMISSION_READ_ENFORCE !== 'false';

// Central enforcement. One middleware, one table, one mount point — a model
// that needs checks sprinkled through fifty route files is a model that will
// be enforced in forty-eight of them.
export function permissionGate(req, res, next) {
  const path = req.path;
  if (isOpen(path)) {
    next();
    return;
  }
  const isWrite = WRITE_METHODS.has(req.method);
  const rule = matchRule(path);
  if (!rule) {
    // Deny by default. The boot assertion means this should be unreachable
    // for any registered route; if it fires in production, something was
    // mounted without a rule and refusing is the safe answer.
    res.status(403).json({ error: 'Not permitted' });
    return;
  }
  const [, area, needs] = rule;
  // DELETE can require more than other writes — deleting a contact is not
  // the same act as editing one.
  const need = req.method === 'DELETE' && needs.delete
    ? needs.delete
    : (isWrite ? needs.write : needs.read);
  if (need == null) {
    next();
    return;
  }
  if (hasLevel(req.user?.permissions, area, need)) {
    next();
    return;
  }
  // The valve covers the areas whose reads were open before, and nothing
  // else. Admin reads — the user list, the audit trail, the roles
  // themselves — were ALWAYS gated, so relaxing them would not be restoring
  // old behaviour, it would be a new hole opened by the thing meant to
  // prevent one.
  if (!isWrite && !ENFORCE_READS && area !== ADMIN_AREA) {
    console.warn(
      `[auth] would deny ${req.method} ${path} for role "${req.user?.role}" `
      + `(needs ${area}:${need}) — PERMISSION_READ_ENFORCE=false`,
    );
    next();
    return;
  }
  res.status(403).json({ error: 'Not permitted' });
}

// Walks the registered Express routes at boot and refuses to start if any
// /api path is neither covered by a rule nor explicitly opened.
//
// This exists because the holes this release closes were all the same bug:
// a route was added and nobody remembered the table. Silent exposure
// becomes a failed deploy, which is the only version of this check that
// works — a lint rule gets skipped, a comment gets ignored, a test for
// "every route has a rule" gets written once and never updated.
export function assertEveryRouteIsGated(app, { logger = console } = {}) {
  const stack = app?._router?.stack || app?.router?.stack || [];
  const missing = [];
  stack.forEach((layer) => {
    const routePath = layer?.route?.path;
    if (typeof routePath !== 'string' || !routePath.startsWith('/api')) return;
    const path = routePath.slice('/api'.length) || '/';
    if (isOpen(path) || matchRule(path)) return;
    missing.push(routePath);
  });
  if (missing.length) {
    const list = [...new Set(missing)].join('\n  ');
    throw new Error(
      `Refusing to start: ${missing.length} /api route(s) have no permission rule `
      + `and are not in the OPEN list. Add them to RULES in `
      + `backend/lib/permissions.js:\n  ${list}`,
    );
  }
  logger.log?.(`[auth] every /api route is covered by a permission rule`);
}

export function requirePermission(area) {
  return (req, res, next) => {
    if (hasArea(req.user?.permissions, area)) {
      next();
      return;
    }
    res.status(403).json({ error: 'You do not have access to this area.', area });
  };
}

// Seed the built-in roles into an account. Idempotent: `create` fills in a
// missing role; `update: {}` deliberately never clobbers an admin's edits to
// the editor/viewer permission sets. Call on signup + at startup.
export async function seedAccountRoles(accountId) {
  for (const def of BUILT_IN_ROLES) {
    await prisma.role.upsert({
      where: { accountId_key: { accountId, key: def.key } },
      create: {
        accountId,
        key: def.key,
        name: def.name,
        permissions: def.permissions,
        isSystem: true,
      },
      update: {},
    });
  }
  invalidateAccountRoles(accountId);
}

// Ensure every existing account has its built-in roles. Runs once at startup
// so installs that predate this feature get seeded without a data migration.
export async function ensureAllAccountsSeeded() {
  const accounts = await prisma.account.findMany({ select: { id: true } });
  for (const account of accounts) {
    await seedAccountRoles(account.id);
  }
}
