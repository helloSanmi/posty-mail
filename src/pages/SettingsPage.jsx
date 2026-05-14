import { useEffect, useId, useState } from 'react';
import { AtSign, Check, CheckCircle2, Code, Copy, Key, MailX, Pencil, PlugZap, Plus, RotateCcw, ShieldCheck, ShieldOff, Trash2, UserPlus } from 'lucide-react';
import {
  addUnsubscribe,
  getBounceSync,
  getDeliverabilityCheck,
  getGroups,
  getHealth,
  getSenderSetting,
  getUnsubscribeCategories,
  getUnsubscribes,
  getVerifiedSenders,
  restoreUnsubscribe,
  saveSenderSetting,
  saveUnsubscribeCategories,
  saveWebhookIntegration,
  setBounceSync,
} from '../services/brevoApi';

const SECTIONS = [
  { id: 'connections', label: 'Connections', icon: PlugZap, blurb: 'Webhooks and outbound integrations.' },
  { id: 'forms', label: 'Subscribe forms', icon: UserPlus, blurb: 'Embed a sign-up form on any website.' },
  { id: 'email', label: 'Email behavior', icon: ShieldOff, blurb: 'How bounces and complaints are handled.' },
  { id: 'unsubscribes', label: 'Unsubscribes', icon: MailX, blurb: 'People who should never be emailed, plus the preference center.' },
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
  // Deliverability self-check (SPF / DKIM / DMARC). On-demand. Run via the
  // "Check now" button. Cached for this page render so a refresh re-fetches.
  const [deliverability, setDeliverability] = useState(null);
  const [deliverabilityState, setDeliverabilityState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [deliverabilityError, setDeliverabilityError] = useState('');
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
        // sends actually use right now. Not just the (possibly empty) stored
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

  // When nothing is configured yet, any non-empty form input counts as dirty
  // so the Save button enables on first use. After that, dirty means "form
  // differs from what sends actually use right now."
  const senderDirty = !senderEffective
    ? Boolean(senderForm.email.trim() || senderForm.name.trim())
    : senderForm.email.trim() !== (senderEffective.email || '')
      || senderForm.name.trim() !== (senderEffective.name || '');
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
      notify('Sender updated. Applies to next send');
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

  async function runDeliverabilityCheck() {
    setDeliverabilityState('loading');
    setDeliverabilityError('');
    try {
      const data = await getDeliverabilityCheck();
      setDeliverability(data);
      setDeliverabilityState('idle');
    } catch (error) {
      const message = error.response?.data?.error || 'Could not run deliverability check';
      setDeliverabilityError(message);
      setDeliverabilityState('error');
    }
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
                      ok={Boolean(senderEffective)}
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
                          {senderSource === 'env' && (
                            <span className="muted" style={{ fontSize: '0.78rem' }}>
                              From <code>BREVO_SENDER_EMAIL</code> env. Save here to override.
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted">
                          Not configured. Campaigns will refuse to send until you set this.
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={() => setSenderEditing(true)}>
                      <Pencil size={13} aria-hidden="true" /> {senderEffective ? 'Edit' : 'Set up'}
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

              <DeliverabilityCard
                state={deliverabilityState}
                error={deliverabilityError}
                result={deliverability}
                senderConfigured={Boolean(senderEffective)}
                onRun={runDeliverabilityCheck}
              />

              <section className="surface settings-card">
                <div className="settings-card-head">
                  <div>
                    <h3>Outbound webhook</h3>
                    <p className="muted">
                      Forward <code>campaign.completed</code> and <code>contact.unsubscribed</code>{' '}
                      events to your own endpoint. Zapier, Slack, a CRM, anywhere.
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

          {active === 'forms' && (
            <SubscribeFormsCard notify={notify} />
          )}

          {active === 'unsubscribes' && (
            <>
              <PreferenceCenterCard notify={notify} />
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
                        title={`Re-subscribe ${item.email}. Removes from this list and sets consent back to yes`}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Deliverability self-check card. Shows three rows (SPF / DKIM / DMARC) with
// pass/warn/fail status and the actual record value (or an example to paste
// at the DNS provider if missing). Read-only. Run on demand to avoid making
// every Settings page load do three DNS round-trips.
function DeliverabilityCard({ state, error, result, senderConfigured, onRun }) {
  const summary = result ? summarizeDeliverability(result) : null;
  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3><ShieldCheck size={16} aria-hidden="true" /> Deliverability</h3>
          <p className="muted">
            SPF / DKIM / DMARC for your sender domain. Mail providers use these to decide
            whether you go to the inbox, the spam folder, or get bounced.
          </p>
        </div>
        {summary && (
          <StatusPill
            ok={summary.allPass}
            okLabel="All passing"
            emptyLabel={summary.failures > 0 ? `${summary.failures} failing` : 'Action needed'}
          />
        )}
      </div>

      {!senderConfigured && (
        <p className="muted">Configure your sender above first, then come back and run the check.</p>
      )}

      {senderConfigured && !result && state !== 'loading' && (
        <p className="muted">Run a one-time DNS check to see if recipients will trust your sends.</p>
      )}

      {state === 'error' && (
        <p className="empty-state error" role="alert">{error || 'Check failed.'}</p>
      )}

      {result && (
        <div className="deliverability-results">
          <div className="muted deliverability-domain">
            Checked <code>{result.domain}</code>
          </div>
          <DeliverabilityRow label="SPF" record={result.spf} />
          <DeliverabilityRow label="DKIM" record={result.dkim} />
          <DeliverabilityRow label="DMARC" record={result.dmarc} />
        </div>
      )}

      <div className="deliverability-actions">
        <button type="button" onClick={onRun} disabled={!senderConfigured || state === 'loading'}>
          {state === 'loading' ? 'Checking…' : result ? 'Re-check' : 'Check now'}
        </button>
      </div>
    </section>
  );
}

function DeliverabilityRow({ label, record }) {
  if (!record) return null;
  const klass = `deliverability-row is-${record.status}`;
  return (
    <div className={klass}>
      <div className="deliverability-row-head">
        <strong>{label}</strong>
        <span className={`pill ${record.status === 'pass' ? 'green' : record.status === 'warn' ? 'amber' : 'red'} deliverability-pill`}>
          {record.status.toUpperCase()}
        </span>
      </div>
      <div className="deliverability-row-message">{record.message}</div>
      {record.hint && <div className="muted deliverability-row-hint">{record.hint}</div>}
      {record.found && !Array.isArray(record.found) && (
        <pre className="deliverability-record">{record.found}</pre>
      )}
      {Array.isArray(record.found) && record.found.map((value, i) => (
        // Multiple records returned (e.g. duplicate SPFs). Each value is the
        // full TXT, so it's stable enough to use directly as the key.
        <pre key={`${value}-${i}`} className="deliverability-record">{value}</pre>
      ))}
      {!record.found && record.example && (
        <pre className="deliverability-record is-example">
          {/* Example record to paste at the DNS provider. Helps when the user
              has never set this up before. */}
          {record.example}
        </pre>
      )}
    </div>
  );
}

function summarizeDeliverability(result) {
  const records = [result.spf, result.dkim, result.dmarc].filter(Boolean);
  const failures = records.filter((r) => r.status === 'fail').length;
  const warns = records.filter((r) => r.status === 'warn').length;
  return {
    allPass: failures === 0 && warns === 0,
    failures,
    warns,
  };
}

// Subscribe-form widget builder. Shows the embed snippet with a group
// picker, plus a one-click copy button. No persistence: the snippet is
// derived from the host base URL + chosen group id at render time.
function SubscribeFormsCard({ notify }) {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [collectName, setCollectName] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getGroups().then((g) => setGroups(g)).catch(() => setGroups([]));
  }, []);

  // PUBLIC_BASE_URL is what recipients' mail clients use; same value is
  // what a host-site embed will fetch. Falls back to window.location.origin
  // so a dev install still produces a working snippet.
  const baseUrl = (typeof window !== 'undefined' && window.location?.origin) || '';
  const action = `${baseUrl}/api/public/subscribe`;
  const scriptSrc = `${baseUrl}/posty-form.js`;

  const attrs = [
    `data-posty-form`,
    `data-action="${action}"`,
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
            Drop this snippet onto any website. Visitors who submit it land in your
            audience automatically (and into the group you pick, if any).
          </p>
        </div>
      </div>

      <div className="subscribe-form-grid">
        <label>
          Add new subscribers to group
          <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
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
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="snippet-body">{snippet}</pre>
        <p className="muted snippet-note">
          The widget POSTs to <code>{action}</code>. Make sure your host site is in the
          CORS allowlist (set <code>CORS_ORIGIN</code> on the backend env).
        </p>
      </div>
    </section>
  );
}

// Preference-center categories editor. Sits inside the Unsubscribes tab
// because it's the other half of how recipients control what they receive.
// Defining at least one category here makes the /unsubscribe page render
// a per-topic re-subscribe form below the unsubscribe confirmation.
function PreferenceCenterCard({ notify }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getUnsubscribeCategories()
      .then((list) => {
        if (cancelled) return;
        setCategories(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function update(index, patch) {
    setCategories((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCategory() {
    setCategories((prev) => [...prev, { id: '', label: '', description: '' }]);
  }

  function removeCategory(index) {
    setCategories((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    // Drop empty rows; basic schema validation is done on the server too.
    const cleaned = categories
      .map((c) => ({
        id: String(c.id || '').trim(),
        label: String(c.label || '').trim(),
        description: String(c.description || '').trim(),
      }))
      .filter((c) => c.id && c.label);
    if (cleaned.length !== categories.length) {
      // Show the cleaned list back to the user so they see what's about to save.
      setCategories(cleaned);
    }
    setSaving(true);
    try {
      const saved = await saveUnsubscribeCategories(cleaned);
      setCategories(saved);
      notify?.(saved.length ? 'Preference center categories saved' : 'Preference center disabled (no categories)');
    } catch (error) {
      notify?.(error.response?.data?.error || 'Could not save categories', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Preference center</h3>
          <p className="muted">
            Define topics so recipients can selectively re-subscribe instead of
            leaving entirely. Categories show as checkboxes on your unsubscribe page.
            Leave empty to keep the legacy all-or-nothing flow.
          </p>
        </div>
        <StatusPill
          ok={categories.length > 0}
          okLabel={`${categories.length} ${categories.length === 1 ? 'category' : 'categories'}`}
          emptyLabel="Not configured"
        />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {categories.length === 0 ? (
            <p className="muted preference-empty">
              No categories yet. Click <strong>Add category</strong> to start.
            </p>
          ) : (
            <ul className="preference-list">
              {categories.map((category, index) => (
                <li key={index} className="preference-row">
                  <input
                    value={category.id}
                    onChange={(event) => update(index, { id: event.target.value })}
                    placeholder="newsletter"
                    aria-label="Category id"
                    className="preference-id"
                  />
                  <input
                    value={category.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    placeholder="Weekly newsletter"
                    aria-label="Category label"
                    className="preference-label"
                  />
                  <input
                    value={category.description || ''}
                    onChange={(event) => update(index, { description: event.target.value })}
                    placeholder="Short helper text shown under the label (optional)"
                    aria-label="Category description"
                    className="preference-description"
                  />
                  <button
                    type="button"
                    onClick={() => removeCategory(index)}
                    aria-label={`Remove ${category.label || category.id}`}
                    className="preference-remove"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="preference-actions">
            <button type="button" onClick={addCategory}>
              <Plus size={14} aria-hidden="true" /> Add category
            </button>
            <button type="button" className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save categories'}
            </button>
          </div>
        </>
      )}
    </section>
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
