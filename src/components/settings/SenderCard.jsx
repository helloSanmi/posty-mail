import { useEffect, useId, useState } from 'react';
import { AtSign, Pencil } from 'lucide-react';
import {
  getSenderSetting,
  getVerifiedSenders,
  saveSenderSetting,
} from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// Sender identity (From name + email) for outgoing campaigns. Stored in the
// Setting table so admins can edit via UI without touching env vars.
// Read-only by default; Edit reveals the form, Cancel reverts.
//
// Optional `onChange` callback fires after a successful save. The
// DeliverabilityCard listens for that so it can re-run its DNS check
// against the new sender domain without a page refresh.
export function SenderCard({ notify, onChange }) {
  const [form, setForm] = useState({ email: '', name: '' });
  const [effective, setEffective] = useState(null);
  // 'database' | 'env' | 'unset'. Drives the small "from env" hint when
  // the value is coming from BREVO_SENDER_EMAIL rather than the DB.
  const [source, setSource] = useState(null);
  const [verifiedSenders, setVerifiedSenders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const emailId = useId();
  const nameId = useId();

  useEffect(() => {
    getSenderSetting()
      .then((data) => {
        setEffective(data.effective);
        setSource(data.source);
        // Pre-fill the form with what sends actually use right now —
        // either the DB-stored override or the env fallback — so the
        // admin sees existing values when they hit Edit.
        setForm({
          email: data.stored?.email || data.effective?.email || '',
          name: data.stored?.name || data.effective?.name || '',
        });
      })
      .catch(() => {});
    getVerifiedSenders()
      .then((data) => setVerifiedSenders(data?.senders || []))
      .catch(() => {});
  }, []);

  // When nothing is configured yet, any non-empty input counts as dirty so
  // Save enables on first use. Otherwise dirty means the form differs from
  // what's currently in effect.
  const dirty = !effective
    ? Boolean(form.email.trim() || form.name.trim())
    : form.email.trim() !== (effective.email || '')
      || form.name.trim() !== (effective.name || '');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSave = dirty && emailValid && form.name.trim().length > 0;

  async function save() {
    setSaving(true);
    try {
      const saved = await saveSenderSetting({
        email: form.email.trim(),
        name: form.name.trim(),
      });
      setEffective({ email: saved.email, name: saved.name });
      setSource('database');
      setEditing(false);
      notify('Sender updated. Applies to next send');
      onChange?.({ email: saved.email, name: saved.name });
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save sender', 'error');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    // Revert the form to whatever sends are currently using.
    setForm({
      email: effective?.email || '',
      name: effective?.name || '',
    });
    setEditing(false);
  }

  function pickVerifiedSender(value) {
    if (!value) return;
    const match = verifiedSenders.find((s) => s.email === value);
    if (!match) return;
    setForm({ email: match.email, name: match.name || form.name });
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3><AtSign size={16} aria-hidden="true" /> Sender</h3>
          <p className="muted">How emails appear in your recipients&apos; inboxes.</p>
        </div>
        {!editing && (
          <StatusPill
            ok={Boolean(effective)}
            okLabel="Configured"
            emptyLabel="Not configured"
          />
        )}
      </div>

      {!editing ? (
        <div className="sender-view">
          <div className="sender-view-identity">
            {effective?.name || effective?.email ? (
              <>
                <strong>{effective.name || effective.email}</strong>
                {effective.name && (
                  <span className="muted">{effective.email}</span>
                )}
                {source === 'env' && (
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
          <button type="button" onClick={() => setEditing(true)}>
            <Pencil size={13} aria-hidden="true" /> {effective ? 'Edit' : 'Set up'}
          </button>
        </div>
      ) : (
        <>
          <div className="sender-form-grid">
            <label htmlFor={nameId}>
              From name
              <input
                id={nameId}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Nest Analytics"
              />
            </label>
            <label htmlFor={emailId}>
              From email
              {verifiedSenders.length > 0 ? (
                <select
                  id={emailId}
                  value={form.email}
                  onChange={(event) => pickVerifiedSender(event.target.value)}
                >
                  {!verifiedSenders.find((s) => s.email === form.email) && (
                    <option value={form.email}>
                      {form.email || 'Pick a verified sender…'}
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
                  id={emailId}
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  placeholder="hello@yourdomain.com"
                />
              )}
            </label>
          </div>

          <div className="sender-actions">
            <button type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={save}
              disabled={!canSave || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
