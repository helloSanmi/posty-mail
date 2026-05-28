// Drafts CRUD — list / upsert / delete. The Builder autosaves to these
// rows; a draft becomes a real campaign at schedule time.
import { listDrafts, prisma, upsertDraft } from '../../lib/db.js';
import { recordAudit } from '../../lib/audit.js';
import { validate } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import { draftSchema } from './schemas.js';

export function registerDraftRoutes(app) {
  app.get('/api/campaigns/drafts', asyncRoute(async (req, res) => {
    res.json(await listDrafts(req.user.accountId));
  }));

  app.post(
    '/api/campaigns/drafts',
    validate(draftSchema),
    asyncRoute(async (req, res) => {
      const draft = {
        ...req.body,
        id: req.body.id || `draft-${crypto.randomUUID()}`,
      };
      await upsertDraft(req.user.accountId, draft);
      res.status(201).json({ ...draft, updatedAt: new Date().toISOString() });
    }),
  );

  app.delete('/api/campaigns/drafts/:id', asyncRoute(async (req, res) => {
    const result = await prisma.draft.deleteMany({
      where: { id: req.params.id, accountId: req.user.accountId },
    });
    if (result.count) await recordAudit(req, 'draft.delete', 'draft', req.params.id);
    res.json({ deleted: result.count });
  }));
}
