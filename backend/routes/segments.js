import {
  buildContactWhere,
  contactFromDb,
  deleteSegment,
  listSegments,
  prisma,
  unsubscribedEmailSet,
  upsertSegment,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const filterSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  consent: z.string().optional(),
  excludeUnsubscribed: z.boolean().optional(),
}).partial();

const segmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  filter: filterSchema,
});

export function registerSegmentRoutes(app) {
  app.get('/api/segments', asyncRoute(async (_req, res) => {
    res.json(await listSegments());
  }));

  app.post(
    '/api/segments',
    validate(segmentSchema),
    asyncRoute(async (req, res) => {
      const segment = {
        id: req.body.id || crypto.randomUUID(),
        name: req.body.name,
        filter: req.body.filter || {},
      };
      const saved = await upsertSegment(segment);
      await recordAudit(req, 'segment.save', 'segment', saved.id, { name: saved.name });
      res.status(201).json({
        id: saved.id,
        name: saved.name,
        filter: saved.filter,
        updatedAt: saved.updatedAt.toISOString(),
      });
    }),
  );

  app.delete('/api/segments/:id', asyncRoute(async (req, res) => {
    const result = await deleteSegment(req.params.id);
    if (result.count) await recordAudit(req, 'segment.delete', 'segment', req.params.id);
    res.json({ deleted: result.count, id: req.params.id });
  }));

  app.get('/api/segments/:id/preview', asyncRoute(async (req, res) => {
    const segment = await prisma.segment.findUnique({ where: { id: req.params.id } });
    if (!segment) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }
    const filter = { ...(segment.filter || {}) };
    if (filter.excludeUnsubscribed) {
      filter._unsubscribedEmails = Array.from(await unsubscribedEmailSet());
    }
    const where = buildContactWhere(filter);
    const [count, sample] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, take: 25, orderBy: { savedAt: 'desc' } }),
    ]);
    res.json({ count, sample: sample.map(contactFromDb) });
  }));

  app.get('/api/segments/:id/contacts', asyncRoute(async (req, res) => {
    const segment = await prisma.segment.findUnique({ where: { id: req.params.id } });
    if (!segment) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }
    const filter = { ...(segment.filter || {}) };
    if (filter.excludeUnsubscribed) {
      filter._unsubscribedEmails = Array.from(await unsubscribedEmailSet());
    }
    const where = buildContactWhere(filter);
    const rows = await prisma.contact.findMany({ where, orderBy: { savedAt: 'desc' } });
    res.json(rows.map(contactFromDb));
  }));
}
