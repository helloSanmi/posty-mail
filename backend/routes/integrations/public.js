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
//
// Multi-tenant scope: there's no `req.user` here. Each handler resolves an
// accountId from whatever context is present:
//   - Webhook receiver:    `campaign:<id>` tag in the payload → Campaign.accountId
//   - Unsubscribe page:    `campaign` query param → Campaign.accountId
//   - Preferences form:    same as above (hidden input forwards the email)
//   - Subscribe widget:    `account` field in the POST body (data-account
//                          on the embed) → that workspace; unknown id is
//                          rejected silently, absent id → 'default'
// The campaign/preference paths fall back to 'default' when no scope can
// be derived, preserving pre-multi-tenant behavior for un-migrated installs.

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
  campaign: z.string().max(200).optional(),
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
  // Workspace this widget belongs to. Baked into the embed snippet by the
  // admin (data-account="<id>"). Absent for legacy embeds → defaults to
  // the 'default' workspace for back-compat. Account ids are opaque and
  // already public (they sit in the embed HTML on the host site), the
  // same way Mailchimp exposes its `u=`/`id=` audience params.
  account: z.string().max(80).optional(),
  // IANA timezone string like 'America/New_York'. Auto-filled by the widget
  // from Intl.DateTimeFormat(). Capped at 80 chars to fit any IANA name.
  timezone: z.string().max(80).optional(),
}).passthrough();

const BOUNCE_EVENTS = new Set(['hard_bounce', 'spam', 'invalid_email', 'blocked']);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Resolve the workspace that owns a given campaign id. Used by the
// unauthenticated handlers below to figure out which account's data to
// touch. Returns 'default' when we can't find the campaign (preserves
// legacy single-tenant behavior, e.g. for events that pre-date the
// multi-tenant migration).
async function resolveAccountFromCampaignId(campaignId) {
  if (!campaignId) return 'default';
  try {
    const row = await prisma.campaign.findUnique({
      where: { id: String(campaignId) },
      select: { accountId: true },
    });
    return row?.accountId || 'default';
  } catch {
    return 'default';
  }
}

// Resolve the workspace a public subscribe should land in.
//   - no account hint  → 'default' (legacy embeds, back-compat)
//   - valid account id → that workspace
//   - unknown account  → null (caller soft-succeeds WITHOUT writing, so we
//     neither leak someone into the wrong workspace nor let a probe
//     enumerate which account ids exist)
async function resolveSubscribeAccount(accountId) {
  if (!accountId) return 'default';
  try {
    const row = await prisma.account.findUnique({
      where: { id: String(accountId) },
      select: { id: true },
    });
    return row?.id || null;
  } catch {
    return null;
  }
}

