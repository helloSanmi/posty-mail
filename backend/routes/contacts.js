import {
  addEmailsToAudience,
  buildContactWhere,
  contactFromDb,
  deleteContacts,
  findOrCreateAudienceByName,
  listContacts,
  prisma,
  queryContacts,
  removeEmailsFromAllAudiences,
  unsubscribedEmailSet,
  upsertContacts,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const contactSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  firstname: z.string().max(120).optional(),
  lastname: z.string().max(120).optional(),
  consent: z.string().max(40).optional(),
  region: z.string().max(40).optional(),
}).passthrough();

const importContactSchema = contactSchema.extend({
  group: z.string().max(120).optional(),
});

const importSchema = z.object({
  contacts: z.array(importContactSchema).min(1, 'At least one contact is required'),
  defaultGroup: z.string().max(120).optional(),
});

const updateSchema = contactSchema.partial().extend({
  email: z.string().email().transform((value) => value.trim().toLowerCase()).optional(),
});

const bulkDeleteSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(10000),
});

// Bulk patch a field across many contacts at once. Currently used by the
// "Set region for N selected" action in the contacts table. `patch` is
// kept narrow on purpose — only fields the UI surfaces today — so a
// poisoned payload can't rewrite arbitrary columns. Add fields here as
// new bulk actions land.
const bulkUpdateSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(10000),
  patch: z.object({
    region: z.string().max(40).optional(),
    consent: z.string().max(40).optional(),
  }).refine((value) => Object.keys(value).length > 0, {
    message: 'patch must contain at least one field',
  }),
});

const filterSchema = z.object({
  search: z.string().optional(),
  region: z.string().optional(),
  consent: z.string().optional(),
  excludeUnsubscribed: z.union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true'),
}).partial();

