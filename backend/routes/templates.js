import {
  deleteTemplate,
  listTemplates,
  prisma,
  templateFromDb,
  upsertTemplate,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { sanitizeEmailHtml, sanitizeSubject } from '../lib/sanitize.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(998),
  html: z.string().min(1),
  text: z.string().min(1),
  logoUrl: z.string().optional(),
}).passthrough();

export function registerTemplateRoutes(app) {
  app.get('/api/templates', asyncRoute(async (_req, res) => {
    res.json(await listTemplates());
  }));

  app.post(
    '/api/templates',
    validate(templateSchema),
    asyncRoute(async (req, res) => {
      const id = getTemplateId(req.body.id);
      const name = req.body.name.trim();

      const conflict = await prisma.template.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          NOT: { id },
        },
        select: { id: true },
      });
      if (conflict) {
        res.status(409).json({ error: 'A template with that name already exists.' });
        return;
      }

      const template = {
        ...req.body,
        id,
        name,
        subject: sanitizeSubject(req.body.subject),
        html: sanitizeEmailHtml(req.body.html),
        text: String(req.body.text).slice(0, 100000),
        logoUrl: req.body.logoUrl || '',
      };
      const saved = await upsertTemplate(template);
      await recordAudit(req, 'template.save', 'template', saved.id, { name: saved.name });
      res.status(201).json(templateFromDb(saved));
    }),
  );

  app.delete('/api/templates/:id', asyncRoute(async (req, res) => {
    const id = decodeURIComponent(req.params.id);

    if (!id.startsWith('custom-')) {
      res.status(400).json({ error: 'Built-in templates cannot be deleted' });
      return;
    }

    const result = await deleteTemplate(id);
    if (result.count) await recordAudit(req, 'template.delete', 'template', id);
    res.json({ deleted: result.count, id });
  }));
}

function getTemplateId(id) {
  return id?.startsWith('custom-') ? id : `custom-${crypto.randomUUID()}`;
}
