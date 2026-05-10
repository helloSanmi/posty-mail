// Parse + edit <a> tags in arbitrary HTML strings without disturbing the rest of the markup.

const A_TAG_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

export function getLinksFromHtml(html) {
  if (typeof html !== 'string' || !html) return [];

  const matches = [];
  let match;
  A_TAG_RE.lastIndex = 0;
  while ((match = A_TAG_RE.exec(html)) !== null) {
    const attrs = match[1];
    const inner = match[2];
    matches.push({
      index: matches.length,
      href: extractAttr(attrs, 'href'),
      text: stripTags(inner) || '(no text)',
      raw: match[0],
    });
  }
  return matches;
}

export function replaceLinkAttrs(html, targetIndex, { href, text }) {
  if (typeof html !== 'string' || !html) return html;

  let count = 0;
  return html.replace(A_TAG_RE, (full, attrs, inner) => {
    if (count++ !== targetIndex) return full;

    let nextAttrs = attrs;
    if (typeof href === 'string') {
      const safe = href.replace(/"/g, '&quot;');
      if (/\bhref\s*=/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(
          /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
          `href="${safe}"`,
        );
      } else {
        nextAttrs = ` href="${safe}"${nextAttrs}`;
      }
    }

    let nextInner = inner;
    if (typeof text === 'string') {
      // Only rewrite plain-text inner content; preserve markup if there's nested HTML.
      const hasNestedTags = /<[^>]+>/.test(inner);
      if (!hasNestedTags) {
        nextInner = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }
    }

    return `<a${nextAttrs}>${nextInner}</a>`;
  });
}

export function removeLink(html, targetIndex) {
  if (typeof html !== 'string' || !html) return html;
  let count = 0;
  return html.replace(A_TAG_RE, (full, _attrs, inner) => {
    if (count++ !== targetIndex) return full;
    return inner; // unwrap: keep contents, drop the <a> wrapper
  });
}

function extractAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrs.match(re);
  if (!match) return '';
  return (match[2] ?? match[3] ?? match[4] ?? '').trim();
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
