import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/db.js';
import {
  hashPassword,
  publicUser,
  requireAuth,
  signToken,
  userCount,
  verifyPassword,
} from '../lib/auth.js';
import { resolvePermissions, seedAccountRoles } from '../lib/permissions.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

// Bundle a user with their resolved area permissions for the client. The
// frontend uses `permissions` to decide which nav items / pages / settings
// sections to show. Backend enforcement is independent (permissionGate).
async function userWithPermissions(user) {
  const permissions = await resolvePermissions(user.accountId, user.role);
  return { ...publicUser(user), permissions };
}

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

export function registerAuthRoutes(app) {
  app.post(
    '/api/auth/signup',
    authLimiter,
    validate(credentialsSchema),
    asyncRoute(async (req, res) => {
      const existingCount = await userCount();
      const allowOpenSignup = process.env.ALLOW_OPEN_SIGNUP === 'true';

      if (existingCount > 0 && !allowOpenSignup) {
        res.status(403).json({ error: 'Signup is closed. Ask an admin to invite you.' });
        return;
      }

      const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (existing) {
        res.status(409).json({ error: 'An account with that email already exists' });
        return;
      }

      const passwordHash = await hashPassword(req.body.password);
      // Each signup gets its OWN Account (workspace). The very first
      // user on a fresh install still lands in the 'default' account
      // that the multi-tenant migration seeded, so their existing data
      // (created pre-multi-tenancy) stays attached to their session.
      // Every subsequent signup creates a brand-new Account so their
      // data is isolated from everyone else's.
      const accountId = existingCount === 0
        ? 'default'
        : (await prisma.account.create({
            data: {
              name: req.body.name
                ? `${req.body.name}'s workspace`
                : `${req.body.email.split('@')[0]}'s workspace`,
            },
          })).id;

      const user = await prisma.user.create({
        data: {
          email: req.body.email,
          passwordHash,
          name: req.body.name || null,
          // First user on the install is the super-admin (admin of the
          // default workspace). Subsequent signups are admins of their
          // OWN workspace — they're the owner of the Account they just
          // created, even though they're not super-admin of the install.
          role: 'admin',
          isSuperAdmin: existingCount === 0,
          accountId,
        },
        include: { account: true },
      });

      // Make sure this account has its built-in roles before we resolve the
      // new user's permissions. The 'default' account is seeded at startup;
      // a freshly-created account is seeded here. Idempotent either way.
      await seedAccountRoles(user.accountId);

      res.status(201).json({
        token: signToken(user),
        user: await userWithPermissions(user),
      });
    }),
  );

  app.post(
    '/api/auth/login',
    authLimiter,
    validate(loginSchema),
    asyncRoute(async (req, res) => {
      const user = await prisma.user.findUnique({
        where: { email: req.body.email },
        include: { account: true },
      });

      if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      res.json({ token: signToken(user), user: await userWithPermissions(user) });
    }),
  );

  app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { account: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }
    res.json({ user: await userWithPermissions(user) });
  }));

  app.get('/api/auth/status', asyncRoute(async (_req, res) => {
    res.json({
      hasUsers: (await userCount()) > 0,
      openSignup: process.env.ALLOW_OPEN_SIGNUP === 'true',
      passwordResetEnabled: process.env.ALLOW_PASSWORD_RESET !== 'false',
    });
  }));

  app.post(
    '/api/auth/forgot-password',
    authLimiter,
    validate(forgotSchema),
    asyncRoute(async (req, res) => {
      if (process.env.ALLOW_PASSWORD_RESET === 'false') {
        res.status(403).json({ error: 'Password reset is disabled on this server.' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (!user) {
        // Don't disclose whether the email exists. Pretend success.
        res.json({ ok: true });
        return;
      }

      const passwordHash = await hashPassword(req.body.newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      res.json({ ok: true });
    }),
  );
}
