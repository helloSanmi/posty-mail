// Strip tags + collapse whitespace to derive a readable plain-text version
// of an email's HTML. Used as a fallback when the user leaves Plain text empty.
export function textFromHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let text = html
    // remove <style> and <script> blocks (and their contents)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // turn block-level closes into newlines so paragraphs separate
    .replace(/<\/(p|div|h[1-6]|li|tr|table|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // strip remaining tags
    .replace(/<\/?[^>]+>/g, '');

  // decode common entities
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  text = text.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => entities[name] || '');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
