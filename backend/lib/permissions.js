// Backend RBAC: resolve a user's role into a set of granted areas, cache it,
// and enforce it. The area catalog + built-in role presets live in
// shared/permissions.js so the frontend uses the exact same definitions.
//
// Enforcement has two layers:
//   1. permissionGate — a central prefix→area middleware mounted once in
//      server.js. This is the source of truth; individual route files don't
//      sprinkle their own role checks.
//   2. requirePermission(area) — for the rare route that needs an explicit
//      guard (e.g. the roles CRUD).
//
// Reads vs writes: for the content areas (contacts, templates, campaigns…)
// only WRITES are gated. GETs stay open to any signed-in user so cross-area
// reads don't break — the campaign builder legitimately reads contacts and
// templates even for a campaigns-only role, and the frontend already hides
// pages a role can't use. The sensitive areas (connections, admin) gate
// EVERY method, reads included.
import { prisma } from './db.js';
import {
  ADMIN_AREA,
  ALL_AREA_KEYS,
  BUILT_IN_ROLES,
  hasArea,
} from '../../shared/permissions.js';

// accountId -> Map(roleKey -> string[] permissions). Roles change rarely, so
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
    byKey.set(role.key, Array.isArray(role.permissions) ? role.permissions : []);
  }
  cache.set(accountId, byKey);
  return byKey;
}

// Resolve a user's granted areas (array of area keys). The Admin role ALWAYS
// resolves to the full set — it can never be locked out, even if its DB row
// were somehow tampered with. An unknown role key (e.g. a deleted custom
// role still referenced by a stale JWT) grants nothing: deny by default.
export async function resolvePermissions(accountId, roleKey) {
  if (roleKey === 'admin') return [...ALL_AREA_KEYS];
  const byKey = await loadAccountRoles(accountId);
  const perms = byKey.get(roleKey);
  return Array.isArray(perms) ? [...perms] : [];
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
const GATE_ALL = 'all'; // gate every method (reads too)
const GATE_WRITE = 'write'; // gate only mutations; GETs stay open

// Ordered MOST-SPECIFIC FIRST. Paths are matched WITHOUT the /api prefix,
// because the gate is mounted with app.use('/api', permissionGate) and
// Express strips the mount path from req.path.
const RULES = [
  // Connections (account-level provider plumbing) — gate reads + writes.
  ['/settings/sender', 'connections', GATE_ALL],
  ['/integrations/webhook', 'connections', GATE_ALL],
  // Admin surface — reserved to the Admin role; gate everything.
  ['/admin', ADMIN_AREA, GATE_ALL],
  ['/roles', ADMIN_AREA, GATE_ALL],
  // Content areas — gate writes only; reads stay open for cross-area use.
  ['/contacts', 'contacts', GATE_WRITE],
  ['/audiences', 'contacts', GATE_WRITE],
  // Segments live under the Audience page now, so they share the `contacts`
  // area. (/api/sequences is no longer registered — the feature was removed.)
  ['/segments', 'contacts', GATE_WRITE],
  ['/templates', 'templates', GATE_WRITE],
  ['/campaigns', 'campaigns', GATE_WRITE],
  // General settings (forms, bounce handling, unsubscribes, preference
  // center). More specific /settings/sender + /integrations/webhook rules
  // above win for the connections bits.
  ['/settings', 'settings', GATE_WRITE],
  ['/integrations', 'settings', GATE_WRITE],
  ['/unsubscribes', 'settings', GATE_WRITE],
];

function matchRule(path) {
  return RULES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
}

// Central enforcement. Anything not covered by a rule (auth/me, notifications,
// events, assets, health, super-admin) falls through to the next handler —
// those are utility/shared endpoints or carry their own guard.
export function permissionGate(req, res, next) {
  const rule = matchRule(req.path);
  if (!rule) {
    next();
    return;
  }
  const [, area, mode] = rule;
  if (mode === GATE_WRITE && !WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (hasArea(req.user?.permissions, area)) {
    next();
    return;
  }
  res.status(403).json({ error: 'You do not have access to this area.', area });
}

// Explicit guard for a specific area. Assumes attachPermissions ran first.
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
