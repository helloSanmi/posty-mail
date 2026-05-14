import path from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import express from 'express';
import {
  addEmailsToAudience,
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
  upsertContacts,
  upsertUnsubscribe,
} from '../lib/db.js';
import { recordAudit } from '../lib/audit.js';
import { isPostyEvent } from '../lib/eventScope.js';
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

// Public subscribe widget. Posted by the JS snippet that ships at
// /posty-form.js. We accept a minimal payload so the form embed stays small
// and tolerant of legacy installs that don't yet know about new fields.
const subscribeSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  firstname: z.string().max(80).optional(),
  lastname: z.string().max(80).optional(),
  groupId: z.string().uuid().optional(),
  source: z.string().max(120).optional(),
  // IANA timezone string like 'America/New_York'. The widget auto-fills this
  // from Intl.DateTimeFormat(). Capped at 80 to fit any IANA name comfortably.
  timezone: z.string().max(80).optional(),
}).passthrough();

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
    // Brevo fires webhooks for every transactional email on the account, so
    // emails sent by other systems sharing this API key (or sent manually from
    // Brevo's UI) would otherwise show up in our reports. We tag every Posty
    // send and require that tag here. 202-accept everything so Brevo doesn't
    // retry — we just don't persist foreign events.
    if (!isPostyEvent(req.body)) {
      res.status(202).json({ received: true, scoped: false });
      return;
    }

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
  //
  // When the admin has defined preference categories (Settings > Preference
  // center), the page also offers a "manage what you receive" form so the
  // recipient can re-subscribe to a subset of topics instead of all-or-nothing.
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

    // Read the admin-defined category list (if any) plus the contact's
    // current per-category preferences. Empty list → page renders without
    // the preferences section, behaving exactly as before for installs that
    // haven't set up categories.
    const categories = await readUnsubscribeCategories();
    res.type('html').send(renderUnsubscribePage({
      ok: true,
      title: 'You\'ve been unsubscribed',
      email: rawEmail,
      message: 'You won\'t receive any more emails from us. If this was a mistake, reply to any past email and we\'ll add you back manually.',
      categories,
      // After an unsubscribe click, the user is opted OUT of everything by
      // default. The form lets them re-subscribe to specific topics.
      checked: [],
    }));
  }));

  // Preference-center form submit. Posted from the /unsubscribe page when
  // the recipient picks specific categories to keep receiving. We accept
  // urlencoded form bodies because the page is plain HTML, not a JS app.
  app.post(
    '/unsubscribe/preferences',
    express.urlencoded({ extended: false, limit: '32kb' }),
    asyncRoute(async (req, res) => {
      const rawEmail = String(req.body.email || '').trim().toLowerCase();
      const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
      if (!isValidEmail) {
        res.status(400).type('html').send(renderUnsubscribePage({
          ok: false,
          title: 'Bad request',
          message: 'Could not save your preferences. The form submission was missing an email.',
        }));
        return;
      }

      const categories = await readUnsubscribeCategories();
      const validIds = new Set(categories.map((c) => c.id));
      // checkbox names are `category:<id>`. Anything outside the known list
      // is ignored so a forged form can't write arbitrary keys.
      const chosen = Object.keys(req.body)
        .filter((key) => key.startsWith('category:'))
        .map((key) => key.slice('category:'.length))
        .filter((id) => validIds.has(id));

      if (chosen.length === 0) {
        // User unchecked everything OR there were no boxes. Treat as
        // "unsubscribe from everything" (idempotent against the row we
        // already wrote when they hit the link).
        await upsertUnsubscribe({ email: rawEmail, reason: 'preference-center: none selected' });
        res.type('html').send(renderUnsubscribePage({
          ok: true,
          title: 'Preferences saved',
          email: rawEmail,
          message: 'You won\'t receive any more emails from us. Glad to have had you.',
          categories,
          checked: [],
        }));
        return;
      }

      // The user wants to keep receiving at least one category. Re-enable the
      // contact and store their chosen list. The Unsubscribe row is removed
      // (so they're not in the global suppression list); send-time logic will
      // gate by category.
      await restoreContactSubscription(rawEmail);
      await prisma.contact.update({
        where: { email: rawEmail },
        data: {
          // Preserve any other keys already in Contact.data. Set our key
          // explicitly so a future re-submit overwrites cleanly.
          data: { subscribedCategories: chosen },
        },
      }).catch(() => {
        // Contact row might not exist yet (the user got the email forwarded
        // by a friend, for example). Create it so the preference sticks.
        return prisma.contact.create({
          data: {
            email: rawEmail,
            consent: 'yes',
            data: { subscribedCategories: chosen },
          },
        });
      });

      res.type('html').send(renderUnsubscribePage({
        ok: true,
        title: 'Preferences saved',
        email: rawEmail,
        message: 'Your subscription preferences have been updated.',
        categories,
        checked: chosen,
      }));
    }),
  );

  // Public subscribe widget. The /posty-form.js embed posts here when someone
  // fills in a subscribe form on a host site. Refuses to add anyone who is
  // currently in the Unsubscribe table — once you unsubscribe, only an admin
  // can re-add you (prevents form spam from undoing an opt-out). Rate-limited
  // by IP via the subscribeLimiter wired in server.js.
  app.post(
    '/api/public/subscribe',
    validate(subscribeSchema),
    asyncRoute(async (req, res) => {
      const { email, firstname, lastname, groupId, source, timezone } = req.body;

      // Guard against re-subscribing a known unsubscriber from a public form.
      // The admin can still add them back via the authenticated Contacts page.
      const previouslyUnsubscribed = await prisma.unsubscribe.findUnique({ where: { email } });
      if (previouslyUnsubscribed) {
        // Don't 200 or 4xx in a way that reveals their suppression status.
        // Treat it as success from the form's perspective so a malicious form
        // probe can't enumerate which addresses are on the suppression list.
        res.json({ ok: true });
        return;
      }

      await upsertContacts([{
        email,
        firstname: firstname || '',
        lastname: lastname || '',
        consent: 'yes',
        timezone: timezone || '',
        source: source || 'subscribe-widget',
      }]);

      // Optional group assignment. Silently ignore a missing/unknown group
      // rather than 4xx-ing — keeping the form failure-tolerant matters more
      // than strict referential integrity for a public endpoint. The contact
      // still lands in the audience without a group.
      if (groupId) {
        try { await addEmailsToAudience(groupId, [email]); } catch { /* non-fatal */ }
      }

      res.json({ ok: true });
    }),
  );
}

