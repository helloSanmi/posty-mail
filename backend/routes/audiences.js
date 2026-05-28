import {
  audienceFromDb,
  deleteAudience,
  getAudience,
  listAudiences,
  listAudienceContacts,
  patchAudienceMembers,
  renameAudience,
  setAudienceDisabled,
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
  app.get('/api/audiences', asyncRoute(async (req, res) => {
    res.json(await listAudiences(req.user.accountId));
  }));

  app.get('/api/audiences/:id', asyncRoute(async (req, res) => {
    const audience = await getAudience(req.user.accountId, req.params.id);
    if (!audience) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }
    res.json(audience);
  }));

  app.get('/api/audiences/:id/contacts', asyncRoute(async (req, res) => {
    const contacts = await listAudienceContacts(req.user.accountId, req.params.id);
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
      const saved = await upsertAudience(req.user.accountId, audience);
      await recordAudit(req, 'audience.save', 'audience', saved.id, { name: saved.name });
      res.status(201).json(audienceFromDb(saved));
    }),
  );

  app.patch(
    '/api/audiences/:id/members',
    validate(membersSchema),
    asyncRoute(async (req, res) => {
      const updated = await patchAudienceMembers(req.user.accountId, req.params.id, req.body);
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
    const result = await deleteAudience(req.user.accountId, req.params.id);
    if (result.count) await recordAudit(req, 'audience.delete', 'audience', req.params.id);
    res.json({ deleted: result.count });
  }));

  // Rename a group. Only the name changes. Membership and disabled state
  // are untouched. Separate from the POST upsert because that one also
  // rewrites the member list.
  app.patch(
    '/api/audiences/:id/name',
    validate(z.object({ name: z.string().min(1).max(120) })),
    asyncRoute(async (req, res) => {
      const updated = await renameAudience(
        req.user.accountId,
        req.params.id,
        req.body.name.trim(),
      );
      if (!updated) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      await recordAudit(req, 'audience.rename', 'audience', updated.id, {
        name: updated.name,
      });
      res.json(updated);
    }),
  );

  // Toggle disabled. Disabled groups are kept in the DB (members, send
  // history references) but excluded from the campaign recipient picker.
  // Used to retire a group without losing its data.
  app.patch(
    '/api/audiences/:id/disabled',
    validate(z.object({ disabled: z.boolean() })),
    asyncRoute(async (req, res) => {
      const updated = await setAudienceDisabled(
        req.user.accountId,
        req.params.id,
        req.body.disabled,
      );
      if (!updated) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      await recordAudit(
        req,
        req.body.disabled ? 'audience.disable' : 'audience.enable',
        'audience',
        updated.id,
      );
      res.json(updated);
    }),
  );
}
