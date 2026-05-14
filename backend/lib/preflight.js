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
// New checks should be small pure functions added to the CHECKS array.
// Each gets (input) and returns `null` (pass) or a `{ code, severity, message, hint? }`.

import { findUnreachableImageUrls } from './urlReachability.js';

// Spammy phrases that hit common Gmail / Outlook content filters. List is
// intentionally short. There are 500-item lists online but most of those
// produce noise. Stick to the ones with documented filter impact.
const SPAM_PHRASES = [
  'act now',
  'click here',
  'free money',
  'guaranteed',
  'limited time',
  'no obligation',
  'order now',
  'risk free',
  'urgent',
  'winner',
  'wire transfer',
  '$$$',
  '!!!',
];

// Gmail clips messages after ~102KB of HTML and shows a "[Message clipped]"
// banner. Real users see this happen at slightly different thresholds; 100KB
// is a conservative warning point.
const GMAIL_CLIP_BYTES = 102 * 1024;
const GMAIL_CLIP_WARN_BYTES = 100 * 1024;

// Subject line guidance from the major providers. > 78 chars typically gets
// truncated in narrow mobile clients; > 998 is a hard SMTP limit (we already
// enforce this in sanitizeSubject, this check makes the cap visible).
const SUBJECT_TRUNCATE_AT = 78;
const SUBJECT_HARD_CAP = 998;

const CHECKS = [
  checkSubjectPresent,
  checkSubjectLength,
  checkSubjectCaps,
  checkSubjectSpamPhrases,
  checkSubjectPunctuation,
  checkHtmlPresent,
  checkHtmlSize,
  checkUnsubscribeMergeTag,
  checkBrokenMergeTags,
  checkPlainTextFallback,
  checkLinkCount,
  checkImageOnlyContent,
  checkUnreachableImages,
];

