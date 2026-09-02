import { useEffect, useId, useState } from 'react';
import { getWebhookIntegration, saveWebhookIntegration } from '../../services/brevoApi';
import { RowState, SettingGroup, SettingRow } from './SettingRow';

// Outbound webhook URL, stored under the `integrations.webhook` Setting.
//
// The copy here is deliberately narrow: this saves and reads a URL, and
// nothing in the backend dispatches to it yet. The two places that used to
// describe this setting both overstated it — this card claimed it forwards
// campaign.completed and contact.unsubscribed, and the old setup checklist
// called the same key a "provider webhook" that "enables real-time open /
// click / bounce tracking." Only the endpoints that SAVE and READ the value
// exist, so the row reports it as stored, not as sending.
//
// When delivery does land, the honest states become Off / Sending / Failing
// and this comment should go with them.
const EVENTS = ['campaign.completed', 'contact.unsubscribed'];

export function WebhookCard({ notify }) {
  const [saved, setSaved] = useState(null);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputId = useId();

  useEffect(() => {
    let cancelled = false;
    getWebhookIntegration()
      .then((data) => {
        if (cancelled) return;
        setSaved(data);
        setUrl(data?.url || '');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const next = await saveWebhookIntegration({
        type: 'webhook',
        url: url.trim(),
        events: EVENTS,
      });
      setSaved(next);
      setEditing(false);
      notify('Webhook saved');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save webhook', 'error');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setUrl(saved?.url || '');
    setEditing(false);
  }

  const hasUrl = Boolean(saved?.url);
  const valid = /^https?:\/\/\S+$/.test(url.trim());

  return (
    <SettingGroup title="Forwarding">
      <SettingRow
        name="Outbound webhook"
        value={hasUrl ? saved.url : 'No endpoint set'}
        mono={hasUrl}
        state={<RowState tone="off">{hasUrl ? 'Stored' : 'Off'}</RowState>}
        actions={!editing && (
          <button type="button" onClick={() => setEditing(true)}>
            {hasUrl ? 'Change' : 'Set up'}
          </button>
        )}
      >
        {!editing && (
          <p className="setting-row-hint">
            Saved for later — Posty does not dispatch events to this URL yet.
          </p>
        )}
        {editing && (
          <>
            <label htmlFor={inputId}>
              Endpoint URL
              <input
                id={inputId}
                type="url"
                placeholder="https://hooks.zapier.com/…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
            <div className="sender-actions">
              <button type="button" onClick={cancel} disabled={saving}>Cancel</button>
              <button
                type="button"
                className="primary"
                onClick={save}
                disabled={!valid || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </SettingRow>
    </SettingGroup>
  );
}
