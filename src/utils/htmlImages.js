// Helpers for inspecting and editing <img> tags inside arbitrary HTML strings.
// Regex-based on purpose: we want to preserve the user's original markup
// (whitespace, comments, attribute order) instead of having DOMParser rewrite it.

const IMG_TAG_RE = /<img\b[^>]*?\/?>/gi;

export function getImagesFromHtml(html) {
  if (typeof html !== 'string' || !html) return [];

  const matches = [];
  let match;
  IMG_TAG_RE.lastIndex = 0;
  while ((match = IMG_TAG_RE.exec(html)) !== null) {
    matches.push({
      index: matches.length,
      src: extractAttr(match[0], 'src'),
      alt: extractAttr(match[0], 'alt'),
      raw: match[0],
    });
  }
  return matches;
}

export function replaceImageSrc(html, targetIndex, nextSrc) {
  if (typeof html !== 'string' || !html) return html;
  const safeSrc = String(nextSrc).replace(/"/g, '&quot;');

  let count = 0;
  return html.replace(IMG_TAG_RE, (tag) => {
    if (count++ !== targetIndex) return tag;
    if (/\bsrc\s*=/i.test(tag)) {
      return tag.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, `src="${safeSrc}"`);
    }
    return tag.replace(/<img\b/i, `<img src="${safeSrc}"`);
  });
}

function extractAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return '';
  return (match[2] ?? match[3] ?? match[4] ?? '').trim();
}
