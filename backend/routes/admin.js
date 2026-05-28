import { hashPassword, publicUser, requireRole } from '../lib/auth.js';
import { listAuditLogs, recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const ROLES = ['admin', 'editor', 'viewer'];

const createUserSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8),
  name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES).optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8),
});

export function registerAdminRoutes(app) {
  const adminOnly = requireRole('admin');

  app.get('/api/admin/users', adminOnly, asyncRoute(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(users.map(publicUser));
  }));

  app.post(
    '/api/admin/users',
    adminOnly,
    validate(createUserSchema),
    asyncRoute(async (req, res) => {
      const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (existing) {
        res.status(409).json({ error: 'A user with that email already exists' });
        return;
      }

      // Admin-created users land in the SAME account as the admin who
      // created them. This is the "invite a teammate to my workspace"
      // path — distinct from public signup (which creates a brand-new
      // account). Once the super-admin UI lands, super-admins will be
      // able to create users in any account; for now it's a single hop.
      const user = await prisma.user.create({
        data: {
          email: req.body.email,
          passwordHash: await hashPassword(req.body.password),
          name: req.body.name || null,
          role: req.body.role || 'editor',
          accountId: req.user.accountId,
        },
      });
      await recordAudit(req, 'user.create', 'user', user.id, { email: user.email, role: user.role });
      res.status(201).json(publicUser(user));
    }),
  );

  app.patch(
    '/api/admin/users/:id',
    adminOnly,
    validate(updateUserSchema),
    asyncRoute(async (req, res) => {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Prevent admins from demoting themselves to a non-admin if they're the last admin.
      if (req.body.role && req.body.role !== 'admin' && target.id === req.user.id) {
        const adminCount = await prisma.user.count({ where: { role: 'admin' } });
        if (adminCount <= 1) {
          res.status(400).json({ error: 'You cannot remove the last admin role' });
          return;
        }
      }

      const updated = await prisma.user.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined ? { name: req.body.name || null } : {}),
          ...(req.body.role ? { role: req.body.role } : {}),
        },
      });
      await recordAudit(req, 'user.update', 'user', updated.id, { changes: req.body });
      res.json(publicUser(updated));
    }),
  );

  app.post(
    '/api/admin/users/:id/password',
    adminOnly,
    validate(resetPasswordSchema),
    asyncRoute(async (req, res) => {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      await prisma.user.update({
        where: { id: req.params.id },
        data: { passwordHash: await hashPassword(req.body.password) },
      });
      await recordAudit(req, 'user.password_reset', 'user', target.id);
      res.json({ ok: true });
    }),
  );

  app.delete('/api/admin/users/:id', adminOnly, asyncRoute(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (target.id === req.user.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    if (target.role === 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        res.status(400).json({ error: 'You cannot delete the last admin' });
        return;
      }
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    await recordAudit(req, 'user.delete', 'user', target.id, { email: target.email });
    res.json({ ok: true });
  }));

  app.get('/api/admin/audit', adminOnly, asyncRoute(async (req, res) => {
    const logs = await listAuditLogs({
      limit: req.query.limit,
      resource: req.query.resource,
      resourceId: req.query.resourceId,
      userId: req.query.userId,
    });
    res.json(logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })));
  }));
}
