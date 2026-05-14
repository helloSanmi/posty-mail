import { formatHtml } from './formatHtml.js';

// Block → HTML serializer. The "Visual" editor stores templates as an array
// of block objects (`template.blocks`); this module renders that array into
// the `template.html` string the rest of the pipeline already understands.
//
// We deliberately keep the block schema small for v1:
//   - heading   { level: 1|2|3, text }
//   - paragraph { text }
//   - image     { src, alt, width, href? }
//   - button    { label, href, bg, color }
//   - divider   { }
//   - spacer    { height }
//
// Future blocks slot in by adding a case to renderBlock and a corresponding
// editor row in BlockEditor.jsx. No registry indirection. just open the file.

/**
 * @param {Array<{type: string, props?: Object}>} blocks
 * @returns {string}  HTML safe to drop into the existing template.html field.
 */
export function serializeBlocks(blocks) {
  if (!Array.isArray(blocks)) return '';
  const body = blocks.map(renderBlock).filter(Boolean).join('\n');
  // Run through formatHtml so the output is pretty-printed (each block tag on
  // its own line, nested content indented). Avoids the "one long string" mess
  // that the raw template-string output produces.
  return formatHtml(wrapContainer(body));
}

function wrapContainer(inner) {
  // Inline styles so it survives the email-clients-strip-style-tags world.
  // Width 600 is the Mailchimp-standard "safe for all clients" body width.
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#1f2937;">
${inner}
</table>`;
}

function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  const props = block.props || {};
  switch (block.type) {
    case 'heading':
      return renderHeading(props);
    case 'paragraph':
      return renderParagraph(props);
    case 'image':
      return renderImage(props);
    case 'button':
      return renderButton(props);
    case 'divider':
      return renderDivider();
    case 'spacer':
      return renderSpacer(props);
    default:
      return '';
  }
}

function renderHeading({ level = 2, text = '' } = {}) {
  const tag = `h${[1, 2, 3].includes(Number(level)) ? Number(level) : 2}`;
  const sizes = { h1: '28px', h2: '22px', h3: '18px' };
  return `<tr><td style="padding:14px 24px 6px;">
  <${tag} style="margin:0;font-size:${sizes[tag]};line-height:1.25;color:#0f1729;">${escape(text)}</${tag}>
</td></tr>`;
}

function renderParagraph({ text = '' } = {}) {
  // Preserve user-entered line breaks. Treat double-newline as paragraph
  // boundary so the writer doesn't need an extra "paragraph" block per chunk.
  const paragraphs = String(text).split(/\n{2,}/).map((para) => {
    const inner = escape(para).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 12px;line-height:1.5;">${inner}</p>`;
  }).join('\n');
  return `<tr><td style="padding:6px 24px;">${paragraphs}</td></tr>`;
}

function renderImage({ src = '', alt = '', width = 600, href = '' } = {}) {
  if (!src) return '';
  const img = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" width="${Number(width) || 600}" style="display:block;width:100%;max-width:${Number(width) || 600}px;height:auto;border:0;">`;
  const wrapped = href
    ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${img}</a>`
    : img;
  return `<tr><td style="padding:10px 0;text-align:center;">${wrapped}</td></tr>`;
}

function renderButton({ label = 'Click here', href = '#', bg = '#24599a', color = '#ffffff' } = {}) {
  return `<tr><td style="padding:16px 24px;">
  <a href="${escapeAttr(href)}" style="display:inline-block;padding:11px 22px;background:${escapeAttr(bg)};color:${escapeAttr(color)};text-decoration:none;border-radius:6px;font-weight:600;">${escape(label)}</a>
</td></tr>`;
}

function renderDivider() {
  return `<tr><td style="padding:14px 24px;">
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:0;">
</td></tr>`;
}

function renderSpacer({ height = 24 } = {}) {
  const h = Math.max(4, Math.min(120, Number(height) || 24));
  return `<tr><td style="line-height:${h}px;height:${h}px;font-size:${h}px;">&nbsp;</td></tr>`;
}

function escape(value) {
  return String(value).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
function escapeAttr(value) {
  return String(value).replace(/["<>&]/g, (c) => ({ '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