// Brevo webhooks carry `tags: ['campaign:<id>', 'variant:<id>', ...]`.
// Pull the first campaign tag and look up its owner. Falls back to
// 'default' when no tag is present (rare keepalives / generic events).
async function resolveAccountFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'default';
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const campaignTag = tags.find(
    (tag) => typeof tag === 'string' && tag.startsWith('campaign:'),
  );
  if (!campaignTag) return 'default';
  const campaignId = campaignTag.slice('campaign:'.length);
  return resolveAccountFromCampaignId(campaignId);
}

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

    // Resolve tenant from the campaign:<id> tag. Events without a tag get
    // routed to 'default' so they're still queryable; the Event row carries
    // the accountId column we filter against in the Reports endpoints.
    const accountId = await resolveAccountFromPayload(req.body);
    await recordEvent(accountId, { provider: 'brevo', payload: req.body });
    await pruneEventsToLatest(500);

    const eventName = String(req.body?.event || '').toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (email && (eventName === 'unsubscribed' || BOUNCE_EVENTS.has(eventName))) {
      const setting = await prisma.setting.findUnique({
        where: { key: 'integrations.bounceSync' },
      });
      const enabled = eventName === 'unsubscribed' || setting?.value?.enabled === true;
      if (enabled) {
        // Soft-fail on cross-account collision: the v1 Unsubscribe schema
        // (global email PK) can only hold one row per address. If another
        // tenant already owns that suppression row, log + continue rather
        // than 4xx-ing a webhook (Brevo would retry forever).
        try {
          await upsertUnsubscribe(accountId, {
            email,
            reason: `auto: ${eventName}`,
          });
        } catch (error) {
          console.error('[webhook] suppression upsert skipped:', error.message);
        }
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
      // No auth here — the caller is typically a server-side script doing
      // an admin-side suppression add. Resolve the account from a
      // `campaign` hint if one is provided, otherwise 'default'.
      const accountId = await resolveAccountFromCampaignId(req.body.campaign);
      const saved = await upsertUnsubscribe(accountId, {
        email: req.body.email,
        reason: req.body.reason,
      });
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

    // Resolve the tenant from the campaign id in the link. Old links from
    // before multi-tenancy may not carry a campaign param — those route
    // to the default workspace so the original behavior is preserved.
    const accountId = await resolveAccountFromCampaignId(campaign);

    try {
      await upsertUnsubscribe(accountId, {
        email: rawEmail,
        reason: campaign ? `link-click: campaign ${campaign}` : 'link-click',
      });
    } catch (error) {
      // Soft-fail. Show a confirmation anyway. The recipient shouldn't see
      // a 500 page just because we couldn't write to the DB; they can
      // resubmit. (Idempotent — the row may already exist; or a v1 cross-
      // account collision we can't reconcile yet.)
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
      // Forward the resolved workspace into the form so the preferences
      // POST writes to the right account (the email alone is no longer a
      // globally-unique key — it can exist in multiple workspaces).
      account: accountId,
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

      // The form forwards the workspace as a hidden `account` field (the
      // unsubscribe page resolved it from the campaign link). Validate it
      // exists; if it's missing (legacy link) fall back to the first
      // Contact row matching this email across any workspace, then
      // 'default'. With per-account contacts, email alone isn't a unique
      // key, so we use findFirst for the fallback.
      const hintedAccount = await resolveSubscribeAccount(req.body.account);
      let accountId = hintedAccount;
      if (!accountId) {
        const existingContact = await prisma.contact.findFirst({
          where: { email: rawEmail },
          select: { accountId: true },
        });
        accountId = existingContact?.accountId || 'default';
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
        try {
          await upsertUnsubscribe(accountId, {
            email: rawEmail,
            reason: 'preference-center: none selected',
          });
        } catch (error) {
          console.error('[preferences] suppression write failed:', error.message);
        }
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
      await restoreContactSubscription(accountId, rawEmail);
      // Upsert via the composite ([accountId, email]) key so this writes
      // to (or creates in) exactly the resolved workspace. A plain
      // update-by-email would be ambiguous now that the same address can
      // live in several workspaces.
      await prisma.contact.upsert({
        where: { accountId_email: { accountId, email: rawEmail } },
        update: {
          // Set our key explicitly so a future re-submit overwrites cleanly.
          data: { subscribedCategories: chosen },
        },
        create: {
          email: rawEmail,
          consent: 'yes',
          data: { subscribedCategories: chosen },
          accountId,
        },
      }).catch((error) => {
        console.error('[preferences] contact upsert failed:', error.message);
      });

      res.type('html').send(renderUnsubscribePage({
        ok: true,
        title: 'Preferences saved',
        email: rawEmail,
        message: 'Your subscription preferences have been updated.',
        categories,
        account: accountId,
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
      const {
        email, firstname, lastname, groupId, source, timezone,
      } = req.body;

      // Route the subscribe to the workspace baked into the embed. An
      // unknown account id soft-succeeds without writing (see helper) so
      // we never silently dump a subscriber into the default workspace
      // and a probe can't enumerate real account ids.
      const accountId = await resolveSubscribeAccount(req.body.account);
      if (!accountId) {
        res.json({ ok: true });
        return;
      }

      // Guard against re-subscribing a known unsubscriber from a public
      // form. Scoped to THIS workspace via the composite key — a
      // suppression in another workspace doesn't block a fresh subscribe
      // here, which is correct now that suppression is per-account. Admin
      // can still re-add via the authenticated Contacts page.
      const previouslyUnsubscribed = await prisma.unsubscribe.findUnique({
        where: { accountId_email: { accountId, email } },
      });
      if (previouslyUnsubscribed) {
        // Don't 4xx in a way that reveals their suppression status. Treat
        // it as success from the form's perspective so a malicious form
        // probe can't enumerate which addresses are suppressed.
        res.json({ ok: true });
        return;
      }

      try {
        await upsertContacts(accountId, [{
          email,
          firstname: firstname || '',
          lastname: lastname || '',
          consent: 'yes',
          timezone: timezone || '',
          source: source || 'subscribe-widget',
        }]);
      } catch (error) {
        // Cross-account collision (this email belongs to another
        // workspace in the v1 global-PK world) — soft-succeed so a public
        // form probe can't enumerate ownership.
        if (error.status === 409) {
          res.json({ ok: true });
          return;
        }
        throw error;
      }

      // Optional group assignment. Silently ignore a missing/unknown group
      // rather than 4xx-ing — keeping the form failure-tolerant matters
      // more than strict referential integrity for a public endpoint. The
      // contact still lands in the audience without a group.
      if (groupId) {
        try { await addEmailsToAudience(accountId, groupId, [email]); } catch { /* non-fatal */ }
      }

      res.json({ ok: true });
    }),
  );
}
