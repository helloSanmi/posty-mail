// Authenticated admin endpoints for integrations + assets:
//   - GET/POST /api/integrations/webhook       (outbound webhook config)
//   - GET/PUT  /api/integrations/bounce-sync   (auto-add bounces to suppression)
//   - GET      /api/events                     (Reports activity feed)
//   - GET/POST /api/assets/logos[/...]         (logo upload + listing)
//   - DELETE   /api/assets/:id
//   - GET      /api/unsubscribes               (suppression list)
//   - DELETE   /api/unsubscribes/:email        (admin re-subscribe)
//   - GET/PUT  /api/settings/unsubscribe-categories  (preference center)
//
// Mounted in server.js AFTER requireAuth, so every endpoint requires a
// logged-in user. Per-area access is enforced centrally by permissionGate
// (lib/permissions.js): the provider webhook needs `connections`; the rest
// (bounce handling, assets, unsubscribes, preference center) fall under
// `settings`. Reads stay open; writes require the area.
//
// Settings-table endpoints (webhook config, bounce-sync toggle, preference
// categories) remain global on purpose — Setting is single-row keyed in
// v1. Per-tenant overrides will move to Account.data in a follow-up.
// Events / assets / unsubscribes ARE scoped by the caller's accountId.
import path from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  listEvents,
  listUnsubscribes,
  prisma,
  restoreContactSubscription,
} from '../../lib/db.js';
import { recordAudit } from '../../lib/audit.js';
import { detectImageType, SAFE_IMAGE_EXTENSIONS } from '../../lib/imageType.js';
import { validate, z } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import {
  readUnsubscribeCategories,
  writeUnsubscribeCategories,
} from './categories-store.js';

const webhookSchema = z.object({
  type: z.string().max(60).optional(),
  url: z.string().url(),
  events: z.array(z.string()).optional(),
});

const dataUrlPattern = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const logoSchema = z.object({
  fileName: z.string().min(1).max(200),
  dataUrl: z.string().regex(dataUrlPattern, 'Must be a base64 PNG/JPEG/GIF/WEBP data URL'),
});

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function registerIntegrationRoutes(app, { logoRoot, publicBaseUrl }) {
  registerWebhookConfig(app);
  registerBounceSync(app);
  registerEventsFeed(app);
  registerLogoAssets(app, { logoRoot, publicBaseUrl });
  registerUnsubscribeAdmin(app);
  registerPreferenceCategories(app);
}

function registerWebhookConfig(app) {
  // The provider webhook is part of the account-level "Connections"
  // surface. Access is gated centrally by permissionGate on the
  // `connections` permission (see lib/permissions.js) — both read and
  // write — so it doesn't need its own guard here.
  app.post(
    '/api/integrations/webhook',
    validate(webhookSchema),
    asyncRoute(async (req, res) => {
      const value = { ...req.body, savedAt: new Date().toISOString() };
      await prisma.setting.upsert({
        where: { key: 'integrations.webhook' },
        create: { key: 'integrations.webhook', value },
        update: { value },
      });
      await recordAudit(req, 'integration.webhook.save', 'integration', 'webhook', {
        url: value.url,
      });
      res.status(201).json({ id: 'integrations.webhook', ...value });
    }),
  );

  app.get('/api/integrations/webhook', asyncRoute(async (_req, res) => {
    const setting = await prisma.setting.findUnique({
      where: { key: 'integrations.webhook' },
    });
    res.json(setting?.value || null);
  }));
}

function registerBounceSync(app) {
  app.get('/api/integrations/bounce-sync', asyncRoute(async (_req, res) => {
    const setting = await prisma.setting.findUnique({
      where: { key: 'integrations.bounceSync' },
    });
    res.json({ enabled: setting?.value?.enabled === true });
  }));

  app.put(
    '/api/integrations/bounce-sync',
    validate(z.object({ enabled: z.boolean() })),
    asyncRoute(async (req, res) => {
      await prisma.setting.upsert({
        where: { key: 'integrations.bounceSync' },
        create: {
          key: 'integrations.bounceSync',
          value: { enabled: req.body.enabled },
        },
        update: { value: { enabled: req.body.enabled } },
      });
      await recordAudit(req, 'integration.bounceSync.update', 'integration', 'bounceSync', {
        enabled: req.body.enabled,
      });
      res.json({ enabled: req.body.enabled });
    }),
  );
}

