import { useEffect, useId, useState } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
import {
  getSenderSetting,
  getSetupStatus,
  getVerifiedSenders,
  saveSenderSetting,
} from '../../services/brevoApi';
import { RowState, SettingGroup, SettingRow } from './SettingRow';

// "Can this install send, and who does it send as?" — the merge of the old
// SetupStatusCard and SenderCard, which both fetched and displayed the
// sender email and sat one above the other saying overlapping things.
//
// Two rows: the sender identity (editable in place) and the email provider.
// The provider's long remediation hints only render when something is
// actually wrong, so the normal case is two lines instead of a checklist of
// explanatory prose.

// Verdict for the group pill. Ordered worst-first.
function providerState(s) {
  if (!s.provider.configured) {
    return {
      tone: 'warn',
      label: 'Dry-run',
      value: 'No API key — emails are logged, not delivered',
      hint: 'Add BREVO_API_KEY to the backend .env and restart.',
    };
  }
  if (s.provider.dryRun) {
    return {
      tone: 'warn',
      label: 'Dry-run',
      value: 'DEMO_MODE is on — emails are logged, not delivered',
    };
  }
  if (!s.provider.valid) {
    return {
      tone: 'bad',
      label: 'Key rejected',
      value: s.provider.error || 'Brevo rejected the API key.',
      hint: 'If the key looks set, a BREVO_API_KEY exported in your shell overrides .env — '
        + 'run `unset BREVO_API_KEY` and restart.',
    };
  }
  return {
    tone: 'ok',
    label: 'Connected',
    value: `Brevo${s.provider.account ? ` · ${s.provider.account}` : ''}`
      + `${s.provider.plan ? ` · ${s.provider.plan} plan` : ''}`,
  };
}

function senderState(s) {
  if (!s.sender.configured) {
    return { tone: 'bad', label: 'Not set', hint: 'Campaigns refuse to send until this is set.' };
  }
  if (s.sender.verified === true) return { tone: 'ok', label: 'Verified' };
  if (s.sender.verified === false) {
    return {
      tone: 'warn',
      label: 'Not verified',
      hint: 'Not a verified Brevo sender — messages may bounce or land in spam. '
        + 'Verify it in Brevo, or use an authenticated domain.',
    };
  }
  return { tone: 'ok', label: 'Configured' };
}

const VERDICT = {
  ok: 'Ready to send',
  warn: 'Check setup',
  bad: 'Action needed',
};

export function SendingCard({ notify, onSenderChange }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sender editing. `effective` is what sends actually use right now —
  // either the DB override or the env fallback.
  const [effective, setEffective] = useState(null);
  const [source, setSource] = useState(null);
  const [form, setForm] = useState({ email: '', name: '' });
  const [verifiedSenders, setVerifiedSenders] = useState([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const emailId = useId();
  const nameId = useId();

  function loadStatus() {
    setLoading(true);
    getSetupStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    getSenderSetting()
      .then((data) => {
        setEffective(data.effective);
        setSource(data.source);
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

  // With nothing configured, any non-empty input counts as dirty so Save
  // enables on first use.
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
      onSenderChange?.({ email: saved.email, name: saved.name });
      // The verified-in-Brevo answer changes with the address.
      loadStatus();
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save sender', 'error');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setForm({ email: effective?.email || '', name: effective?.name || '' });
    setEditing(false);
  }

  function pickVerifiedSender(value) {
    if (!value) return;
    const match = verifiedSenders.find((s) => s.email === value);
    if (!match) return;
    setForm({ email: match.email, name: match.name || form.name });
  }

  const provider = status ? providerState(status) : null;
  const sender = status ? senderState(status) : null;
  const verdict = (() => {
    if (!provider || !sender) return null;
    if (provider.tone === 'bad' || sender.tone === 'bad') return 'bad';
    if (provider.tone === 'warn' || sender.tone === 'warn') return 'warn';
    return 'ok';
  })();

  // Prefer the live sender setting for display: it updates the instant a
  // save lands, without waiting for the setup-status round trip.
  const senderValue = (() => {
    if (effective?.name && effective?.email) return `${effective.name} <${effective.email}>`;
    if (effective?.email) return effective.email;
    if (status?.sender?.email) return status.sender.email;
    return 'Not set';
  })();

  return (
    <SettingGroup
      title="Sending"
      state={verdict && (
        <RowState tone={verdict}>{VERDICT[verdict]}</RowState>
      )}
      action={(
        <button
          type="button"
          className="settings-group-refresh"
          onClick={loadStatus}
          disabled={loading}
          title="Re-check"
          aria-label="Re-check sending setup"
        >
          <RefreshCw size={14} aria-hidden="true" className={loading ? 'is-spinning' : undefined} />
        </button>
      )}
    >
      <SettingRow
        name="Sender"
        value={senderValue}
        state={sender && <RowState tone={sender.tone}>{sender.label}</RowState>}
        actions={!editing && (
          <button type="button" onClick={() => setEditing(true)}>
            <Pencil size={13} aria-hidden="true" /> {effective ? 'Edit' : 'Set up'}
          </button>
        )}
      >
        {!editing && sender?.hint && (
          <p className="setting-row-hint">{sender.hint}</p>
        )}
        {!editing && source === 'env' && (
          <p className="setting-row-hint">
            From <code>BREVO_SENDER_EMAIL</code> env. Save here to override.
          </p>
        )}
        {editing && (
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
              <button type="button" onClick={cancel} disabled={saving}>Cancel</button>
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
      </SettingRow>

      <SettingRow
        name="Email provider"
        value={loading && !status ? 'Checking…' : (provider?.value || 'Could not load setup status')}
        state={provider && <RowState tone={provider.tone}>{provider.label}</RowState>}
      >
        {/* Remediation only when there is something to remedy. */}
        {provider?.hint && <p className="setting-row-hint">{provider.hint}</p>}
      </SettingRow>
    </SettingGroup>
  );
}