function renderUnsubscribePage({ ok, title, email, message, categories = [], checked = [] }) {
  const safeEmail = email ? escapeHtml(email) : '';
  const accent = ok ? '#16a34a' : '#dc2626';
  const checkedSet = new Set(checked || []);
  // Only render the preferences form when categories are defined AND the
  // page is in a valid (unsubscribed-confirmed) state. The "bad link" page
  // doesn't show the form because we don't have an email to attach it to.
  const showPrefsForm = ok && safeEmail && Array.isArray(categories) && categories.length > 0;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
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
  .prefs {
    border-top: 1px solid #e6eaef;
    margin-top: 22px;
    padding-top: 18px;
    text-align: left;
  }
  .prefs h2 { font-size: 1rem; margin: 0 0 6px; text-align: center; }
  .prefs > p { margin: 0 0 14px; text-align: center; }
  .prefs-list { display: grid; gap: 8px; list-style: none; margin: 0 0 16px; padding: 0; }
  .prefs-list li {
    background: #fbfcfd;
    border: 1px solid #e6eaef;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .prefs-list label {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 10px;
  }
  .prefs button {
    background: #24599a;
    border: 0;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    font: 600 14px/1 inherit;
    padding: 11px 16px;
    width: 100%;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="badge" aria-hidden="true">
      ${ok
        ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}
    </div>
    <h1>${escapeHtml(title)}</h1>
    ${safeEmail ? `<p class="email">${safeEmail}</p>` : ''}
    <p>${escapeHtml(message)}</p>
    ${showPrefsForm ? renderPreferencesForm(safeEmail, categories, checkedSet) : ''}
  </div>
</body>
</html>`;
}

function renderPreferencesForm(safeEmail, categories, checkedSet) {
  const rows = categories.map((c) => {
    const id = escapeHtml(c.id);
    const label = escapeHtml(c.label || c.id);
    const description = c.description ? `<div style="color:#6b7280;font-size:.85em;margin-top:2px">${escapeHtml(c.description)}</div>` : '';
    const isChecked = checkedSet.has(c.id) ? ' checked' : '';
    return `<li><label>
      <input type="checkbox" name="category:${id}" value="1"${isChecked}>
      <div><strong>${label}</strong>${description}</div>
    </label></li>`;
  }).join('');
  return `<div class="prefs">
    <h2>Manage what you receive</h2>
    <p>Don't want to leave entirely? Pick the topics you'd still like to get.</p>
    <form method="POST" action="/unsubscribe/preferences">
      <input type="hidden" name="email" value="${safeEmail}">
      <ul class="prefs-list">${rows}</ul>
      <button type="submit">Save preferences</button>
    </form>
  </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]));
}

// Centralized read of the admin-defined preference categories. Returns an
// array of `{ id, label, description? }`. Empty array if nothing is set up.
// Used by the public /unsubscribe page and by the authenticated Settings
// route (re-exported below). A safe shape regardless of bad DB content.
export async function readUnsubscribeCategories() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'unsubscribe.categories' } });
    const list = Array.isArray(row?.value?.categories) ? row.value.categories : [];
    return list
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => ({
        id: String(item.id).trim(),
        label: String(item.label || item.id).trim(),
        description: item.description ? String(item.description) : '',
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

export async function writeUnsubscribeCategories(list) {
  const safe = (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      id: String(item.id).trim().slice(0, 60),
      label: String(item.label || item.id).trim().slice(0, 120),
      description: item.description ? String(item.description).slice(0, 280) : '',
    }))
    .filter((item) => item.id);
  await prisma.setting.upsert({
    where: { key: 'unsubscribe.categories' },
    create: { key: 'unsubscribe.categories', value: { categories: safe } },
    update: { value: { categories: safe } },
  });
  return safe;
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

  app.get('/api/events', asyncRoute(async (req, res) => {
    // Optional date-range filtering for the Reports page (Today / Yesterday /
    // 7d / 30d). Both `since` and `until` are ISO datetime strings; bad
    // values silently fall through to "no filter" (same as omitting them).
    const parse = (value) => {
      if (!value) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    const since = parse(req.query.since);
    const until = parse(req.query.until);
    res.json(await listEvents({ since, until }));
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

  // Preference center categories. Admins define a list of topics; the public
  // /unsubscribe page renders them as checkboxes so recipients can selectively
  // re-subscribe. Empty list (the default) preserves the legacy
  // all-or-nothing behavior.
  app.get('/api/settings/unsubscribe-categories', asyncRoute(async (_req, res) => {
    res.json({ categories: await readUnsubscribeCategories() });
  }));

  app.put(
    '/api/settings/unsubscribe-categories',
    validate(z.object({
      categories: z.array(z.object({
        id: z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'id must be alphanumeric/dashes'),
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
