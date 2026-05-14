import { useId, useState } from 'react';
import { saveWebhookIntegration } from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// Outbound webhook configuration. Used to forward campaign / unsubscribe
// events to a third-party system (Zapier, Slack, a CRM). The URL stored in
// the Setting table is sent at event-fire time; we don't pre-validate it
// here beyond the empty check.
export function WebhookCard({ notify }) {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const inputId = useId();

  async function save() {
    try {
      await saveWebhookIntegration({
        type: 'webhook',
        url,
        events: ['campaign.completed', 'contact.unsubscribed'],
      });
      setSaved(true);
      notify('Webhook saved');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save webhook', 'error');
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Outbound webhook</h3>
          <p className="muted">
            Forward <code>campaign.completed</code> and{' '}
            <code>contact.unsubscribed</code> events to your own endpoint.
            Zapier, Slack, a CRM, anywhere.
          </p>
        </div>
        <StatusPill ok={saved} okLabel="Configured" emptyLabel="Not configured" />
      </div>
      <div className="inline-form">
        <label htmlFor={inputId} className="visually-hidden">Webhook URL</label>
        <input
          id={inputId}
          type="url"
          placeholder="https://hooks.zapier.com/..."
          value={url}
          onChange={(event) => { setUrl(event.target.value); setSaved(false); }}
        />
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={!url}
        >
          Save webhook
        </button>
      </div>
    </section>
  );
}
