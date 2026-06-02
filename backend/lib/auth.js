import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const TOKEN_TTL = '7d';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set to at least 16 characters in production');
    }
    return 'dev-only-insecure-secret-change-me';
  }

  return secret;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  // Embed accountId in the JWT so every authenticated request carries
  // the tenant scope without an extra DB round-trip. Old tokens issued
  // before multi-tenancy lack this claim — requireAuth falls back to
  // the 'default' account for backward compatibility (existing data
  // was backfilled into that workspace by the multi-tenant migration).
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountId: user.accountId,
      isSuperAdmin: Boolean(user.isSuperAdmin),
    },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    role: user.role,
    accountId: user.accountId,
    // Workspace name, when the account relation is loaded by the caller.
    // Lets the frontend show "Acme's workspace" in the sidebar without a
    // second request. Null when the relation wasn't included.
    accountName: user.account?.name || null,
    isSuperAdmin: Boolean(user.isSuperAdmin),
  };
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      // Backward compat: tokens issued before multi-tenancy don't
      // carry an accountId. Treat them as the default workspace so
      // existing sessions keep working through the rollout.
      accountId: payload.accountId || 'default',
      isSuperAdmin: Boolean(payload.isSuperAdmin),
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

// Gate for the install-level super-admin routes (cross-workspace
// management). Distinct from requireRole('admin'), which only checks the
// caller's role WITHIN their own workspace.
export function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: 'Super-admin access required' });
    return;
  }
  next();
}

export async function userCount() {
  return prisma.user.count();
}
