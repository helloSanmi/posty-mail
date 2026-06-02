// HTML renderers for the public /unsubscribe page. Returned as plain HTML
// strings (no React, no framework) so the page renders correctly even when
// the user's mail client strips JS or scripts get blocked. All template
// values pass through escapeHtml() before interpolation.

export function renderUnsubscribePage({
  ok, title, email, message, categories = [], checked = [], account = '',
}) {
  const safeEmail = email ? escapeHtml(email) : '';
  const accent = ok ? '#16a34a' : '#dc2626';
  const checkedSet = new Set(checked || []);
  // Only render the preferences form when categories are defined AND the
  // page is in a valid (unsubscribed-confirmed) state. The "bad link"
  // page doesn't show the form because we don't have an email for it.
  const showPrefsForm = ok && safeEmail && Array.isArray(categories) && categories.length > 0;
  const okIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<polyline points="20 6 9 17 4 12"/></svg>';
  const errIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    align-items: center;
    background: #f5f7f9;
    color: #1f2937;
    display: flex;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    justify-content: center;
    margin: 0;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid #e6eaef;
    border-radius: 14px;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
    max-width: 440px;
    padding: 32px;
    text-align: center;
    width: 100%;
  }
  .badge {
    align-items: center;
    background: ${accent}15;
    border-radius: 999px;
    color: ${accent};
    display: inline-flex;
    height: 48px;
    justify-content: center;
    margin-bottom: 16px;
    width: 48px;
  }
  h1 { font-size: 1.4rem; margin: 0 0 12px; }
  p { color: #4b5563; line-height: 1.5; margin: 0 0 12px; }
  .email { color: #1f2937; font-weight: 500; word-break: break-all; }
  .prefs {
    border-top: 1px solid #e6eaef;
    margin-top: 22px;
    padding-top: 18px;
    text-align: left;
  }
  .prefs h2 { font-size: 1rem; margin: 0 0 6px; text-align: center; }
  .prefs > p { margin: 0 0 14px; text-align: center; }
  .prefs-list { display: grid; gap: 8px; list-style: none; margin: 0 0 16px; padding: 0; }
  .prefs-list li {
    background: #fbfcfd;
    border: 1px solid #e6eaef;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .prefs-list label {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 10px;
  }
  .prefs button {
    background: #24599a;
    border: 0;
    border-radius: 8px;
    color: #fff;
    cursor: pointer;
    font: 600 14px/1 inherit;
    padding: 11px 16px;
    width: 100%;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="badge" aria-hidden="true">${ok ? okIcon : errIcon}</div>
    <h1>${escapeHtml(title)}</h1>
    ${safeEmail ? `<p class="email">${safeEmail}</p>` : ''}
    <p>${escapeHtml(message)}</p>
    ${showPrefsForm ? renderPreferencesForm(safeEmail, categories, checkedSet, account) : ''}
  </div>
</body>
</html>`;
}

function renderPreferencesForm(safeEmail, categories, checkedSet, account = '') {
  const safeAccount = account ? escapeHtml(account) : '';
  const rows = categories.map((c) => {
    const id = escapeHtml(c.id);
    const label = escapeHtml(c.label || c.id);
    const description = c.description
      ? `<div style="color:#6b7280;font-size:.85em;margin-top:2px">${escapeHtml(c.description)}</div>`
      : '';
    const isChecked = checkedSet.has(c.id) ? ' checked' : '';
    return `<li><label>
      <input type="checkbox" name="category:${id}" value="1"${isChecked}>
      <div><strong>${label}</strong>${description}</div>
    </label></li>`;
  }).join('');
  return `<div class="prefs">
    <h2>Manage what you receive</h2>
    <p>Don't want to leave entirely? Pick the topics you'd still like to get.</p>
    <form method="POST" action="/unsubscribe/preferences">
      <input type="hidden" name="email" value="${safeEmail}">
      ${safeAccount ? `<input type="hidden" name="account" value="${safeAccount}">` : ''}
      <ul class="prefs-list">${rows}</ul>
      <button type="submit">Save preferences</button>
    </form>
  </div>`;
}

export function escapeHtml(value) {
  return String(value).replace(/[<>"&]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]
  ));
}
