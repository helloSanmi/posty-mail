import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getDeliverabilityCheck, getSenderSetting } from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// SPF / DKIM / DMARC self-check for the sender domain. Three rows, each with
// pass / warn / fail status, the actual TXT record found, and an example
// record to paste at the DNS provider if missing.
//
// Self-fetches the sender state so it can disable the "Check now" button
// when nothing is configured yet (otherwise the backend would 400 with a
// SENDER_NOT_CONFIGURED code). The optional `senderEpoch` prop (a counter
// the parent bumps after a sender save) triggers a re-fetch so the card
// becomes interactive immediately after the admin sets up a sender.
export function DeliverabilityCard({ senderEpoch = 0 }) {
  const [result, setResult] = useState(null);
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [senderConfigured, setSenderConfigured] = useState(false);

  // Re-read the sender state whenever the parent's senderEpoch ticks. Lets
  // the button enable immediately after a fresh save without a page reload.
  useEffect(() => {
    let cancelled = false;
    getSenderSetting()
      .then((data) => {
        if (!cancelled) setSenderConfigured(Boolean(data?.effective));
      })
      .catch(() => {
        if (!cancelled) setSenderConfigured(false);
      });
    return () => { cancelled = true; };
  }, [senderEpoch]);

  async function run() {
    setState('loading');
    setErrorMessage('');
    try {
      const data = await getDeliverabilityCheck();
      setResult(data);
      setState('idle');
    } catch (error) {
      setErrorMessage(error.response?.data?.error || 'Could not run deliverability check');
      setState('error');
    }
  }

  const summary = result ? summarize(result) : null;

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3><ShieldCheck size={16} aria-hidden="true" /> Deliverability</h3>
          <p className="muted">
            Check SPF, DKIM, and DMARC — the records inboxes use to trust
            your mail.
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
        <p className="muted">
          Configure your sender above first, then come back and run the check.
        </p>
      )}

      {senderConfigured && !result && state !== 'loading' && (
        <p className="muted">
          Run a one-time DNS check to see if recipients will trust your sends.
        </p>
      )}

      {state === 'error' && (
        <p className="empty-state error" role="alert">{errorMessage || 'Check failed.'}</p>
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
        <button type="button" onClick={run} disabled={!senderConfigured || state === 'loading'}>
          {state === 'loading' ? 'Checking…' : result ? 'Re-check' : 'Check now'}
        </button>
      </div>
    </section>
  );
}

function DeliverabilityRow({ label, record }) {
  if (!record) return null;
  const klass = `deliverability-row is-${record.status}`;
  const pillClass = record.status === 'pass'
    ? 'green'
    : record.status === 'warn' ? 'amber' : 'red';
  return (
    <div className={klass}>
      <div className="deliverability-row-head">
        <strong>{label}</strong>
        <span className={`pill ${pillClass} deliverability-pill`}>
          {record.status.toUpperCase()}
        </span>
      </div>
      <div className="deliverability-row-message">{record.message}</div>
      {record.hint && <div className="muted deliverability-row-hint">{record.hint}</div>}
      {record.found && !Array.isArray(record.found) && (
        <pre className="deliverability-record">{record.found}</pre>
      )}
      {Array.isArray(record.found) && record.found.map((value, i) => (
        // Multiple records (e.g. duplicate SPFs). Each value is the full TXT,
        // so it's stable as a key.
        <pre key={`${value}-${i}`} className="deliverability-record">{value}</pre>
      ))}
      {!record.found && record.example && (
        <pre className="deliverability-record is-example">
          {/* Example record to paste at the DNS provider. */}
          {record.example}
        </pre>
      )}
    </div>
  );
}

function summarize(result) {
  const records = [result.spf, result.dkim, result.dmarc].filter(Boolean);
  const failures = records.filter((r) => r.status === 'fail').length;
  const warns = records.filter((r) => r.status === 'warn').length;
  return {
    allPass: failures === 0 && warns === 0,
    failures,
    warns,
  };
}
