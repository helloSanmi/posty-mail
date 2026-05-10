import {
  audienceFromDb,
  deleteAudience,
  getAudience,
  listAudiences,
  listAudienceContacts,
  patchAudienceMembers,
  upsertAudience,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const audienceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  contacts: z
    .array(z.union([z.string().email(), z.object({ email: z.string().email() }).passthrough()]))
    .default([]),
});

const membersSchema = z.object({
  add: z.array(z.string().email()).optional(),
  remove: z.array(z.string().email()).optional(),
});

export function registerAudienceRoutes(app) {
  app.get('/api/audiences', asyncRoute(async (_req, res) => {
    res.json(await listAudiences());
  }));

  app.get('/api/audiences/:id', asyncRoute(async (req, res) => {
    const audience = await getAudience(req.params.id);
    if (!audience) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(audience);
  }));

  app.get('/api/audiences/:id/contacts', asyncRoute(async (req, res) => {
    const contacts = await listAudienceContacts(req.params.id);
    if (contacts === null) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(contacts);
  }));

  app.post(
    '/api/audiences',
    validate(audienceSchema),
    asyncRoute(async (req, res) => {
      const audience = {
        id: req.body.id || crypto.randomUUID(),
        name: req.body.name,
        contactEmails: req.body.contacts
          .map((contact) => typeof contact === 'string' ? contact : contact.email)
          .filter(Boolean)
          .map((email) => email.trim().toLowerCase()),
      };
      const saved = await upsertAudience(audience);
      await recordAudit(req, 'audience.save', 'audience', saved.id, { name: saved.name });
      res.status(201).json(audienceFromDb(saved));
    }),
  );

  app.patch(
    '/api/audiences/:id/members',
    validate(membersSchema),
    asyncRoute(async (req, res) => {
      const updated = await patchAudienceMembers(req.params.id, req.body);
      if (!updated) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      await recordAudit(req, 'audience.members', 'audience', updated.id, {
        added: req.body.add?.length || 0,
        removed: req.body.remove?.length || 0,
      });
      res.json(updated);
    }),
  );

  app.delete('/api/audiences/:id', asyncRoute(async (req, res) => {
    const result = await deleteAudience(req.params.id);
    if (result.count) await recordAudit(req, 'audience.delete', 'audience', req.params.id);
    res.json({ deleted: result.count });
  }));
}