/**
 * @param {object} input
 * @param {{ subject?: string, html?: string, text?: string, logoUrl?: string }} input.template
 * @returns {{ checks: Array<{code:string, severity:'error'|'warn'|'info', message:string, hint?:string, meta?:object}>, ok: boolean }}
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

// ---- individual checks --------------------------------------------------

function checkSubjectPresent({ subject }) {
  if (subject.trim()) return null;
  return {
    code: 'subject_missing',
    severity: 'error',
    message: 'Add a subject line.',
    hint: 'An empty subject lands in spam in Gmail and looks broken in Outlook.',
  };
}

function checkSubjectLength({ subject }) {
  const len = subject.length;
  if (len > SUBJECT_HARD_CAP) {
    return {
      code: 'subject_too_long',
      severity: 'error',
      message: `Subject is ${len} chars. Hard cap is ${SUBJECT_HARD_CAP}.`,
      hint: 'SMTP rejects headers longer than 998 chars.',
    };
  }
  if (len > SUBJECT_TRUNCATE_AT) {
    return {
      code: 'subject_truncated',
      severity: 'warn',
      message: `Subject is ${len} chars. Most mobile inboxes truncate around ${SUBJECT_TRUNCATE_AT}.`,
      hint: 'Frontload the key idea so it survives the truncation.',
    };
  }
  return null;
}

function checkSubjectCaps({ subject }) {
  const letters = subject.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return null;
  const uppers = letters.replace(/[^A-Z]/g, '').length;
  const ratio = uppers / letters.length;
  if (ratio > 0.6) {
    return {
      code: 'subject_caps',
      severity: 'warn',
      message: 'Subject is mostly UPPERCASE.',
      hint: 'All-caps subjects raise spam scores in Gmail and Outlook. Mix case.',
    };
  }
  return null;
}

function checkSubjectSpamPhrases({ subject }) {
  const lower = subject.toLowerCase();
  const hits = SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
  if (!hits.length) return null;
  return {
    code: 'subject_spam_phrases',
    severity: 'warn',
    message: `Subject contains commonly flagged phrases: ${hits.join(', ')}.`,
    hint: 'Rephrase to avoid generic urgency triggers.',
    meta: { phrases: hits },
  };
}

function checkSubjectPunctuation({ subject }) {
  if (/!{3,}/.test(subject) || /\?{3,}/.test(subject)) {
    return {
      code: 'subject_punctuation',
      severity: 'warn',
      message: 'Subject uses repeated !!! or ???.',
      hint: 'Repeated punctuation is a strong spam signal.',
    };
  }
  return null;
}

function checkHtmlPresent({ html }) {
  if (html.trim()) return null;
  return {
    code: 'html_missing',
    severity: 'error',
    message: 'Template has no HTML body.',
    hint: 'Add content in the editor before sending.',
  };
}

function checkHtmlSize({ html }) {
  if (!html) return null;
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > GMAIL_CLIP_BYTES) {
    return {
      code: 'html_too_large',
      severity: 'warn',
      message: `HTML is ${Math.round(bytes / 1024)}KB. Gmail clips messages over ~102KB.`,
      hint: 'Recipients will see "[Message clipped]" with a "View entire message" link. Inline less CSS, move heavy content to an image.',
      meta: { bytes },
    };
  }
  if (bytes > GMAIL_CLIP_WARN_BYTES) {
    return {
      code: 'html_size_warn',
      severity: 'info',
      message: `HTML is ${Math.round(bytes / 1024)}KB. Close to Gmail's 102KB clipping threshold.`,
      meta: { bytes },
    };
  }
  return null;
}

function checkUnsubscribeMergeTag({ html, text }) {
  const combined = `${html}\n${text}`;
  // Accept any merge tag whose content mentions 'unsubscribe' (case
  // insensitive). Covers:
  //   {{unsubscribeUrl}}             Posty's own merge tag
  //   {{ unsubscribe }}              Brevo built-in
  //   {{ params.unsubscribe_url }}   Brevo params syntax
  //   {{ contact.UNSUBSCRIBE_URL }}  Brevo contact-attribute syntax
  //   [UNSUBSCRIBE]                  Legacy Brevo / Mailchimp placeholder
  if (/\{\{[^}]*unsubscribe[^}]*\}\}/i.test(combined)) return null;
  if (/\[UNSUBSCRIBE\]/i.test(combined)) return null;
  // Also accept literal /unsubscribe URLs (some templates hardcode them).
  if (/href=["'][^"']*\/unsubscribe/i.test(html)) return null;
  return {
    code: 'unsubscribe_missing',
    severity: 'error',
    message: 'No unsubscribe link found.',
    hint: 'Add a merge tag like {{unsubscribeUrl}} (Posty) or {{ unsubscribe }} (Brevo) somewhere in the email. CAN-SPAM, GDPR, and Gmail require a working unsubscribe.',
  };
}

// A valid merge tag's inner content (between the {{ }}) looks like one of:
//   firstname                                    simple identifier
//   contact.FIRSTNAME                            dot-namespaced (Brevo)
//   contact.FIRSTNAME|default:'there'            with one filter
//   foo|filter1|filter2:'arg'                    chained filters
//   params.unsubscribe_url                       params syntax
// Surrounding whitespace is fine, as are spaces around `|` and `:`.
const VALID_MERGE_INNER = /^\s*[a-zA-Z_][a-zA-Z0-9_.]*(?:\s*\|\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*:\s*(?:'[^']*'|"[^"]*"|[^|}]+))?)*\s*$/;

function checkBrokenMergeTags({ html, text, subject }) {
  // Catch typos like {{ first name }} (space inside identifier), {firstname}
  // (missing second brace), or {{firstname]] (mismatched closers). Permissive
  // about Brevo-style filters (`{{ contact.X|default:'y' }}`), which are
  // legitimate even though they don't match Posty's simple renderer; Brevo
  // itself processes those server-side.
  const combined = `${subject}\n${html}\n${text}`;
  const issues = [];

  // 1. Mismatched braces: single { ... } that isn't part of a double-brace pair.
  const single = combined.match(/(?<!\{)\{[a-zA-Z_][^{}\n]{0,40}\}(?!\})/g);
  if (single) issues.push(...single);

  // 2. Each {{ ... }} occurrence must match the broad valid-inner shape.
  //    Empty `{{ }}` and obvious malformations get flagged; legitimate
  //    Brevo filter syntax passes.
  const candidates = combined.match(/\{\{[\s\S]{0,200}?\}\}/g) || [];
  for (const tag of candidates) {
    const inner = tag.slice(2, -2);
    if (!VALID_MERGE_INNER.test(inner)) issues.push(tag);
  }

  if (!issues.length) return null;
  return {
    code: 'merge_tag_suspicious',
    severity: 'warn',
    message: `Possibly broken merge tag: ${issues.slice(0, 3).join(', ')}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ''}.`,
    hint: 'Merge tags look like {{firstname}} or {{ contact.FIRSTNAME|default:"there" }}. Two braces on each side, no space inside an identifier.',
    meta: { samples: issues.slice(0, 10) },
  };
}

function checkPlainTextFallback({ text, html }) {
  if (text.trim()) return null;
  if (!html.trim()) return null; // html_missing already errored
  return {
    code: 'plain_text_missing',
    severity: 'info',
    message: 'No plain-text alternative.',
    hint: 'Mail clients that disable HTML (and some spam filters) fall back to plain text. Auto-generating one improves deliverability.',
  };
}

function checkLinkCount({ html }) {
  const hrefs = html.match(/href\s*=\s*["'][^"']+["']/gi) || [];
  if (hrefs.length === 0) {
    return {
      code: 'no_links',
      severity: 'info',
      message: 'Email has no links.',
      hint: 'No click-tracking will land. Fine for plain notifications.',
    };
  }
  if (hrefs.length > 25) {
    return {
      code: 'too_many_links',
      severity: 'warn',
      message: `Email has ${hrefs.length} links.`,
      hint: 'High link counts trigger spam filters. Aim for under 20.',
      meta: { count: hrefs.length },
    };
  }
  return null;
}

function checkImageOnlyContent({ html }) {
  if (!html) return null;
  // Strip tags, then check whether there's any visible text.
  const stripped = html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&[a-z]+;/gi, ' ').trim();
  const hasImages = /<img\b/i.test(html);
  if (hasImages && stripped.length < 30) {
    return {
      code: 'image_only',
      severity: 'warn',
      message: 'Email is image-only with little or no text.',
      hint: 'Image-only emails get penalized by spam filters and break for users with images disabled. Add a sentence or two of body copy.',
    };
  }
  return null;
}

function checkUnreachableImages({ html, logoUrl }) {
  const urls = findUnreachableImageUrls(html, logoUrl);
  if (!urls.length) return null;
  return {
    code: 'unreachable_images',
    severity: 'warn',
    message: `${urls.length} image URL${urls.length === 1 ? '' : 's'} point at localhost or a private network.`,
    hint: 'Recipients\' mail clients won\'t be able to load these. Set PUBLIC_BASE_URL to a publicly reachable URL and re-upload the assets.',
    meta: { urls },
  };
}
