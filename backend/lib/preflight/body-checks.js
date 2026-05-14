// HTML / text body preflight rules. Covers structural problems (no html,
// missing unsubscribe, broken merge tags), deliverability red flags (HTML
// size, link count, image-only emails), and image reachability (localhost
// URLs that won't load in real inboxes).
import { findUnreachableImageUrls } from '../urlReachability.js';

// Gmail clips messages after ~102KB of HTML and shows a "[Message clipped]"
// banner. Real users see this happen at slightly different thresholds; 100KB
// is a conservative warning point.
const GMAIL_CLIP_BYTES = 102 * 1024;
const GMAIL_CLIP_WARN_BYTES = 100 * 1024;

// A valid merge tag's inner content (between the {{ }}) looks like one of:
//   firstname                                    simple identifier
//   contact.FIRSTNAME                            dot-namespaced (Brevo)
//   contact.FIRSTNAME|default:'there'            with one filter
//   foo|filter1|filter2:'arg'                    chained filters
//   params.unsubscribe_url                       params syntax
// Surrounding whitespace is fine, as are spaces around `|` and `:`.
const VALID_MERGE_INNER = /^\s*[a-zA-Z_][a-zA-Z0-9_.]*(?:\s*\|\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*:\s*(?:'[^']*'|"[^"]*"|[^|}]+))?)*\s*$/;

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

export const BODY_CHECKS = [
  checkHtmlPresent,
  checkHtmlSize,
  checkUnsubscribeMergeTag,
  checkBrokenMergeTags,
  checkPlainTextFallback,
  checkLinkCount,
  checkImageOnlyContent,
  checkUnreachableImages,
];
