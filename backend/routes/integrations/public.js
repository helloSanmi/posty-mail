// Public (unauthenticated) integration routes:
//   - POST /api/webhooks/brevo                (provider webhook receiver)
//   - POST /api/unsubscribe                   (admin-callable suppression add)
//   - GET  /unsubscribe                       (recipient-facing HTML page)
//   - POST /unsubscribe/preferences           (preference-center form submit)
//   - GET  /api/(health/)?unsubscribe         (defensive redirects)
//   - POST /api/public/subscribe              (subscribe-widget form post)
//
// Mounted in server.js BEFORE the requireAuth middleware so recipients
// without a session can hit the unsubscribe / subscribe surfaces.

import express from 'express';
import {
  addEmailsToAudience,
  prisma,
  pruneEventsToLatest,
  recordEvent,
  restoreContactSubscription,
  unsubscribeFromDb,
  upsertContacts,
  upsertUnsubscribe,
} from '../../lib/db.js';
import { isPostyEvent } from '../../lib/eventScope.js';
import { verifyBrevoWebhook } from '../../lib/webhookVerify.js';
import { validate, z } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import { readUnsubscribeCategories } from './categories-store.js';
import { renderUnsubscribePage } from './unsubscribe-page.js';

const unsubscribeSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  reason: z.string().max(500).optional(),
});

// Public subscribe widget. Posted by the JS snippet that ships at
// /posty-form.js. Minimal payload so the form embed stays small and
// tolerant of legacy installs that don't yet know about new fields.
const subscribeSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  firstname: z.string().max(80).optional(),
  lastname: z.string().max(80).optional(),
  groupId: z.string().uuid().optional(),
  source: z.string().max(120).optional(),
  // IANA timezone string like 'America/New_York'. Auto-filled by the widget
  // from Intl.DateTimeFormat(). Capped at 80 chars to fit any IANA name.
  timezone: z.string().max(80).optional(),
}).passthrough();

const BOUNCE_EVENTS = new Set(['hard_bounce', 'spam', 'invalid_email', 'blocked']);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerPublicIntegrationRoutes(app) {
  registerWebhook(app);
  registerUnsubscribeApi(app);
  registerUnsubscribePage(app);
  registerPreferencesForm(app);
  registerSubscribeWidget(app);
}