export function registerContactRoutes(app) {
  app.get('/api/contacts', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const filter = filterSchema.parse(req.query);
    if (filter.excludeUnsubscribed) {
      filter._unsubscribedEmails = Array.from(await unsubscribedEmailSet(accountId));
    }
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 50;

    if (req.query.page || req.query.pageSize || filter.search || filter.region || filter.consent) {
      const result = await queryContacts({
        accountId, filter, page, pageSize,
      });
      res.json(result);
      return;
    }

    res.json(await listContacts(accountId));
  }));

  app.get('/api/contacts/export', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const filter = filterSchema.parse(req.query);
    if (filter.excludeUnsubscribed) {
      filter._unsubscribedEmails = Array.from(await unsubscribedEmailSet(accountId));
    }
    // AND the tenant scope onto whatever where clause the filter built.
    const where = { AND: [{ accountId }, buildContactWhere(filter)] };
    const rows = await prisma.contact.findMany({
      where,
      orderBy: { savedAt: 'desc' },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${Date.now()}.csv"`);
    res.write('email,firstname,lastname,consent,region,savedAt\n');
    rows.forEach((row) => {
      res.write([
        csvEscape(row.email),
        csvEscape(row.firstname || ''),
        csvEscape(row.lastname || ''),
        csvEscape(row.consent || ''),
        csvEscape(row.region || ''),
        csvEscape(row.savedAt?.toISOString() || ''),
      ].join(',') + '\n');
    });
    res.end();
    await recordAudit(req, 'contact.export', 'contact', null, { count: rows.length });
  }));

  app.post(
    '/api/contacts/import',
    validate(importSchema),
    asyncRoute(async (req, res) => {
      const { accountId } = req.user;
      const incoming = req.body.contacts;
      const defaultGroup = (req.body.defaultGroup || '').trim();

      // Strip the group field before storing. It's not a contact column.
      const cleanContacts = incoming.map(({ group: _g, ...rest }) => rest);
      await upsertContacts(accountId, cleanContacts);

      // Bucket by group name (per-contact override > defaultGroup > skip)
      const buckets = new Map();
      incoming.forEach((contact) => {
        const groupName = (contact.group || defaultGroup || '').trim();
        if (!groupName) return;
        if (!buckets.has(groupName)) buckets.set(groupName, []);
        buckets.get(groupName).push(contact.email);
      });

      const groupSummary = {};
      for (const [name, emails] of buckets) {
        const existed = await prisma.audience.findFirst({
          where: { name: { equals: name, mode: 'insensitive' }, accountId },
          select: { id: true },
        });
        const audience = await findOrCreateAudienceByName(accountId, name);
        if (!audience) continue;
        await addEmailsToAudience(accountId, audience.id, emails);
        groupSummary[audience.name] = {
          added: emails.length,
          created: !existed,
        };
      }

      const total = await prisma.contact.count({ where: { accountId } });
      await recordAudit(req, 'contact.import', 'contact', null, {
        count: incoming.length,
        total,
        groups: Object.keys(groupSummary).length,
      });

      res.json({
        saved: incoming.length,
        total,
        storage: 'database',
        groups: groupSummary,
      });
    }),
  );

  app.post(
    '/api/contacts/bulk-delete',
    validate(bulkDeleteSchema),
    asyncRoute(async (req, res) => {
      const { accountId } = req.user;
      const emails = req.body.emails.map((value) => value.trim().toLowerCase());
      const deleted = await deleteContacts(accountId, emails);
      await removeEmailsFromAllAudiences(accountId, emails);
      const total = await prisma.contact.count({ where: { accountId } });
      if (deleted) await recordAudit(req, 'contact.bulk_delete', 'contact', null, { deleted });
      res.json({ deleted, total });
    }),
  );

  // Bulk patch a narrow set of fields on many contacts at once. The
  // `patch` shape is enforced by bulkUpdateSchema above — currently
  // region + consent. We use Prisma updateMany, which is a single SQL
  // statement and so much faster than looping per email even at small
  // sizes.
  app.post(
    '/api/contacts/bulk-update',
    validate(bulkUpdateSchema),
    asyncRoute(async (req, res) => {
      const { accountId } = req.user;
      const emails = req.body.emails.map((value) => value.trim().toLowerCase());
      const patch = {};
      if (typeof req.body.patch.region === 'string') patch.region = req.body.patch.region;
      if (typeof req.body.patch.consent === 'string') patch.consent = req.body.patch.consent;
      const result = await prisma.contact.updateMany({
        where: { email: { in: emails }, accountId },
        data: patch,
      });
      if (result.count) {
        await recordAudit(req, 'contact.bulk_update', 'contact', null, {
          updated: result.count,
          fields: Object.keys(patch),
        });
      }
      res.json({ updated: result.count });
    }),
  );

  app.put(
    '/api/contacts/:email',
    validate(updateSchema),
    asyncRoute(async (req, res) => {
      const { accountId } = req.user;
      const email = decodeURIComponent(req.params.email).toLowerCase();
      const nextEmail = (req.body.email || email).trim().toLowerCase();
      const existing = await prisma.contact.findUnique({ where: { email } });

      // 404 either when the row is missing entirely OR when it belongs to
      // another workspace. We don't want a tenant to be able to confirm
      // the existence of another tenant's contacts.
      if (!existing || existing.accountId !== accountId) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      if (nextEmail !== email) {
        const duplicate = await prisma.contact.findUnique({ where: { email: nextEmail } });
        if (duplicate) {
          // 409 covers both "same workspace dup" and "another workspace
          // already owns this email" — the v1 schema (global email PK)
          // makes both unrecoverable from this route.
          res.status(409).json({ error: 'Another contact already uses that email' });
          return;
        }
      }

      const updated = await prisma.contact.update({
        where: { email },
        data: {
          email: nextEmail,
          firstname: req.body.firstname ?? existing.firstname ?? '',
          lastname: req.body.lastname ?? existing.lastname ?? '',
          consent: req.body.consent ?? existing.consent ?? '',
          region: req.body.region ?? existing.region ?? '',
          data: { ...(existing.data || {}), ...req.body, email: nextEmail },
        },
      });
      res.json(contactFromDb(updated));
    }),
  );

  app.delete('/api/contacts/:email', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const email = decodeURIComponent(req.params.email).toLowerCase();
    // Scope the delete to this account so a tenant can't nuke another
    // tenant's row that happens to share the email.
    const result = await prisma.contact.deleteMany({ where: { email, accountId } });
    // Always prune from groups. Handles both fresh deletes and zombie cleanup.
    await removeEmailsFromAllAudiences(accountId, [email]);
    if (result.count) await recordAudit(req, 'contact.delete', 'contact', email);
    const total = await prisma.contact.count({ where: { accountId } });
    res.json({ deleted: result.count, total });
  }));
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
