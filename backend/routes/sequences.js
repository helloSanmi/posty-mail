import crypto from 'node:crypto';
import {
  deleteSequence,
  enrollInSequence,
  getSequence,
  listEnrollmentsForSequence,
  listSequences,
  prisma,
  upsertSequence,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

// If the install didn't run `prisma generate` after the drip-sequences
// migration, the Prisma client won't have the Sequence/SequenceEnrollment
// models attached. Surface a clear 503 instead of a cryptic
// "Cannot read properties of undefined" 500.
function requireSequenceClient(_req, res, next) {
  if (!prisma.sequence || !prisma.sequenceEnrollment) {
    res.status(503).json({
      error: 'Sequences are not enabled on this install. Run `npm run db:deploy && npm run db:generate`, then restart the backend.',
      code: 'SEQUENCES_NOT_MIGRATED',
    });
    return;
  }
  next();
}

const stepSchema = z.object({
  order: z.number().int().min(0).max(50),
  delayDays: z.number().min(0).max(365),
  templateId: z.string().min(1).max(200),
});

const sequenceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  status: z.enum(['active', 'paused']).optional(),
  triggerType: z.enum(['group_added', 'manual']).optional(),
  triggerGroupId: z.string().uuid().optional().nullable(),
  steps: z.array(stepSchema).min(1).max(20),
});

const enrollSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(500),
});

export function registerSequenceRoutes(app) {
  // Gate every sequence route on the client being migration-current.
  app.use('/api/sequences', requireSequenceClient);

  app.get('/api/sequences', asyncRoute(async (_req, res) => {
    res.json(await listSequences());
  }));

  app.get('/api/sequences/:id', asyncRoute(async (req, res) => {
    const seq = await getSequence(req.params.id);
    if (!seq) {
      res.status(404).json({ error: 'Sequence not found' });
      return;
    }
    res.json(seq);
  }));

  app.post(
    '/api/sequences',
    validate(sequenceSchema),
    asyncRoute(async (req, res) => {
      const seq = {
        id: req.body.id || crypto.randomUUID(),
        name: req.body.name,
        status: req.body.status || 'active',
        triggerType: req.body.triggerType || 'group_added',
        triggerGroupId: req.body.triggerGroupId || null,
        steps: req.body.steps,
      };
      const saved = await upsertSequence(seq);
      await recordAudit(req, 'sequence.save', 'sequence', saved.id, {
        name: saved.name,
        steps: saved.steps.length,
      });
      res.status(201).json(saved);
    }),
  );

  app.delete('/api/sequences/:id', asyncRoute(async (req, res) => {
    const result = await deleteSequence(req.params.id);
    if (result.count) await recordAudit(req, 'sequence.delete', 'sequence', req.params.id);
    res.json({ deleted: result.count });
  }));

  // Manual enrollment. Admin-triggered (no group-add hook fired). Useful for
  // backfilling existing contacts into a newly-created sequence.
  app.post(
    '/api/sequences/:id/enroll',
    validate(enrollSchema),
    asyncRoute(async (req, res) => {
      let enrolled = 0;
      for (const email of req.body.emails) {
        const created = await enrollInSequence(req.params.id, email.trim().toLowerCase());
        if (created) enrolled += 1;
      }
      await recordAudit(req, 'sequence.enroll', 'sequence', req.params.id, { count: enrolled });
      res.json({ enrolled, total: req.body.emails.length });
    }),
  );

  app.get('/api/sequences/:id/enrollments', asyncRoute(async (req, res) => {
    const rows = await listEnrollmentsForSequence(req.params.id);
    res.json(rows.map((row) => ({
      id: row.id,
      email: row.email,
      enrolledAt: row.enrolledAt.toISOString(),
      nextStepIndex: row.nextStepIndex,
      nextRunAt: row.nextRunAt?.toISOString() || null,
      status: row.status,
      lastError: row.lastError || null,
    })));
  }));
}
