// Tiny HTML pretty-printer. Not a full parser — regex passes that handle
// the subset of HTML found in transactional emails. Output looks like what
// VS Code's "Format Document" produces for the same input: each block-level
// tag on its own line, nested content indented two spaces per level, inline
// runs (text + <a> + <span> etc.) kept on a single line.
//
// Block-level tags get newlines around them. Inline tags do not, so things
// like `<a href="...">click</a>` stay readable inside a paragraph.
//
// Caveat: blob inputs with embedded <script> or <style> get the same
// treatment as the rest. Acceptable for email HTML where those tags are
// rare and usually stripped by the sanitizer anyway.

const BLOCK_TAGS = [
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'figure', 'figcaption',
  // <br> is intentionally NOT in this list — it's a line-break inside flowing
  // text, and treating it as a block would split paragraphs like
  // "line1<br>line2" into three lines (wrong: <br> means "soft return").
  // <hr> and <img> stay as blocks because they're typically standalone
  // (full-width separators / banner images).
  'hr', 'img',
];

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);

const BLOCK_REGEX = new RegExp(`</?(${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi');

const INDENT = '  ';

/**
 * Pretty-print an HTML string. Idempotent: format(format(x)) === format(x).
 *
 * @param {string} source
 * @returns {string}
 */
export function formatHtml(source) {
  if (typeof source !== 'string' || !source.trim()) return source || '';

  // Step 1: collapse the input so we start from a known shape. Strip
  // whitespace between adjacent tags so the regex passes below don't
  // have to deal with arbitrary indentation already in place.
  let html = source.replace(/>\s+</g, '><').trim();

  // Step 2: insert newlines around every block-level tag. This produces
  // one tag (or text node) per line — sometimes with a trailing closer
  // on the same line, which the indent pass below will split.
  html = html.replace(BLOCK_REGEX, (match) => `\n${match}\n`);

  // Step 3: split into non-empty lines, then walk them computing depth.
  // Closing tags dedent BEFORE printing; opening tags indent AFTER printing
  // unless they're self-closing or void. Text nodes keep the current depth.
  const lines = html.split('\n').map((l) => l.trim()).filter(Boolean);
  let depth = 0;
  const indented = [];
  for (const line of lines) {
    const isClose = /^<\/[a-zA-Z]/.test(line);
    const voidMatch = line.match(/^<([a-zA-Z][a-zA-Z0-9-]*)\b/);
    const isVoid = Boolean(voidMatch) && VOID_TAGS.has(voidMatch[1].toLowerCase());
    const isSelfClose = /\/>$/.test(line);
    const isOpen = /^<[a-zA-Z]/.test(line) && !isClose && !isVoid && !isSelfClose;

    if (isClose) depth = Math.max(0, depth - 1);
    indented.push(INDENT.repeat(depth) + line);
    if (isOpen) depth += 1;
  }

  // Step 4: collapse "leaf block" triples. A block tag that opens, contains
  // a single non-block line (text + inline tags), and closes — like
  // <p>hi <a href="x">there</a></p> — should print on a single line, not
  // three. This matches what VS Code's Format Document does for HTML.
  return collapseLeaves(indented).join('\n');
}

const BLOCK_OPEN_NAME = new RegExp(`^(\\s*)<(${BLOCK_TAGS.join('|')})\\b[^>]*>$`, 'i');
const BLOCK_CLOSE_NAME = new RegExp(`^\\s*</(${BLOCK_TAGS.join('|')})\\s*>$`, 'i');
const STARTS_WITH_BLOCK_TAG = new RegExp(`^\\s*</?(${BLOCK_TAGS.join('|')})\\b`, 'i');

function collapseLeaves(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const a = lines[i];
    const b = lines[i + 1];
    const c = lines[i + 2];
    const openMatch = a && a.match(BLOCK_OPEN_NAME);
    if (openMatch && b && c
        && !STARTS_WITH_BLOCK_TAG.test(b)) {
      const closeMatch = c.match(BLOCK_CLOSE_NAME);
      if (closeMatch && closeMatch[1].toLowerCase() === openMatch[2].toLowerCase()) {
        // Collapse three lines into one. Keep the leading indent from line a;
        // strip whitespace inside each piece so we don't get `<p> hi </p>`.
        out.push(openMatch[1] + a.trim() + b.trim() + c.trim());
        i += 3;
        continue;
      }
    }
    out.push(a);
    i += 1;
  }
  return out;
}
