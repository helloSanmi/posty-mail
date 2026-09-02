import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getDeliverabilityCheck, getSenderSetting } from '../../services/brevoApi';
import { RowState, SettingGroup, SettingRow } from './SettingRow';

// SPF / DKIM / DMARC for the sender domain, one row each.
//
// The check itself is unchanged — it still calls
// GET /api/settings/sender/deliverability and consumes the same
// { domain, spf, dkim, dmarc } shape, where each record is
// { status: 'pass' | 'warn' | 'fail', message, hint?, found?, example? }.
// What changed is the presentation: each record used to be a bordered block
// with its message, its hint and its raw TXT all in the flow, so three
// passing records produced a wall of text saying everything was fine. Now a
// row shows the verdict, and the message, hint and record body only appear
// when the row is not passing or the reader opens it.
//
// Self-fetches the sender so the button can be disabled before setup (the
// endpoint 400s with SENDER_NOT_CONFIGURED otherwise). `senderEpoch` is a
// counter the parent bumps after a sender save, to re-probe without a
// reload.

const TONE = { pass: 'ok', warn: 'warn', fail: 'bad' };
const VERDICT = { pass: 'Pass', warn: 'Needs work', fail: 'Fail' };

// One-line summary per record, so a passing row says something short and a
// failing one keeps the detail. Falls back to the backend message.
function summarize(label, record) {
  if (!record) return '';
  if (record.status === 'pass') {
    if (label === 'DKIM' && record.selector) return `Signing at selector ${record.selector}`;
    if (record.found && !Array.isArray(record.found)) {
      // A key is unreadable at a glance; a policy is not.
      return label === 'DKIM' ? 'Public key published' : record.found;
    }
    return record.message;
  }
  return record.message;
}

function DeliverabilityRow({ label, record }) {
  const [open, setOpen] = useState(false);
  if (!record) return null;

  const tone = TONE[record.status] || 'off';
  const values = Array.isArray(record.found) ? record.found : [record.found].filter(Boolean);
  const hasDetail = Boolean(record.hint || values.length || record.example);

  return (
    <SettingRow
      name={label}
      value={summarize(label, record)}
      state={<RowState tone={tone}>{VERDICT[record.status] || record.status}</RowState>}
      actions={hasDetail && (
        <button
          type="button"
          className="setting-row-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Details'}
        </button>
      )}
    >
      {open && (
        <>
          {record.hint && <p className="setting-row-hint">{record.hint}</p>}
          {values.map((value, i) => (
            // Each value is a full TXT record, so it is stable as a key.
            <pre key={`${value}-${i}`} className="setting-row-pre">{value}</pre>
          ))}
          {!values.length && record.example && (
            <pre className="setting-row-pre is-example">{record.example}</pre>
          )}
        </>
      )}
    </SettingRow>
  );
}

export function DeliverabilityCard({ senderEpoch = 0 }) {
  const [result, setResult] = useState(null);
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [senderConfigured, setSenderConfigured] = useState(false);

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

  const records = result ? [result.spf, result.dkim, result.dmarc].filter(Boolean) : [];
  const verdict = (() => {
    if (!records.length) return null;
    if (records.some((r) => r.status === 'fail')) return 'bad';
    if (records.some((r) => r.status === 'warn')) return 'warn';
    return 'ok';
  })();

  return (
    <SettingGroup
      title="Domain authentication"
      state={verdict && (
        <RowState tone={verdict}>
          {verdict === 'ok' ? 'All passing' : 'Needs attention'}
        </RowState>
      )}
      action={(
        <button
          type="button"
          className="settings-group-refresh"
          onClick={run}
          disabled={!senderConfigured || state === 'loading'}
          title={senderConfigured ? 'Re-check DNS' : 'Set a sender first'}
          aria-label="Re-check domain authentication"
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={state === 'loading' ? 'is-spinning' : undefined}
          />
        </button>
      )}
    >
      {result && (
        <>
          <DeliverabilityRow label="SPF" record={result.spf} />
          <DeliverabilityRow label="DKIM" record={result.dkim} />
          <DeliverabilityRow label="DMARC" record={result.dmarc} />
        </>
      )}

      {!result && (
        <SettingRow
          name={senderConfigured ? 'SPF, DKIM and DMARC' : 'Sender not set'}
          value={senderConfigured
            ? 'Not checked yet'
            : 'Set a sender above, then run the check'}
          actions={senderConfigured && (
            <button type="button" onClick={run} disabled={state === 'loading'}>
              {state === 'loading' ? 'Checking…' : 'Check now'}
            </button>
          )}
        />
      )}

      {result && (
        <p className="setting-row-foot">
          Checked <code>{result.domain}</code>
        </p>
      )}

      {state === 'error' && (
        <p className="setting-row-hint is-error" role="alert">
          {errorMessage || 'Check failed.'}
        </p>
      )}
    </SettingGroup>
  );
}
