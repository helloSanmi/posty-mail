// Install-level super-admin routes — cross-workspace management.
//
// Distinct from routes/admin.js, which is single-workspace ("admin of MY
// account"). These routes operate across EVERY account and are gated by
// requireSuperAdmin (the install owner, flagged on User.isSuperAdmin).
//
//   GET    /api/super-admin/accounts        list every workspace + counts
//   DELETE /api/super-admin/accounts/:id     delete a workspace (cascade)
//
// Mounted after requireAuth in server.js, so req.user is always present.
import { requireSuperAdmin } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { asyncRoute } from '../utils/store.js';

export function registerSuperAdminRoutes(app) {
  // List all workspaces with headline counts. One grouped query per child
  // table keeps this to a handful of round-trips regardless of how many
  // accounts exist (vs. N+1 per account).
  app.get('/api/super-admin/accounts', requireSuperAdmin, asyncRoute(async (_req, res) => {
    const [accounts, users, contacts, campaigns] = await Promise.all([
      prisma.account.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.user.groupBy({ by: ['accountId'], _count: true }),
      prisma.contact.groupBy({ by: ['accountId'], _count: true }),
      prisma.campaign.groupBy({ by: ['accountId'], _count: true }),
    ]);

    // Build lookup maps so each account row gets O(1) count access.
    const countFor = (rows) => {
      const map = new Map();
      rows.forEach((row) => map.set(row.accountId, row._count));
      return map;
    };
    const userCounts = countFor(users);
    const contactCounts = countFor(contacts);
    const campaignCounts = countFor(campaigns);

    res.json(accounts.map((account) => ({
      id: account.id,
      name: account.name,
      senderEmail: account.senderEmail || null,
      createdAt: account.createdAt.toISOString(),
      users: userCounts.get(account.id) || 0,
      contacts: contactCounts.get(account.id) || 0,
      campaigns: campaignCounts.get(account.id) || 0,
    })));
  }));

  // Delete a workspace and everything in it (FK cascade wipes contacts,
  // campaigns, users, etc.). Two guards: the 'default' workspace can't be
  // deleted (it's the install's home + holds the super-admin), and a
  // super-admin can't delete the workspace they're currently signed into.
  app.delete('/api/super-admin/accounts/:id', requireSuperAdmin, asyncRoute(async (req, res) => {
    const { id } = req.params;
    if (id === 'default') {
      res.status(400).json({ error: 'The default workspace cannot be deleted.' });
      return;
    }
    if (id === req.user.accountId) {
      res.status(400).json({ error: 'You cannot delete the workspace you are signed into.' });
      return;
    }
    const account = await prisma.account.findUnique({ where: { id } });
    if (!account) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    await prisma.account.delete({ where: { id } });
    await recordAudit(req, 'account.delete', 'account', id, { name: account.name });
    res.json({ ok: true });
  }));
}