function registerWebhook(app) {
  app.post('/api/webhooks/brevo', verifyBrevoWebhook, asyncRoute(async (req, res) => {
    // Brevo fires webhooks for every transactional email on the account, so
    // emails sent by other systems sharing this API key would otherwise show
    // up in our reports. We tag every Posty send and require that tag here.
    // 202-accept everything so Brevo doesn't retry — we just don't persist
    // foreign events.
    if (!isPostyEvent(req.body)) {
      res.status(202).json({ received: true, scoped: false });
      return;
    }

    await recordEvent({ provider: 'brevo', payload: req.body });
    await pruneEventsToLatest(500);

    const eventName = String(req.body?.event || '').toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (email && (eventName === 'unsubscribed' || BOUNCE_EVENTS.has(eventName))) {
      const setting = await prisma.setting.findUnique({
        where: { key: 'integrations.bounceSync' },
      });
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
}

function registerUnsubscribeApi(app) {
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
  // baked that prefix into the link before delivery. Those links sit in
  // recipients' inboxes forever, hitting `/api/*` and 401-ing through the
  // auth middleware. Catch the common bad shapes and 302 to the real handler
  // with the query string preserved.
  const unsubscribeRedirect = (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `/unsubscribe${qs}`);
  };
  app.get('/api/health/unsubscribe', unsubscribeRedirect);
  app.get('/api/unsubscribe', unsubscribeRedirect);
}

function registerUnsubscribePage(app) {
  // Public, browser-facing unsubscribe page. The {{unsubscribeUrl}} merge
  // tag in templates renders to https://<host>/unsubscribe?email=...&campaign=...
  // Hitting it records the unsubscribe (idempotent) and returns a small
  // confirmation HTML page. No auth: the link is the proof of consent.
  //
  // When the admin has defined preference categories, the page also offers
  // a "manage what you receive" form so the recipient can re-subscribe to
  // a subset of topics instead of all-or-nothing.
  app.get('/unsubscribe', asyncRoute(async (req, res) => {
    const rawEmail = String(req.query.email || '').trim().toLowerCase();
    const campaign = String(req.query.campaign || '').slice(0, 200);

    if (!EMAIL_REGEX.test(rawEmail)) {
      res.status(400).type('html').send(renderUnsubscribePage({
        ok: false,
        title: 'Bad unsubscribe link',
        message: 'This unsubscribe link looks malformed or is missing the email address. '
          + 'If you copied it from an email, try clicking it again.',
      }));
      return;
    }

    try {
      await upsertUnsubscribe({
        email: rawEmail,
        reason: campaign ? `link-click: campaign ${campaign}` : 'link-click',
      });
    } catch (error) {
      // Soft-fail. Show a confirmation anyway. The recipient shouldn't see
      // a 500 page just because we couldn't write to the DB; they can
      // resubmit. (Idempotent — the row may already exist.)
      console.error('[unsubscribe] write failed:', error.message);
    }

    // Read the admin-defined category list (if any). Empty list → page
    // renders without the preferences section, behaving exactly as before
    // for installs that haven't set up categories.
    const categories = await readUnsubscribeCategories();
    res.type('html').send(renderUnsubscribePage({
      ok: true,
      title: 'You\'ve been unsubscribed',
      email: rawEmail,
      message: 'You won\'t receive any more emails from us. If this was a mistake, '
        + 'reply to any past email and we\'ll add you back manually.',
      categories,
      // After an unsubscribe click the user is opted OUT of everything by
      // default. The form lets them re-subscribe to specific topics.
      checked: [],
    }));
  }));
}

function registerPreferencesForm(app) {
  // Posted from the /unsubscribe page when the recipient picks specific
  // categories to keep receiving. We accept urlencoded form bodies because
  // the page is plain HTML, not a JS app.
  app.post(
    '/unsubscribe/preferences',
    express.urlencoded({ extended: false, limit: '32kb' }),
    asyncRoute(async (req, res) => {
      const rawEmail = String(req.body.email || '').trim().toLowerCase();
      if (!EMAIL_REGEX.test(rawEmail)) {
        res.status(400).type('html').send(renderUnsubscribePage({
          ok: false,
          title: 'Bad request',
          message: 'Could not save your preferences. The form submission was missing an email.',
        }));
        return;
      }

      const categories = await readUnsubscribeCategories();
      const validIds = new Set(categories.map((c) => c.id));
      // Checkbox names are `category:<id>`. Anything outside the known
      // list is ignored so a forged form can't write arbitrary keys.
      const chosen = Object.keys(req.body)
        .filter((key) => key.startsWith('category:'))
        .map((key) => key.slice('category:'.length))
        .filter((id) => validIds.has(id));

      if (chosen.length === 0) {
        // User unchecked everything OR there were no boxes. Treat as
        // "unsubscribe from everything" (idempotent against the row we
        // already wrote when they hit the link).
        await upsertUnsubscribe({
          email: rawEmail,
          reason: 'preference-center: none selected',
        });
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

      // The user wants to keep receiving at least one category. Re-enable
      // the contact and store their chosen list. The Unsubscribe row is
      // removed (so they're not in the global suppression list); send-time
      // logic gates by category.
      await restoreContactSubscription(rawEmail);
      await prisma.contact.update({
        where: { email: rawEmail },
        data: {
          // Set our key explicitly so a future re-submit overwrites cleanly.
          data: { subscribedCategories: chosen },
        },
      }).catch(() => {
        // Contact row might not exist yet (someone got the email forwarded
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
}

function registerSubscribeWidget(app) {
  // The /posty-form.js embed posts here when someone fills in a subscribe
  // form on a host site. Refuses to add anyone currently in the
  // Unsubscribe table — once you unsubscribe, only an admin can re-add
  // you (prevents form spam from undoing an opt-out). Rate-limited by IP
  // via the subscribeLimiter wired in server.js.
  app.post(
    '/api/public/subscribe',
    validate(subscribeSchema),
    asyncRoute(async (req, res) => {
      const { email, firstname, lastname, groupId, source, timezone } = req.body;

      // Guard against re-subscribing a known unsubscriber from a public
      // form. Admin can still add them back via the authenticated Contacts
      // page.
      const previouslyUnsubscribed = await prisma.unsubscribe.findUnique({
        where: { email },
      });
      if (previouslyUnsubscribed) {
        // Don't 4xx in a way that reveals their suppression status. Treat
        // it as success from the form's perspective so a malicious form
        // probe can't enumerate which addresses are suppressed.
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
      // rather than 4xx-ing — keeping the form failure-tolerant matters
      // more than strict referential integrity for a public endpoint. The
      // contact still lands in the audience without a group.
      if (groupId) {
        try { await addEmailsToAudience(groupId, [email]); } catch { /* non-fatal */ }
      }

      res.json({ ok: true });
    }),
  );
}
