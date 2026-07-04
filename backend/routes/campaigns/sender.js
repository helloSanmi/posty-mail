// Sender identity + deliverability self-check. Stored in the Setting
// table so admins can edit via UI instead of touching env vars.
//   GET  /api/settings/sender               read effective + stored + source
//   POST /api/settings/sender               save (DB override)
//   GET  /api/settings/sender/verified      Brevo's verified-senders list
//   GET  /api/settings/sender/deliverability  SPF / DKIM / DMARC self-check
//
// These are the account-level "Connections" surface. Access is gated by
// the `connections` permission (see lib/permissions.js) via the central
// permissionGate in server.js — reads and writes both. Editors don't get
// that permission by default, so they can neither see nor break the
// sender/provider config; an admin can grant `connections` to a custom
// role without making them a full admin.
import { fetchVerifiedSenders } from '../../lib/brevoClient.js';
import { recordAudit } from '../../lib/audit.js';
import { checkDeliverability } from '../../lib/deliverability.js';
import {
  readSenderSetting,
  resolveSender,
  writeSenderSetting,
} from '../../lib/sender.js';
import { validate, z } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';

export function registerSenderRoutes(app) {
  app.get('/api/settings/sender', asyncRoute(async (_req, res) => {
    // resolved is null when nothing real is configured. The UI uses that
    // to show "Not configured" instead of a placeholder address.
    const resolved = await resolveSender();
    const stored = await readSenderSetting();
    const source = stored?.email
      ? 'database'
      : (process.env.BREVO_SENDER_EMAIL ? 'env' : 'unset');
    res.json({
      // What sends actually use right now. null = nothing configured yet.
      effective: resolved,
      // 'database' | 'env' | 'unset'. Helps the UI show an accurate status
      // pill and an env-override note when the DB row is empty but env is set.
      source,
      // The raw stored override, so the UI can pre-fill the form with
      // what's actually editable (not the env fallback).
      stored: stored || null,
    });
  }));

  app.post(
    '/api/settings/sender',
    validate(z.object({
      email: z.string().email().max(200),
      name: z.string().min(1).max(120),
    })),
    asyncRoute(async (req, res) => {
      const previous = await readSenderSetting();
      const saved = await writeSenderSetting(req.body);
      await recordAudit(req, 'setting.sender.update', 'setting', 'campaign.sender', {
        previous: previous ? { email: previous.email, name: previous.name } : null,
        next: { email: saved.email, name: saved.name },
      });
      res.json({ ok: true, ...saved });
    }),
  );

  // Verified senders pulled live from Brevo. Drives the UI dropdown so
  // admins pick from addresses that will actually deliver. Returns `[]` in
  // dry-run mode (no API key); UI falls back to free text.
  app.get('/api/settings/sender/verified', asyncRoute(async (_req, res) => {
    try {
      const senders = await fetchVerifiedSenders();
      res.json({ senders, dryRun: !process.env.BREVO_API_KEY });
    } catch (error) {
      // Surface the Brevo error but don't 500. UI degrades to free-text.
      res.json({
        senders: [],
        dryRun: !process.env.BREVO_API_KEY,
        error: error.message,
      });
    }
  }));

  // Deliverability self-check. Resolves SPF / DKIM / DMARC for the sender
  // domain and classifies each. 400s if the sender isn't configured yet,
  // so the UI can prompt for setup first.
  app.get('/api/settings/sender/deliverability', asyncRoute(async (_req, res) => {
    const sender = await resolveSender();
    if (!sender?.email) {
      res.status(400).json({
        error: 'Configure your sender email first, then re-run the deliverability check.',
        code: 'SENDER_NOT_CONFIGURED',
      });
      return;
    }
    const result = await checkDeliverability(sender.email);
    res.json(result);
  }));
}
