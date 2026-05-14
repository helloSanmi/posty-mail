export const previewClientLabels = {
  gmail: 'Gmail preview',
  outlook: 'Outlook preview',
  apple: 'Apple Mail preview',
};

// Per-client chrome (background, shell border/shadow). The HTML body itself
// renders inside `.email-client-shell` so the simulated client frame doesn't
// leak into the user's actual template.
const CLIENT_STYLES = {
  light: {
    gmail: 'body{background:#f1f3f4;padding:24px;color:#202124}.email-client-shell{background:#fff;box-shadow:0 1px 3px rgba(60,64,67,.18);}',
    outlook: 'body{background:#f3f6fb;padding:24px;color:#1b1f23}.email-client-shell{background:#fff;border:1px solid #d7dde8;}',
    apple: 'body{background:#f6f6f7;padding:24px;color:#1c1c1e}.email-client-shell{background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.08);}',
  },
  // Dark-mode chrome only. Recipients' clients in dark mode render the
  // SAME template HTML; we don't force-recolor the message contents because
  // doing so would lie about what they'll actually see (most clients only
  // recolor white backgrounds + black text, leaving brand colors alone).
  // The shell + body background flip; the message stays as the author
  // designed it.
  dark: {
    gmail: 'body{background:#202124;padding:24px;color:#e8eaed}.email-client-shell{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.5);}',
    outlook: 'body{background:#1f1f23;padding:24px;color:#e1e4e7}.email-client-shell{background:#fff;border:1px solid #2c2f36;}',
    apple: 'body{background:#1c1c1e;padding:24px;color:#e5e5e7}.email-client-shell{background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.6);}',
  },
};

/**
 * @param {string} html  Already-merged email HTML.
 * @param {'gmail'|'outlook'|'apple'} client  Which client chrome to simulate.
 * @param {object} [options]
 * @param {boolean} [options.dark]  When true, render the surrounding client
 *   chrome in dark mode. The message HTML itself is not recolored.
 */
export function buildEmailPreviewDocument(html, client, options = {}) {
  const mode = options.dark ? 'dark' : 'light';
  const clientStyles = CLIENT_STYLES[mode][client] || CLIENT_STYLES[mode].gmail;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,sans-serif}
      img{max-width:100%;height:auto}
      table{max-width:100%}
      .email-client-shell{margin:0 auto;max-width:680px}
      ${clientStyles}
    </style>
  </head>
  <body>
    <div class="email-client-shell">${html}</div>
  </body>
</html>`;
}

// Sample contact used to merge tags for preview. Real sends use actual contact
// rows; this is only for the in-app "what will it look like" display.
export const SAMPLE_PREVIEW_CONTACT = {
  firstname: 'Alex',
  lastname: 'Lee',
  email: 'preview@example.com',
  unsubscribeUrl: 'https://example.com/unsubscribe?email=preview@example.com',
};

// Minimal merge for preview only. Mirrors the renderTemplate semantics in
// shared/campaignUtils but lives here so the preview UI doesn't have to import
// backend-shaped helpers. Replaces `{{key}}` with the matching field, falling
// back to empty string for unknown tags.
export function mergePreview(template, contact = SAMPLE_PREVIEW_CONTACT) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key) => {
    const value = contact[key];
    return value == null ? '' : String(value);
  });
}
