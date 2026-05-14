// Test sends + preflight checks. Two separate endpoints, both pre-send:
//   POST /api/campaigns/test-email   actually fires one email to the admin
//                                     so they can see what recipients get
//   POST /api/campaigns/preflight    no side effect; just runs the
//                                     pre-send checklist on the template
//
// Both endpoints get the full preflight (subject / merge tags / unsub /
// size / spam-score / images) so the admin sees the same checks before
// hitting Schedule.
import { sendTestEmail } from '../../lib/brevoClient.js';
import { runSendChecks } from '../../lib/preflight.js';
import { requireSender } from '../../lib/sender.js';
import { findUnreachableImageUrls } from '../../lib/urlReachability.js';
import { validate, z } from '../../lib/validate.js';
import { asyncRoute } from '../../utils/store.js';
import { merge, templateSchema, testEmailSchema } from './schemas.js';

export function registerTestAndPreflightRoutes(app) {
  app.post(
    '/api/campaigns/test-email',
    validate(testEmailSchema),
    asyncRoute(async (req, res) => {
      const { toEmail, template, contact = {} } = req.body;
      const previewContact = {
        firstname: 'Test',
        unsubscribeUrl: 'https://example.com/unsubscribe',
        ...contact,
        email: toEmail,
      };
      const renderedHtml = merge(template.html, previewContact);
      const result = await sendTestEmail({
        toEmail,
        sender: await requireSender(),
        subject: merge(template.subject, previewContact),
        htmlContent: renderedHtml,
        textContent: merge(template.text, previewContact),
      });
      // Full preflight (subject / merge tags / unsub / size / spam-score /
      // images) for the rendered preview. We keep the legacy `warnings`
      // array for backward-compat (older UI builds key off it) and add
      // `preflight` with the structured checklist for newer UI.
      const preflight = runSendChecks({
        template: {
          subject: merge(template.subject, previewContact),
          html: renderedHtml,
          text: merge(template.text, previewContact),
          logoUrl: template.logoUrl,
        },
      });
      const unreachable = findUnreachableImageUrls(renderedHtml, template.logoUrl);
      const warnings = unreachable.length
        ? [{
            kind: 'unreachable_images',
            message: 'Some images point to URLs the recipient\'s mail client cannot fetch '
              + '(localhost or a private network). Set PUBLIC_BASE_URL to a publicly reachable URL '
              + 'and re-upload the assets.',
            urls: unreachable,
          }]
        : [];
      res.json({
        sent: true,
        dryRun: !process.env.BREVO_API_KEY,
        result,
        warnings,
        preflight,
      });
    }),
  );

  // Pre-send lint. Called from the Builder before "Send now" fires so the
  // admin sees a checklist of fail/warn rows and can fix them before the
  // campaign is committed. Returns `{ ok, checks }`. No side effects.
  app.post(
    '/api/campaigns/preflight',
    validate(z.object({ template: templateSchema })),
    asyncRoute(async (req, res) => {
      // Use the as-saved subject/html/text. Merge tags stay literal here
      // so the checklist surfaces unsubscribe-tag warnings even before send.
      const preflight = runSendChecks({ template: req.body.template });
      res.json(preflight);
    }),
  );
}
