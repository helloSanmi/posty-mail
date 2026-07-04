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
  BUILT_IN_ROLE_KEYS,
  GRANTABLE_AREA_KEYS,
} from '../../shared/permissions.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  permissions: z.array(z.string()).optional(),
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

// Reject any area that isn't a real grantable area. `admin` is deliberately
// excluded from GRANTABLE_AREA_KEYS — it can never be handed to a custom or
// editable role, only the built-in Admin role holds it.
function invalidAreas(permissions) {
  return permissions.filter((area) => !GRANTABLE_AREA_KEYS.includes(area));
}

function shapeRole(role, userCount) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
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
    const bad = invalidAreas(req.body.permissions);
    if (bad.length) {
      res.status(400).json({ error: `Unknown access areas: ${bad.join(', ')}` });
      return;
    }
    const key = await uniqueKey(accountId, slugify(req.body.name));
    const role = await prisma.role.create({
      data: {
        accountId,
        key,
        name: req.body.name,
        permissions: req.body.permissions,
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
      const bad = invalidAreas(req.body.permissions);
      if (bad.length) {
        res.status(400).json({ error: `Unknown access areas: ${bad.join(', ')}` });
        return;
      }
    }
    const updated = await prisma.role.update({
      where: { id: role.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.permissions !== undefined ? { permissions: req.body.permissions } : {}),
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
