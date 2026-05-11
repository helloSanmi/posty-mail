import { useEffect, useId, useState } from 'react';
import { AtSign, CheckCircle2, Key, MailX, Pencil, PlugZap, RotateCcw, ShieldOff } from 'lucide-react';
import {
  addUnsubscribe,
  getBounceSync,
  getHealth,
  getSenderSetting,
  getUnsubscribes,
  getVerifiedSenders,
  restoreUnsubscribe,
  saveSenderSetting,
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
  // Sender identity (From email + name) stored in Setting table.
  const [senderForm, setSenderForm] = useState({ email: '', name: '' });
  const [senderEffective, setSenderEffective] = useState(null);
  const [senderSource, setSenderSource] = useState(null); // 'database' | 'env' | 'default'
  const [verifiedSenders, setVerifiedSenders] = useState([]);
  const [senderSaving, setSenderSaving] = useState(false);
  // Card is read-only by default. Edit reveals the form; Cancel reverts.
  const [senderEditing, setSenderEditing] = useState(false);
  const webhookId = useId();
  const unsubId = useId();
  const bounceSyncId = useId();
  const senderEmailId = useId();
  const senderNameId = useId();

  useEffect(() => {
    getUnsubscribes().then(setUnsubscribes).catch(() => {});
    getBounceSync().then((data) => setBounceSyncState(data.enabled)).catch(() => {});
    getHealth()
      .then((data) => setBrevoConfigured(Boolean(data?.brevoConfigured)))
      .catch(() => setBrevoConfigured(false));
    getSenderSetting()
      .then((data) => {
        setSenderEffective(data.effective);
        setSenderSource(data.source);
        // Pre-fill the form with the effective values so the admin sees what
        // sends actually use right now — not just the (possibly empty) stored
        // override. Saving will then persist into the DB explicitly.
        setSenderForm({
          email: data.stored?.email || data.effective?.email || '',
          name: data.stored?.name || data.effective?.name || '',
        });
      })
      .catch(() => {});
    getVerifiedSenders()
      .then((data) => setVerifiedSenders(data?.senders || []))
      .catch(() => {});
  }, []);

  const senderDirty = senderEffective
    && (senderForm.email.trim() !== (senderEffective.email || '')
      || senderForm.name.trim() !== (senderEffective.name || ''));
  const senderEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderForm.email.trim());
  const senderCanSave = senderDirty && senderEmailValid && senderForm.name.trim().length > 0;

  async function saveSender() {
    setSenderSaving(true);
    try {
      const saved = await saveSenderSetting({
        email: senderForm.email.trim(),
        name: senderForm.name.trim(),
      });
      setSenderEffective({ email: saved.email, name: saved.name });
      setSenderSource('database');
      setSenderEditing(false);
      notify('Sender updated — applies to next send');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save sender', 'error');
    } finally {
      setSenderSaving(false);
    }
  }

  function cancelEditSender() {
    // Revert the form to whatever sends are currently using.
    setSenderForm({
      email: senderEffective?.email || '',
      name: senderEffective?.name || '',
    });
    setSenderEditing(false);
  }

  function pickVerifiedSender(value) {
    if (!value) return;
    const match = verifiedSenders.find((s) => s.email === value);
    if (!match) return;
    setSenderForm({ email: match.email, name: match.name || senderForm.name });
  }

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
                    <p className="muted">Required to deliver email through Brevo.</p>
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
                    Add <code>BREVO_API_KEY=xkeysib-…</code> to your backend <code>.env</code> and
                    restart the server. Until then, every send is a dry-run (logged, not delivered).
                  </small>
                )}
              </section>

              <section className="surface settings-card">
                <div className="settings-card-head">
                  <div>
                    <h3><AtSign size={16} aria-hidden="true" /> Sender</h3>
                    <p className="muted">How emails appear in your recipients&apos; inboxes.</p>
                  </div>
                  {!senderEditing && (
                    <StatusPill
                      ok={senderSource === 'database'}
                      okLabel="Configured"
                      emptyLabel="Not configured"
                    />
                  )}
                </div>

                {!senderEditing ? (
                  <div className="sender-view">
                    <div className="sender-view-identity">
                      {senderEffective?.name || senderEffective?.email ? (
                        <>
                          <strong>{senderEffective.name || senderEffective.email}</strong>
                          {senderEffective.name && (
                            <span className="muted">{senderEffective.email}</span>
                          )}
                        </>
                      ) : (
                        <span className="muted">No sender configured yet.</span>
                      )}
                    </div>
                    <button type="button" onClick={() => setSenderEditing(true)}>
                      <Pencil size={13} aria-hidden="true" /> Edit
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="sender-form-grid">
                      <label htmlFor={senderNameId}>
                        From name
                        <input
                          id={senderNameId}
                          value={senderForm.name}
                          onChange={(event) => setSenderForm({ ...senderForm, name: event.target.value })}
                          placeholder="Nest Analytics"
                        />
                      </label>
                      <label htmlFor={senderEmailId}>
                        From email
                        {verifiedSenders.length > 0 ? (
                          <select
                            id={senderEmailId}
                            value={senderForm.email}
                            onChange={(event) => pickVerifiedSender(event.target.value)}
                          >
                            {!verifiedSenders.find((s) => s.email === senderForm.email) && (
                              <option value={senderForm.email}>
                                {senderForm.email || 'Pick a verified sender…'}
                              </option>
                            )}
                            {verifiedSenders.map((s) => (
                              <option key={s.email} value={s.email} disabled={!s.active}>
                                {s.email}{!s.active ? ' (not verified)' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={senderEmailId}
                            type="email"
                            value={senderForm.email}
                            onChange={(event) => setSenderForm({ ...senderForm, email: event.target.value })}
                            placeholder="hello@yourdomain.com"
                          />
                        )}
                      </label>
                    </div>

                    <div className="sender-actions">
                      <button type="button" onClick={cancelEditSender} disabled={senderSaving}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={saveSender}
                        disabled={!senderCanSave || senderSaving}
                      >
                        {senderSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="surface settings-card">
                <div className="settings-card-head">
                  <div>
                    <h3>Outbound webhook</h3>
                    <p className="muted">
                      Forward <code>campaign.completed</code> and <code>contact.unsubscribed</code>{' '}
                      events to your own endpoint — Zapier, Slack, a CRM, anywhere.
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
