import { useEffect, useState } from 'react';
import { Check, Code, Copy, UserPlus } from 'lucide-react';
import { getGroups } from '../../services/brevoApi';
import { useAuth } from '../../auth/AuthContext';

// Embed-snippet builder for the public Subscribe form widget. Produces a
// `<div data-posty-form …><script src="…/posty-form.js" async>` snippet the
// admin pastes onto any site. The snippet is derived live from the host
// base URL + chosen group, so there's no persistence — re-rendering the
// card with different inputs just regenerates the string.
export function SubscribeFormsCard({ notify }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [collectName, setCollectName] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getGroups().then((g) => setGroups(g)).catch(() => setGroups([]));
  }, []);

  // PUBLIC_BASE_URL is what recipients' mail clients use; the same host
  // serves the embed JS. Fall back to window.location.origin so a dev
  // install still produces a working snippet.
  const baseUrl = (typeof window !== 'undefined' && window.location?.origin) || '';
  const action = `${baseUrl}/api/public/subscribe`;
  const scriptSrc = `${baseUrl}/posty-form.js`;

  // Bake the current workspace id into the embed so public subscribes land
  // in THIS account, not the default one. The id is opaque + already public
  // (it sits in the host site's HTML), same as Mailchimp's audience params.
  const attrs = [
    `data-posty-form`,
    `data-action="${action}"`,
    user?.accountId ? `data-account="${user.accountId}"` : null,
    selectedGroupId ? `data-group-id="${selectedGroupId}"` : null,
    successMessage ? `data-success="${successMessage.replace(/"/g, '&quot;')}"` : null,
    collectName ? null : `data-collect-name="false"`,
  ].filter(Boolean);

  const snippet = `<div ${attrs.join(' ')}></div>\n<script src="${scriptSrc}" async></script>`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      notify?.('Snippet copied. Paste into your site\'s HTML.');
    } catch {
      notify?.('Could not copy. Select and copy the snippet manually.', 'error');
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3><UserPlus size={16} aria-hidden="true" /> Subscribe form widget</h3>
          <p className="muted">
            Paste this snippet on your site — submissions land in your
            audience (and a group, if you pick one).
          </p>
        </div>
      </div>

      <div className="subscribe-form-grid">
        <label>
          Add new subscribers to group
          <select
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
          >
            <option value="">(no specific group)</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
        <label>
          Success message
          <input
            value={successMessage}
            onChange={(event) => setSuccessMessage(event.target.value)}
            placeholder="Thanks. You're on the list."
          />
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={collectName}
            onChange={(event) => setCollectName(event.target.checked)}
          />
          Collect first &amp; last name
        </label>
      </div>

      <div className="snippet-block">
        <div className="snippet-block-head">
          <Code size={14} aria-hidden="true" />
          <strong>Embed snippet</strong>
          <button type="button" onClick={copySnippet} className="snippet-copy">
            {copied
              ? <Check size={13} aria-hidden="true" />
              : <Copy size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="snippet-body">{snippet}</pre>
        <p className="muted snippet-note">
          The widget POSTs to <code>{action}</code>. Make sure your host
          site is in the CORS allowlist (set <code>CORS_ORIGIN</code> on
          the backend env).
        </p>
      </div>
    </section>
  );
}
