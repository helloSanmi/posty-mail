import { useEffect, useState } from 'react';
import {
  AlertTriangle, Check, Minus, RefreshCw, X,
} from 'lucide-react';
import { getSetupStatus } from '../../services/brevoApi';

// "Can this install actually send?" at a glance. Unlike the old check (which
// only asked whether BREVO_API_KEY was *set*), this verifies the key WORKS,
// that a sender is configured + verified, and whether the webhook is on — the
// exact things that silently block a send.
const ROW_ICON = {
  ok: Check, warn: AlertTriangle, bad: X, muted: Minus,
};

function buildRows(s) {
  const rows = [];

  if (!s.provider.configured) {
    rows.push({
      tone: 'warn',
      label: 'Email provider',
      value: 'Dry-run',
      hint: 'No BREVO_API_KEY set — emails are logged, not delivered. Add it to the backend .env and restart.',
    });
  } else if (s.provider.dryRun) {
    rows.push({
      tone: 'warn',
      label: 'Email provider',
      value: 'Dry-run (DEMO_MODE)',
      hint: 'DEMO_MODE is on — emails are logged, not delivered.',
    });
  } else if (s.provider.valid) {
    rows.push({
      tone: 'ok',
      label: 'Email provider',
      value: `Connected${s.provider.account ? ` · ${s.provider.account}` : ''}`,
      hint: s.provider.plan ? `Brevo ${s.provider.plan} plan.` : null,
    });
  } else {
    rows.push({
      tone: 'bad',
      label: 'Email provider',
      value: 'Key rejected',
      hint: `${s.provider.error || 'Brevo rejected the API key.'} If it looks set, a BREVO_API_KEY exported in your shell overrides .env — run \`unset BREVO_API_KEY\` and restart.`,
    });
  }

  rows.push(s.sender.configured
    ? { tone: 'ok', label: 'Sender identity', value: s.sender.email }
    : { tone: 'bad', label: 'Sender identity', value: 'Not set', hint: 'Set your From address below before sending.' });

  if (s.provider.valid && s.sender.configured) {
    if (s.sender.verified === true) {
      rows.push({ tone: 'ok', label: 'Sender verified', value: 'Verified in Brevo' });
    } else if (s.sender.verified === false) {
      rows.push({
        tone: 'warn',
        label: 'Sender verified',
        value: 'Not verified',
        hint: 'This sender isn’t a verified Brevo sender — messages may bounce or land in spam. Verify it in Brevo, or use an authenticated domain.',
      });
    }
  }

  rows.push({
    tone: s.webhook.configured ? 'ok' : 'muted',
    optional: true,
    label: 'Provider webhook',
    value: s.webhook.configured ? 'Configured' : 'Not set',
    hint: s.webhook.configured ? null : 'Optional — enables real-time open / click / bounce tracking.',
  });

  return rows;
}

function overallTone(rows) {
  if (rows.some((r) => r.tone === 'bad')) return 'bad';
  if (rows.some((r) => r.tone === 'warn' && !r.optional)) return 'warn';
  return 'ok';
}

const OVERALL_LABEL = { ok: 'Ready to send', warn: 'Check setup', bad: 'Action needed' };

export function SetupStatusCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    getSetupStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const rows = status ? buildRows(status) : [];
  const tone = status ? overallTone(rows) : 'muted';

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Setup status</h3>
          <p className="muted">Everything a campaign needs before it can go out.</p>
        </div>
        <div className="setup-head-right">
          {status && <span className={`pill setup-pill setup-${tone}`}>{OVERALL_LABEL[tone]}</span>}
          <button
            type="button"
            className="setup-refresh"
            onClick={load}
            disabled={loading}
            title="Re-check"
            aria-label="Re-check setup status"
          >
            <RefreshCw size={14} aria-hidden="true" className={loading ? 'is-spinning' : undefined} />
          </button>
        </div>
      </div>

      {loading && !status ? (
        <p className="muted">Checking…</p>
      ) : !status ? (
        <p className="muted">Could not load setup status.</p>
      ) : (
        <ul className="setup-checklist">
          {rows.map((row) => {
            const Icon = ROW_ICON[row.tone] || Minus;
            return (
              <li key={row.label} className={`setup-row setup-${row.tone}`}>
                <span className="setup-row-icon" aria-hidden="true"><Icon size={13} /></span>
                <span className="setup-row-main">
                  <span className="setup-row-top">
                    <strong>{row.label}</strong>
                    {row.value && <span className="setup-row-value">{row.value}</span>}
                  </span>
                  {row.hint && <small className="muted setup-row-hint">{row.hint}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
