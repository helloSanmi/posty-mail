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

// Rule schema. Mirrors RULE_FIELDS / RULE_OPS in segmentFilter.js — keep in
// lockstep when you add a new field or operator.
const ruleSchema = z.object({
  field: z.enum(['email', 'firstname', 'lastname', 'region', 'consent']),
  op: z.enum([
    'equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty',
  ]),
  value: z.string().max(500).optional(),
});

// Filter schema. Both the legacy flat shape (kept for backward-compat with
// already-saved segments) and the new richer shape are accepted. The
// translator drops anything it doesn't understand, so .passthrough() is safe.
const filterSchema = z.object({
  // legacy single-field shortcuts
  search: z.string().optional(),
  region: z.string().optional(),
  consent: z.string().optional(),
  excludeUnsubscribed: z.boolean().optional(),
  // new rules
  rules: z.array(ruleSchema).max(20).optional(),
  combinator: z.enum(['AND', 'OR']).optional(),
  // date range
  addedAfter: z.string().optional(),
  addedBefore: z.string().optional(),
  // group membership
  inAnyGroup: z.array(z.string()).max(50).optional(),
}).partial().passthrough();

const segmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  filter: filterSchema,
});

// Resolve any `inAnyGroup` group-id list to the email set those groups
// contain. The translator can then splice it in via the existing
// `_inAnyGroupEmails` channel. Empty list means "no constraint."
async function resolveGroupEmails(filter) {
  if (!Array.isArray(filter.inAnyGroup) || !filter.inAnyGroup.length) return null;
  const rows = await prisma.audience.findMany({
    where: { id: { in: filter.inAnyGroup } },
    select: { contactEmails: true },
  });
  const set = new Set();
  for (const row of rows) {
    for (const email of (row.contactEmails || [])) set.add(email);
  }
  return Array.from(set);
}

async function buildResolvedFilter(filter) {
  const resolved = { ...(filter || {}) };
  if (resolved.excludeUnsubscribed) {
    resolved._unsubscribedEmails = Array.from(await unsubscribedEmailSet());
  }
  const groupEmails = await resolveGroupEmails(resolved);
  if (groupEmails) resolved._inAnyGroupEmails = groupEmails;
  return resolved;
}

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
    const resolved = await buildResolvedFilter(segment.filter);
    const where = buildContactWhere(resolved);
    const [count, sample] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({ where, take: 25, orderBy: { savedAt: 'desc' } }),
    ]);
    res.json({ count, sample: sample.map(contactFromDb) });
  }));

  // Ad-hoc preview. Powers the composer's live preview before the segment is
  // saved — POST so the filter rides in the body cleanly. Read-only, no side
  // effects. Capped at 25 sample rows like the by-id preview.
  app.post(
    '/api/segments/preview',
    validate(z.object({ filter: filterSchema })),
    asyncRoute(async (req, res) => {
      const resolved = await buildResolvedFilter(req.body.filter || {});
      const where = buildContactWhere(resolved);
      const [count, sample] = await prisma.$transaction([
        prisma.contact.count({ where }),
        prisma.contact.findMany({ where, take: 25, orderBy: { savedAt: 'desc' } }),
      ]);
      res.json({ count, sample: sample.map(contactFromDb) });
    }),
  );

  app.get('/api/segments/:id/contacts', asyncRoute(async (req, res) => {
    const segment = await prisma.segment.findUnique({ where: { id: req.params.id } });
    if (!segment) {
      res.status(404).json({ error: 'Segment not found' });
      return;
    }
    const resolved = await buildResolvedFilter(segment.filter);
    const where = buildContactWhere(resolved);
    const rows = await prisma.contact.findMany({ where, orderBy: { savedAt: 'desc' } });
    res.json(rows.map(contactFromDb));
  }));
}
