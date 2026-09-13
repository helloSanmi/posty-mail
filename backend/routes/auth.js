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
import { recordAudit } from '../lib/audit.js';
import { revokeOtherSessions } from '../lib/sessions.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

// Bundle a user with their resolved area permissions for the client.
//
// This is the levelled map ({ v: 2, areas: { campaigns: 'manage' } }) plus a
// precomputed __effective including implied reads, so the client answers
// can('campaigns', 'manage') without recomputing implications on every
// render. The frontend uses it to decide which nav items, pages, settings
// sections and buttons to show.
//
// It decides what is DRAWN and nothing else. Backend enforcement is
// independent (permissionGate) and does not trust this object — it resolves
// the role again from the caller's JWT on every request.
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

// Name and location only. Trimmed, length-capped, and empty means "clear
// it" rather than "leave it" — a person removing their location should be
// able to, and a nullable column is how that is spelled.
const profileSchema = z.object({
  name: z.string().trim().max(80).optional(),
  location: z.string().trim().max(80).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  // Opt-in. Changing a password and ending every other session are related
  // but separate acts: someone tidying up their password monthly should not
  // have to sign back in on their phone, and someone who thinks they have
  // been compromised needs to be able to.
  signOutOthers: z.boolean().optional(),
  // Same floor as signup. A self-service change that accepted weaker
  // passwords than the signup form would be a hole dressed as convenience.
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again later.' },
});

// Tighter than authLimiter and keyed the same way. A password-change form
// that will verify the current password is a password ORACLE: whoever holds
// a session can sit and guess the real owner's password against it. Twenty
// tries per quarter-hour is plenty for someone who mistyped and useless for
// someone who is guessing.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password attempts. Try again later.' },
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

  // --- self-service profile ------------------------------------------------
  //
  // These are the only routes in the app where a user changes their OWN
  // record, so the shape of them matters more than their size.
  //
  // What they deliberately cannot touch: email, role, isSuperAdmin,
  // accountId. Every one of those is an escalation if self-served — role and
  // isSuperAdmin obviously, email because it is the login identity and the
  // password-reset target, accountId because it is the tenant boundary. The
  // update below names its fields explicitly rather than spreading req.body,
  // so adding a column to the User model cannot quietly make it writable.
  app.patch(
    '/api/auth/profile',
    requireAuth,
    validate(profileSchema),
    asyncRoute(async (req, res) => {
      // A JWT lives 7 days and there is no token store, so a user deleted by
      // an admin keeps a working token until it expires. Without this check
      // the update throws a raw Prisma error and the client gets a 500, where
      // /auth/me and /auth/password both answer 401 for the same situation.
      const existing = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!existing) {
        res.status(401).json({ error: 'Account no longer exists' });
        return;
      }
      const data = {};
      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.location !== undefined) data.location = req.body.location;
      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data,
        include: { account: true },
      });
      await recordAudit(req, 'user.profile.update', 'user', req.user.id, {
        fields: Object.keys(data),
      });
      res.json({ user: await userWithPermissions(updated) });
    }),
  );

  // Changing your own password REQUIRES the current one.
  //
  // Not a formality. A session token that leaks — a shared machine, a stolen
  // laptop, an XSS — otherwise lets whoever holds it set a new password and
  // lock the real owner out of their own workspace, turning a temporary
  // compromise into a permanent one. Asking for the current password means
  // the attacker needs the thing they were trying to obtain.
  //
  // The failure is also deliberately slow-ish and generic: bcrypt.compare
  // costs real time, and the message never distinguishes "wrong password"
  // from anything else.
  app.post(
    '/api/auth/password',
    // requireAuth FIRST. The limiter keys on req.ip, so mounted ahead of the
    // auth check an unauthenticated stranger behind the same NAT — or any
    // stranger at all — could burn the quota with tokenless requests and lock
    // a real user out of changing their own password. Rejecting the anonymous
    // request before it counts costs nothing and removes the denial-of-service.
    requireAuth,
    passwordChangeLimiter,
    validate(passwordChangeSchema),
    asyncRoute(async (req, res) => {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) {
        res.status(401).json({ error: 'Account no longer exists' });
        return;
      }
      if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
        // Audited as a failure, because a run of these on one account is
        // exactly the signal an admin would want to see afterwards.
        await recordAudit(req, 'user.password.failed', 'user', user.id, {});
        res.status(400).json({ error: 'Your current password is not correct.' });
        return;
      }
      if (req.body.newPassword === req.body.currentPassword) {
        res.status(400).json({ error: 'Choose a password you have not used here before.' });
        return;
      }
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(req.body.newPassword),
          passwordChangedAt: new Date(),
        },
        include: { account: true },
      });
      // Ending the other sessions, when asked.
      //
      // Order matters: bump FIRST, then mint the replacement with the new
      // version. Minting first would revoke the token we are about to hand
      // back, and sign the caller out of the device they are sitting at.
      let tokenVersion;
      if (req.body.signOutOthers) {
        tokenVersion = await revokeOtherSessions(user.id);
      }

      await recordAudit(req, 'user.password.change', 'user', user.id, {
        signedOutOtherSessions: Boolean(req.body.signOutOthers),
      });

      // A fresh token either way, so the caller is not left holding one
      // minted before the change. The user comes back too, so the profile
      // page can show the new "last changed" without a reload.
      res.json({
        token: signToken(user, tokenVersion),
        ok: true,
        signedOutOthers: Boolean(req.body.signOutOthers),
        user: await userWithPermissions(updated),
      });
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
      passwordResetEnabled: process.env.ALLOW_PASSWORD_RESET === 'true',
    });
  }));

  app.post(
    '/api/auth/forgot-password',
    authLimiter,
    validate(forgotSchema),
    asyncRoute(async (req, res) => {
      // OPT-IN, not opt-out. This was `!== 'false'` — on by default — and
      // what it does is set ANY user's password given only their email
      // address, with no authentication, no token, no proof that the caller
      // owns the mailbox, and no email sent. That is a complete account
      // takeover of every workspace on every install that had not thought
      // to switch it off, and it voids the current-password check on
      // /api/auth/password entirely: an attacker with a session never needs
      // your old password, because this route hands them a new one.
      //
      // Flipping the default is the smallest fix that closes it. Anyone who
      // deliberately turned it on keeps it; everyone else stops shipping a
      // takeover they never chose. The real answer is a tokenised reset sent
      // to the address on file, which needs a token table and a send — a
      // bigger change than a security hole should wait for.
      //
      // Admins can still reset a password for anyone in their workspace,
      // authenticated, from Access.
      if (process.env.ALLOW_PASSWORD_RESET !== 'true') {
        res.status(403).json({
          error: 'Password reset is disabled on this server. Ask an admin to set a new password for you.',
        });
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
        // Stamped here too. A reset IS a password change, and a field that
        // only tracked one of the two routes would quietly go stale.
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      res.json({ ok: true });
    }),
  );
}
