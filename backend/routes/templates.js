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

const HIDDEN_BUILTINS_KEY = 'templates.hiddenBuiltins';

async function readHiddenBuiltins() {
  const setting = await prisma.setting.findUnique({ where: { key: HIDDEN_BUILTINS_KEY } });
  return Array.isArray(setting?.value) ? setting.value : [];
}

async function writeHiddenBuiltins(ids) {
  const value = [...new Set(ids)];
  await prisma.setting.upsert({
    where: { key: HIDDEN_BUILTINS_KEY },
    create: { key: HIDDEN_BUILTINS_KEY, value },
    update: { value },
  });
  return value;
}

export function registerTemplateRoutes(app) {
  app.get('/api/templates', asyncRoute(async (_req, res) => {
    res.json(await listTemplates());
  }));

  // List of built-in template ids the admin has hidden. Built-ins ship as
  // code (defaultTemplates.js) so we can't actually delete them — instead
  // their ids land in a Setting row, and every client filters them out.
  // Server-side state, not localStorage — so hides persist across browsers
  // and machines once an admin has decided not to use a starter.
  app.get('/api/templates/hidden-builtins', asyncRoute(async (_req, res) => {
    res.json(await readHiddenBuiltins());
  }));

  // Restore a previously-hidden built-in. Mostly for completeness and the
  // future "Restore hidden templates" UI; admins can also clear the whole
  // Setting row manually if they want everything back.
  app.delete('/api/templates/hidden-builtins/:id', asyncRoute(async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const current = await readHiddenBuiltins();
    if (!current.includes(id)) {
      res.json({ restored: 0, hiddenBuiltins: current });
      return;
    }
    const next = current.filter((x) => x !== id);
    await writeHiddenBuiltins(next);
    await recordAudit(req, 'template.unhide', 'template', id);
    res.json({ restored: 1, hiddenBuiltins: next });
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

    // Built-in templates live in code (defaultTemplates.js) so a real DELETE
    // would do nothing — we can't strip them from disk. Instead, record the
    // admin's intent in the Setting table; every list-fetch filters them
    // out. Survives cache clears, syncs across devices, audit-logged.
    if (!id.startsWith('custom-')) {
      const current = await readHiddenBuiltins();
      if (!current.includes(id)) {
        const next = await writeHiddenBuiltins([...current, id]);
        await recordAudit(req, 'template.hide', 'template', id);
        res.json({ hidden: 1, id, hiddenBuiltins: next });
        return;
      }
      res.json({ hidden: 0, id, hiddenBuiltins: current });
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
