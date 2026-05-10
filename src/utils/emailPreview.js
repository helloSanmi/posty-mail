export const previewClientLabels = {
  gmail: 'Gmail preview',
  outlook: 'Outlook preview',
  apple: 'Apple Mail preview',
};

export function buildEmailPreviewDocument(html, client) {
  const styles = {
    gmail: [
      'body{background:#f1f3f4;padding:24px;}',
      '.email-client-shell{box-shadow:0 1px 3px rgba(60,64,67,.18);}',
    ].join(''),
    outlook: [
      'body{background:#f3f6fb;padding:24px;}',
      '.email-client-shell{border:1px solid #d7dde8;}',
    ].join(''),
    apple: [
      'body{background:#f6f6f7;padding:24px;}',
      '.email-client-shell{box-shadow:0 18px 48px rgba(0,0,0,.08);}',
    ].join(''),
  };

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:Arial,sans-serif;color:#1f2937}
      img{max-width:100%;height:auto}
      table{max-width:100%}
      .email-client-shell{background:#fff;margin:0 auto;max-width:680px}
      ${styles[client] || styles.gmail}
    </style>
  </head>
  <body>
    <div class="email-client-shell">${html}</div>
  </body>
</html>`;
}
