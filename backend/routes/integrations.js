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
  pruneEventsToLatest,
  recordEvent,
  restoreContactSubscription,
  unsubscribeFromDb,
  upsertUnsubscribe,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { detectImageType, SAFE_IMAGE_EXTENSIONS } from '../lib/imageType.js';
import { verifyBrevoWebhook } from '../lib/webhookVerify.js';
import { validate, z } from '../lib/validate.js';
import { asyncRoute } from '../utils/store.js';

const webhookSchema = z.object({
  type: z.string().max(60).optional(),
  url: z.string().url(),
  events: z.array(z.string()).optional(),
});

const unsubscribeSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  reason: z.string().max(500).optional(),
});

const dataUrlPattern = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const logoSchema = z.object({
  fileName: z.string().min(1).max(200),
  dataUrl: z.string().regex(dataUrlPattern, 'Must be a base64 PNG/JPEG/GIF/WEBP data URL'),
});

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const BOUNCE_EVENTS = new Set(['hard_bounce', 'spam', 'invalid_email', 'blocked']);

// Public. Called by Brevo and by email recipients clicking unsubscribe
export function registerPublicIntegrationRoutes(app) {
  app.post('/api/webhooks/brevo', verifyBrevoWebhook, asyncRoute(async (req, res) => {
    await recordEvent({ provider: 'brevo', payload: req.body });
    await pruneEventsToLatest(500);

    const eventName = String(req.body?.event || '').toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (email && (eventName === 'unsubscribed' || BOUNCE_EVENTS.has(eventName))) {
      const setting = await prisma.setting.findUnique({ where: { key: 'integrations.bounceSync' } });
      const enabled = eventName === 'unsubscribed' || setting?.value?.enabled === true;
      if (enabled) {
        await upsertUnsubscribe({
          email,
          reason: `auto: ${eventName}`,
        });
      }
    }

    res.status(202).json({ received: true });
  }));

  app.post(
    '/api/unsubscribe',
    validate(unsubscribeSchema),
    asyncRoute(async (req, res) => {
      const saved = await upsertUnsubscribe(req.body);
      res.json({ ok: true, ...unsubscribeFromDb(saved) });
    }),
  );

  // Defensive redirects for legacy / mistyped unsubscribe URLs. Any campaign
  // sent while PUBLIC_BASE_URL had an accidental prefix (e.g. `/api/health`)
  // baked that prefix into the link before the email was delivered. Now those
  // links sit in recipients' inboxes forever, hitting `/api/*` and 401-ing
  // through the auth middleware. We catch the common bad shapes here and
  // 302 to the real handler with the query string preserved.
  const unsubscribeRedirect = (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `/unsubscribe${qs}`);
  };
  app.get('/api/health/unsubscribe', unsubscribeRedirect);
  app.get('/api/unsubscribe', unsubscribeRedirect);

  // Public, browser-facing unsubscribe page. The {{unsubscribeUrl}} merge tag
  // in templates renders to https://<PUBLIC_BASE_URL>/unsubscribe?email=...&campaign=...
  // Hitting it records the unsubscribe (idempotent) and returns a small
  // confirmation HTML page. No auth: the link is the proof of consent.
  app.get('/unsubscribe', asyncRoute(async (req, res) => {
    const rawEmail = String(req.query.email || '').trim().toLowerCase();
    const campaign = String(req.query.campaign || '').slice(0, 200);
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);

    if (!isValidEmail) {
      res.status(400)
        .type('html')
        .send(renderUnsubscribePage({
          ok: false,
          title: 'Bad unsubscribe link',
          message: 'This unsubscribe link looks malformed or is missing the email address. If you copied it from an email, try clicking it again.',
        }));
      return;
    }

    try {
      await upsertUnsubscribe({
        email: rawEmail,
        reason: campaign ? `link-click: campaign ${campaign}` : 'link-click',
      });
    } catch (error) {
      // Soft-fail. Show a confirmation anyway. The recipient shouldn't see a
      // 500 page just because we couldn't write to the DB; they can resubmit.
      console.error('[unsubscribe] write failed:', error.message);
    }

    res.type('html').send(renderUnsubscribePage({
      ok: true,
      title: 'You\'ve been unsubscribed',
      email: rawEmail,
      message: 'You won\'t receive any more emails from us. If this was a mistake, reply to any past email and we\'ll add you back manually.',
    }));
  }));
}

