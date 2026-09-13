// Role management (admin-only). Lets a workspace admin create custom roles
// and tune what each can access, on top of the built-in admin/editor/viewer.
//
//   GET    /api/roles          list this account's roles (+ user counts)
//   POST   /api/roles          create a custom role
//   PATCH  /api/roles/:id      rename / change a role's granted areas
//   DELETE /api/roles/:id      delete a custom role (must be unused)
//
// Access: gated to the `admin` area centrally by permissionGate; the explicit
// requirePermission below is belt-and-suspenders. Every write invalidates the
// account's permission cache so changes take effect immediately.
import { prisma } from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { invalidateAccountRoles, requirePermission } from '../lib/permissions.js';
import {
  ADMIN_AREA,
  AREAS,
  BUILT_IN_ROLE_KEYS,
  GRANTABLE_AREA_KEYS,
  LEVEL_NAMES,
  areaAllows,
  normalizePermissions,
} from '../../shared/permissions.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

// Permissions arrive as the v2 map ({ areas: { contacts: 'write' } }). The
// bare v1 array is still accepted so an older tab left open overnight does
// not start failing — normalizePermissions lifts it to the same shape.
const permissionsSchema = z.union([
  z.array(z.string()),
  z.object({
    v: z.number().optional(),
    areas: z.record(z.string(), z.string()),
  }),
]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: permissionsSchema.default({ v: 2, areas: {} }),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  permissions: permissionsSchema.optional(),
});

// Turn a display name into a stable, URL-safe key. Falls back to 'role' if
// the name has no usable characters (e.g. all punctuation).
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'role';
}

async function uniqueKey(accountId, base) {
  let key = base;
  let suffix = 2;
  // Never collide with a built-in key or an existing role in this account.
  while (
    BUILT_IN_ROLE_KEYS.includes(key)
    || (await prisma.role.findUnique({ where: { accountId_key: { accountId, key } } }))
  ) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

// Reject anything that isn't a real area at a level that area actually
// offers. Two distinct rejections, and both matter:
//
//   * an unknown AREA — `admin` above all. It is deliberately excluded from
//     GRANTABLE_AREA_KEYS, so "permissions": { "areas": { "admin": "manage" } }
//     in a hand-rolled request is refused here, and stripped again by the
//     normaliser, and stripped a third time on read. An admin granting
//     themselves nothing new is not interesting; a compromised admin session
//     minting a role that outlives it is.
//   * a level the area does not have — asking for `analytics: 'manage'`
//     would otherwise store a level nothing checks, which reads as a grant
//     to whoever looks at the row next.
//
// Silently dropping either would be worse than refusing: the admin would see
// a saved role that does not do what the screen said it did.
function invalidEntries(permissions) {
  // A v1 array carries no level, so every entry was mapped to 'write' and
  // then checked against the area's ladder — which rejected the three areas
  // that have no write rung (analytics, forms, and the old `settings` key).
  // So the back-compat path the schema and the comment above both promise
  // returned 400 for exactly the vocabulary it was meant to accept.
  //
  // normalizePermissions already knows what a v1 entry means: the TOP rung
  // the area offers. Validating the normalised form asks the real question.
  const areas = Array.isArray(permissions)
    ? normalizePermissions(permissions).areas
    : (permissions?.areas || {});
  const bad = [];
  Object.entries(areas).forEach(([key, level]) => {
    if (!GRANTABLE_AREA_KEYS.includes(key)) {
      bad.push(`${key} is not an access area`);
      return;
    }
    if (!LEVEL_NAMES.includes(level)) {
      bad.push(`${level} is not an access level`);
      return;
    }
    if (level !== 'none' && !areaAllows(key, level)) {
      const area = AREAS.find((a) => a.key === key);
      bad.push(`${area.label} has no "${level}" level (it offers ${area.levels.join(', ')})`);
    }
  });
  return bad;
}

function shapeRole(role, userCount) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    // Always the canonical v2 map, whatever the row happens to hold — the
    // UI never has to know that v1 arrays exist.
    permissions: normalizePermissions(role.permissions),
    isSystem: role.isSystem,
    // The Admin role is fully locked (always full access); the UI disables
    // its edit/delete controls.
    locked: role.key === 'admin',
    userCount,
  };
}

export function registerRoleRoutes(app) {
  const adminOnly = requirePermission(ADMIN_AREA);

  app.get('/api/roles', adminOnly, asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const roles = await prisma.role.findMany({
      where: { accountId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    const counts = await prisma.user.groupBy({
      by: ['role'],
      where: { accountId },
      _count: { _all: true },
    });
    const countByKey = Object.fromEntries(counts.map((c) => [c.role, c._count._all]));
    res.json(roles.map((role) => shapeRole(role, countByKey[role.key] || 0)));
  }));

  app.post('/api/roles', adminOnly, validate(createSchema), asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const bad = invalidEntries(req.body.permissions);
    if (bad.length) {
      res.status(400).json({ error: bad.join('; ') });
      return;
    }
    const key = await uniqueKey(accountId, slugify(req.body.name));
    const role = await prisma.role.create({
      data: {
        accountId,
        key,
        name: req.body.name,
        // Normalised on the way in as well as on the way out, so the
        // database only ever holds the canonical shape.
        permissions: normalizePermissions(req.body.permissions),
        isSystem: false,
      },
    });
    invalidateAccountRoles(accountId);
    await recordAudit(req, 'role.create', 'role', role.id, {
      key: role.key, name: role.name, permissions: role.permissions,
    });
    res.status(201).json(shapeRole(role, 0));
  }));

  app.patch('/api/roles/:id', adminOnly, validate(updateSchema), asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const role = await prisma.role.findFirst({ where: { id: req.params.id, accountId } });
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    // The Admin role is the safety anchor — it always has full access and
    // can't be edited, so an admin can never lock themselves (or everyone)
    // out of the account.
    if (role.key === 'admin') {
      res.status(400).json({ error: 'The Admin role has full access and cannot be edited.' });
      return;
    }
    if (req.body.permissions) {
      const bad = invalidEntries(req.body.permissions);
      if (bad.length) {
        res.status(400).json({ error: bad.join('; ') });
        return;
      }
    }
    const updated = await prisma.role.update({
      where: { id: role.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.permissions !== undefined
          ? { permissions: normalizePermissions(req.body.permissions) }
          : {}),
      },
    });
    invalidateAccountRoles(accountId);
    await recordAudit(req, 'role.update', 'role', updated.id, { changes: req.body });
    const userCount = await prisma.user.count({ where: { accountId, role: updated.key } });
    res.json(shapeRole(updated, userCount));
  }));

  app.delete('/api/roles/:id', adminOnly, asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const role = await prisma.role.findFirst({ where: { id: req.params.id, accountId } });
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    if (role.isSystem) {
      res.status(400).json({ error: 'Built-in roles cannot be deleted.' });
      return;
    }
    // Don't orphan users onto a role key that no longer resolves (they'd
    // lose all access). Make the admin reassign them first.
    const inUse = await prisma.user.count({ where: { accountId, role: role.key } });
    if (inUse > 0) {
      res.status(409).json({
        error: `${inUse} ${inUse === 1 ? 'user is' : 'users are'} still assigned this role. Reassign them, then delete it.`,
      });
      return;
    }
    await prisma.role.delete({ where: { id: role.id } });
    invalidateAccountRoles(accountId);
    await recordAudit(req, 'role.delete', 'role', role.id, { key: role.key, name: role.name });
    res.json({ ok: true });
  }));
}
