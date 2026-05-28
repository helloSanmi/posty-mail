import { prisma } from './db.js';

export async function recordAudit(req, action, resource, resourceId = null, metadata = null) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        userEmail: req.user?.email || null,
        action,
        resource,
        resourceId: resourceId ? String(resourceId) : null,
        metadata: metadata || null,
        ip: getClientIp(req),
        // Tag the row with the actor's account so the per-tenant audit
        // view can filter to "things that happened in MY workspace."
        // Super-admin actions on the Account model itself have no parent
        // account — those leave accountId null (allowed by the schema).
        accountId: req.user?.accountId || null,
      },
    });
  } catch (error) {
    // never block a request because audit logging failed
    console.error('audit log failed', error.message);
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || null;
}

export async function listAuditLogs({
  accountId, limit = 100, resource, resourceId, userId,
} = {}) {
  return prisma.auditLog.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      ...(resource ? { resource } : {}),
      ...(resourceId ? { resourceId: String(resourceId) } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
  });
}