function renderUnsubscribePage({ ok, title, email, message }) {
  const safeEmail = email ? String(email).replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c])) : '';
  const accent = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    align-items: center;
    background: #f5f7f9;
    color: #1f2937;
    display: flex;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    justify-content: center;
    margin: 0;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #e6eaef;
    border-radius: 14px;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
    max-width: 440px;
    padding: 32px;
    text-align: center;
    width: 100%;
  }
  .badge {
    align-items: center;
    background: ${accent}15;
    border-radius: 999px;
    color: ${accent};
    display: inline-flex;
    height: 48px;
    justify-content: center;
    margin-bottom: 16px;
    width: 48px;
  }
  h1 { font-size: 1.4rem; margin: 0 0 12px; }
  p { color: #4b5563; line-height: 1.5; margin: 0 0 12px; }
  .email { color: #1f2937; font-weight: 500; word-break: break-all; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge" aria-hidden="true">
      ${ok
        ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}
    </div>
    <h1>${title}</h1>
    ${safeEmail ? `<p class="email">${safeEmail}</p>` : ''}
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// Protected. Admin/editor management endpoints
export function registerIntegrationRoutes(app, { logoRoot, publicBaseUrl }) {
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
      await recordAudit(req, 'integration.webhook.save', 'integration', 'webhook', { url: value.url });
      res.status(201).json({ id: 'integrations.webhook', ...value });
    }),
  );

  app.get('/api/integrations/webhook', asyncRoute(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'integrations.webhook' } });
    res.json(setting?.value || null);
  }));

  app.get('/api/integrations/bounce-sync', asyncRoute(async (_req, res) => {
    const setting = await prisma.setting.findUnique({ where: { key: 'integrations.bounceSync' } });
    res.json({ enabled: setting?.value?.enabled === true });
  }));

  app.put(
    '/api/integrations/bounce-sync',
    validate(z.object({ enabled: z.boolean() })),
    asyncRoute(async (req, res) => {
      await prisma.setting.upsert({
        where: { key: 'integrations.bounceSync' },
        create: { key: 'integrations.bounceSync', value: { enabled: req.body.enabled } },
        update: { value: { enabled: req.body.enabled } },
      });
      await recordAudit(req, 'integration.bounceSync.update', 'integration', 'bounceSync', {
        enabled: req.body.enabled,
      });
      res.json({ enabled: req.body.enabled });
    }),
  );

  app.get('/api/events', asyncRoute(async (_req, res) => {
    res.json(await listEvents());
  }));

  app.get('/api/assets/logos', asyncRoute(async (_req, res) => {
    const rows = await listAssets('logo');
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

      const asset = await createAsset({
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
    const asset = await getAsset(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    try {
      await unlink(path.join(logoRoot, asset.fileName));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await deleteAsset(req.params.id);
    await recordAudit(req, 'asset.delete', 'asset', asset.id, { fileName: asset.fileName });
    res.json({ ok: true, id: asset.id });
  }));

  app.get('/api/unsubscribes', asyncRoute(async (_req, res) => {
    res.json(await listUnsubscribes());
  }));

  // Admin re-subscribe: removes the address from the Unsubscribe table AND
  // flips Contact.consent back to 'yes' (if a Contact row exists). For when
  // someone reaches out and asks to be re-included.
  app.delete('/api/unsubscribes/:email', asyncRoute(async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const result = await restoreContactSubscription(email);
    if (result.removedFromUnsubscribeList) {
      await recordAudit(req, 'unsubscribe.restore', 'unsubscribe', email, result);
    }
    res.json({ ok: true, ...result });
  }));
}

function getStoredName(fileName, ext) {
  const safeBaseName = path.basename(fileName)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase();
  return `${Date.now()}-${safeBaseName || 'logo'}.${ext}`;
}
