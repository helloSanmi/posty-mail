// Pre-send lint. One stop for "is this campaign safe to fire?"
//
// Used in two paths:
//   - /api/campaigns/test-email — runs every test send, lets us surface
//     the same warnings the recipient's mail provider will care about
//   - /api/campaigns/preflight — Builder calls this before "Send now" to
//     show a checklist; nothing fires until the admin clears errors.
//
// Returns a structured list of `{ code, severity, message, hint? }` so the UI
// can group by severity and render inline action hints. Severities:
//   - 'error' - we refuse to send
//   - 'warn'  - send is allowed, but flagged
//   - 'info'  - heads-up only, not a problem
//
// New checks live in `lib/preflight/`:
//   - subject-checks.js — anything that reads the subject line
//   - body-checks.js    — html + text + merge tags + images
// Each module exports a default array of pure `(ctx) => result | null` fns.

import { SUBJECT_CHECKS } from './preflight/subject-checks.js';
import { BODY_CHECKS } from './preflight/body-checks.js';

const CHECKS = [...SUBJECT_CHECKS, ...BODY_CHECKS];

/**
 * @param {object} input
 * @param {{ subject?: string, html?: string, text?: string, logoUrl?: string }} input.template
 * @returns {{
 *   checks: Array<{
 *     code: string,
 *     severity: 'error' | 'warn' | 'info',
 *     message: string,
 *     hint?: string,
 *     meta?: object,
 *   }>,
 *   ok: boolean,
 * }}
 */
export function runSendChecks(input) {
  const template = input?.template || {};
  const ctx = {
    subject: String(template.subject || ''),
    html: String(template.html || ''),
    text: String(template.text || ''),
    logoUrl: template.logoUrl || '',
  };
  const checks = [];
  for (const fn of CHECKS) {
    try {
      const result = fn(ctx);
      if (Array.isArray(result)) {
        for (const item of result) if (item) checks.push(item);
      } else if (result) {
        checks.push(result);
      }
    } catch (error) {
      // A misbehaving check shouldn't crash the whole preflight; report it
      // as an info row so a developer can spot it in the UI.
      checks.push({
        code: 'check_error',
        severity: 'info',
        message: `Internal check failed: ${error.message}`,
      });
    }
  }
  const ok = !checks.some((check) => check.severity === 'error');
  return { checks, ok };
}