function registerEventsFeed(app) {
  app.get('/api/events', asyncRoute(async (req, res) => {
    // Optional date-range filtering for the Reports page (Today / Yesterday
    // / 7d / 30d). Both `since` and `until` are ISO datetime strings; bad
    // values silently fall through to "no filter" (same as omitting them).
    const parse = (value) => {
      if (!value) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    const since = parse(req.query.since);
    const until = parse(req.query.until);
    res.json(await listEvents({ accountId: req.user.accountId, since, until }));
  }));
}

function registerLogoAssets(app, { logoRoot, publicBaseUrl }) {
  app.get('/api/assets/logos', asyncRoute(async (req, res) => {
    const rows = await listAssets(req.user.accountId, 'logo');
    res.json(rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      url: row.url,
      contentType: row.contentType,
      bytes: row.bytes,
      createdAt: row.createdAt.toISOString(),
    })));
  }));

  app.post(
    '/api/assets/logo',
    validate(logoSchema),
    asyncRoute(async (req, res) => {
      const match = req.body.dataUrl.match(dataUrlPattern);
      const buffer = Buffer.from(match[1], 'base64');

      if (buffer.length > MAX_LOGO_BYTES) {
        res.status(413).json({ error: 'Logo must be under 2MB' });
        return;
      }

      const detected = detectImageType(buffer);
      if (!detected) {
        res.status(400).json({ error: 'File contents are not a supported image format' });
        return;
      }

      const ext = SAFE_IMAGE_EXTENSIONS[detected];
      const storedName = getStoredName(req.body.fileName, ext);
      const url = `${publicBaseUrl}/uploads/logos/${storedName}`;
      await mkdir(logoRoot, { recursive: true });
      await writeFile(path.join(logoRoot, storedName), buffer);

      const asset = await createAsset(req.user.accountId, {
        fileName: storedName,
        url,
        contentType: detected,
        bytes: buffer.length,
        kind: 'logo',
        createdById: req.user?.id || null,
      });

      await recordAudit(req, 'asset.logo.upload', 'asset', asset.id, {
        bytes: buffer.length,
        type: detected,
      });
      res.status(201).json({
        id: asset.id,
        fileName: storedName,
        url,
        contentType: detected,
        bytes: buffer.length,
        createdAt: asset.createdAt.toISOString(),
      });
    }),
  );

  app.delete('/api/assets/:id', asyncRoute(async (req, res) => {
    const { accountId } = req.user;
    const asset = await getAsset(accountId, req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    try {
      await unlink(path.join(logoRoot, asset.fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await deleteAsset(accountId, req.params.id);
    await recordAudit(req, 'asset.delete', 'asset', asset.id, {
      fileName: asset.fileName,
    });
    res.json({ ok: true, id: asset.id });
  }));
}

function registerUnsubscribeAdmin(app) {
  app.get('/api/unsubscribes', asyncRoute(async (req, res) => {
    res.json(await listUnsubscribes(req.user.accountId));
  }));

  // Admin re-subscribe: removes the address from the Unsubscribe table AND
  // flips Contact.consent back to 'yes' (if a Contact row exists). For when
  // someone reaches out and asks to be re-included.
  app.delete('/api/unsubscribes/:email', asyncRoute(async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const result = await restoreContactSubscription(req.user.accountId, email);
    if (result.removedFromUnsubscribeList) {
      await recordAudit(req, 'unsubscribe.restore', 'unsubscribe', email, result);
    }
    res.json({ ok: true, ...result });
  }));
}

function registerPreferenceCategories(app) {
  // Admins define a list of topics; the public /unsubscribe page renders
  // them as checkboxes so recipients can selectively re-subscribe. Empty
  // list (the default) preserves the legacy all-or-nothing behavior.
  app.get('/api/settings/unsubscribe-categories', asyncRoute(async (_req, res) => {
    res.json({ categories: await readUnsubscribeCategories() });
  }));

  app.put(
    '/api/settings/unsubscribe-categories',
    validate(z.object({
      categories: z.array(z.object({
        id: z.string().min(1).max(60)
          .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'id must be alphanumeric/dashes'),
        label: z.string().min(1).max(120),
        description: z.string().max(280).optional(),
      })).max(20),
    })),
    asyncRoute(async (req, res) => {
      const saved = await writeUnsubscribeCategories(req.body.categories);
      await recordAudit(req, 'setting.preference_center.update', 'setting', 'unsubscribe.categories', {
        count: saved.length,
      });
      res.json({ categories: saved });
    }),
  );
}

function getStoredName(fileName, ext) {
  const safeBaseName = path.basename(fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase();
  return `${Date.now()}-${safeBaseName || 'logo'}.${ext}`;
}
