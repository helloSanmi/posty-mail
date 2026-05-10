import { useEffect, useId, useState } from 'react';
import { CheckCircle2, Key, MailX, PlugZap, RotateCcw, ShieldOff } from 'lucide-react';
import {
  addUnsubscribe,
  getBounceSync,
  getHealth,
  getUnsubscribes,
  restoreUnsubscribe,
  saveWebhookIntegration,
  setBounceSync,
} from '../services/brevoApi';

const SECTIONS = [
  { id: 'connections', label: 'Connections', icon: PlugZap, blurb: 'Webhooks and outbound integrations.' },
  { id: 'email', label: 'Email behavior', icon: ShieldOff, blurb: 'How bounces and complaints are handled.' },
  { id: 'unsubscribes', label: 'Unsubscribes', icon: MailX, blurb: 'People who should never be emailed.' },
];

export function SettingsPage({ notify }) {
  const [active, setActive] = useState('connections');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaved, setWebhookSaved] = useState(false);
  const [unsubscribeEmail, setUnsubscribeEmail] = useState('');
  const [unsubscribes, setUnsubscribes] = useState([]);
  const [bounceSync, setBounceSyncState] = useState(false);
  // null = still loading; true / false = answer from /api/health
  const [brevoConfigured, setBrevoConfigured] = useState(null);
  const webhookId = useId();
  const unsubId = useId();
  const bounceSyncId = useId();

  useEffect(() => {
    getUnsubscribes().then(setUnsubscribes).catch(() => {});
    getBounceSync().then((data) => setBounceSyncState(data.enabled)).catch(() => {});
    getHealth()
      .then((data) => setBrevoConfigured(Boolean(data?.brevoConfigured)))
      .catch(() => setBrevoConfigured(false));
  }, []);

  async function handleBounceSyncToggle(enabled) {
    try {
      await setBounceSync(enabled);
      setBounceSyncState(enabled);
      notify(enabled ? 'Bounces will auto-unsubscribe' : 'Bounce auto-sync disabled');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update setting', 'error');
    }
  }

  async function saveWebhook() {
    try {
      await saveWebhookIntegration({
        type: 'webhook',
        url: webhookUrl,
        events: ['campaign.completed', 'contact.unsubscribed'],
      });
      setWebhookSaved(true);
      notify('Webhook saved');
    } catch (error) {
      const text = error.response?.data?.error || 'Could not save webhook';
      notify(text, 'error');
    }
  }

  async function saveUnsubscribe() {
    try {
      const record = await addUnsubscribe({ email: unsubscribeEmail });
      setUnsubscribes([
        record,
        ...unsubscribes.filter((item) => item.email !== record.email),
      ]);
      setUnsubscribeEmail('');
      notify('Unsubscribe saved');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save', 'error');
    }
  }

  async function handleRestore(email) {
    try {
      await restoreUnsubscribe(email);
      setUnsubscribes((items) => items.filter((item) => item.email !== email));
      notify(`${email} re-subscribed`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not restore', 'error');
    }
  }

  return (
    <div className="page-stack content-page settings-page">
      <header className="settings-header">
        <h2>Settings</h2>
        <p className="muted">Wire up integrations and control how the app handles bounces and unsubscribes.</p>
      </header>

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = active === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-item${isActive ? ' is-active' : ''}`}
                onClick={() => setActive(section.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="settings-nav-label">
                  <strong>{section.label}</strong>
                  <small className="muted">{section.blurb}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {active === 'connections' && (
            <>
              <section className="surface settings-card">
                <div className="settings-card-head">
                  <div>
                    <h3><Key size={16} aria-hidden="true" /> Brevo API key</h3>
                    <p className="muted">
                      Set <code>BREVO_API_KEY</code> in your backend <code>.env</code> to
                      actually deliver email. Without it, every send is a dry-run (logged,
                      not delivered).
                    </p>
                  </div>
                  {brevoConfigured === null ? (
                    <span className="pill muted">Checking…</span>
                  ) : (
                    <StatusPill
                      ok={brevoConfigured}
                      okLabel="Configured"
                      emptyLabel="Not configured"
                    />
                  )}
                </div>
                {brevoConfigured === false && (
                  <small className="muted">
                    Add <code>BREVO_API_KEY=xkeysib-…</code> to <code>.env</code> and
                    restart the backend. Your sends will keep being dry-runs until then.
                  </small>
                )}
              </section>

              <section className="surface settings-card">
                <div className="settings-card-head">
                  <div>
                    <h3>Outbound webhook</h3>
                    <p className="muted">
                      Send <code>campaign.completed</code> and <code>contact.unsubscribed</code> events
                      to your own endpoint (Zapier, Slack incoming webhook, your CRM…).
                    </p>
                  </div>
                  <StatusPill ok={webhookSaved} okLabel="Configured" emptyLabel="Not configured" />
                </div>
                <div className="inline-form">
                  <label htmlFor={webhookId} className="visually-hidden">Webhook URL</label>
                  <input
                    id={webhookId}
                    type="url"
                    placeholder="https://hooks.zapier.com/..."
                    value={webhookUrl}
                    onChange={(event) => { setWebhookUrl(event.target.value); setWebhookSaved(false); }}
                  />
                  <button
                    type="button"
                    className="primary"
                    onClick={saveWebhook}
                    disabled={!webhookUrl}
                  >
                    Save webhook
                  </button>
                </div>
              </section>
            </>
          )}

          {active === 'email' && (
            <section className="surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>Bounce auto-sync</h3>
                  <p className="muted">
                    When Brevo reports a hard bounce, blocked address, or spam complaint, automatically
                    add that email to your unsubscribe list so future campaigns skip it.
                  </p>
                </div>
                <StatusPill ok={bounceSync} okLabel="On" emptyLabel="Off" />
              </div>
              <label className="checkbox-line" htmlFor={bounceSyncId}>
                <input
                  id={bounceSyncId}
                  type="checkbox"
                  checked={bounceSync}
                  onChange={(event) => handleBounceSyncToggle(event.target.checked)}
                />
                Enable bounce auto-sync
              </label>
            </section>
          )}

          {active === 'unsubscribes' && (
            <section className="surface settings-card">
              <div className="settings-card-head">
                <div>
                  <h3>Unsubscribe list</h3>
                  <p className="muted">
                    Anyone listed here is skipped on every campaign send, regardless of audience or group.
                  </p>
                </div>
                <span className="muted settings-count">{unsubscribes.length} total</span>
              </div>
              <div className="inline-form">
                <label htmlFor={unsubId} className="visually-hidden">Email to add to unsubscribe list</label>
                <input
                  id={unsubId}
                  type="email"
                  placeholder="person@example.com"
                  value={unsubscribeEmail}
                  onChange={(event) => setUnsubscribeEmail(event.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={saveUnsubscribe}
                  disabled={!unsubscribeEmail}
                >
                  Add
                </button>
              </div>
              {unsubscribes.length === 0 ? (
                <p className="empty-state compact">No unsubscribes yet.</p>
              ) : (
                <ul className="unsubscribe-list">
                  {unsubscribes.slice(0, 50).map((item) => (
                    <li key={item.email}>
                      <div className="unsubscribe-meta">
                        <strong>{item.email}</strong>
                        <span className="muted">
                          {formatDate(item.unsubscribedAt)}
                          {item.reason ? ` · ${item.reason}` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => handleRestore(item.email)}
                        title={`Re-subscribe ${item.email} — removes from this list and sets consent back to yes`}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {unsubscribes.length > 50 && (
                <small className="muted">Showing 50 of {unsubscribes.length}.</small>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ ok, okLabel, emptyLabel }) {
  return (
    <span className={`pill ${ok ? 'green' : 'muted'} settings-status-pill`}>
      {ok && <CheckCircle2 size={12} aria-hidden="true" />}
      {ok ? okLabel : emptyLabel}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}
