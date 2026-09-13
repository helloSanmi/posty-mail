import { useMemo, useState } from 'react';
import { Columns3, Search, X } from 'lucide-react';
import { parseUserAgent } from '../../shared/userAgent.js';
import { useSessionState } from '../hooks/useViewState';

// The activity log.
//
// It was three columns — when, who, action — over a table that records far
// more than that: the resource and its id, a metadata blob whose shape
// differs per action, the actor's IP, and now their user agent. An audit
// trail exists to answer "who did what, to which thing, from where, and was
// that really them?", and it was answering the first two.
//
// Columns are choosable because those questions are not asked at the same
// time. Someone checking a permission change wants the metadata; someone
// checking a suspicious login wants IP and browser and does not care what
// the metadata says. A fixed set of columns has to be a compromise between
// the two; a choosable set does not.

const COLUMNS = [
  { key: 'when', label: 'When', always: true },
  { key: 'who', label: 'Who', always: true },
  { key: 'action', label: 'Action', always: true },
  { key: 'target', label: 'Target' },
  { key: 'details', label: 'Details' },
  { key: 'browser', label: 'Browser' },
  { key: 'device', label: 'Device' },
  { key: 'ip', label: 'IP' },
];

const DEFAULT_VISIBLE = ['when', 'who', 'action', 'target', 'details', 'browser'];
const STORAGE_KEY = 'posty.audit.columns';

function readColumns() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch { /* a stored preference is never worth an error */ }
  return DEFAULT_VISIBLE;
}

// The metadata blob differs per action, so it cannot have dedicated columns.
// Flattened to "key: value" it is still the most informative thing in the
// row — it is where "which role", "from what to what" and "how many" live.
export function describeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (Array.isArray(value)) return `${label}: ${value.join(', ')}`;
      if (typeof value === 'object') {
        const inner = Object.entries(value)
          .map(([k, v]) => `${k} → ${v}`)
          .join(', ');
        return `${label}: ${inner}`;
      }
      return `${label}: ${value}`;
    })
    .join(' · ');
}

export function ActivityLog({ logs, onRefresh }) {
  const [visible, setVisible] = useState(readColumns);
  const [chooserOpen, setChooserOpen] = useState(false);
  // These three survive a refresh, but they go in sessionStorage rather than
  // in the URL — the only place in the app that makes that choice, and it is
  // deliberate.
  //
  // The search box is where people paste an IP address or a resource id, and
  // the person filter holds an email. The address bar is a different
  // transport with different retention from the audit table it is mirroring:
  // browser history, the Referer header on any outbound click, whatever syncs
  // tabs between devices. None of that is where an audit query belongs, and
  // "I can link you to the suspicious login" is not worth it.
  //
  // sessionStorage survives the refresh, dies with the tab, and travels in
  // no link — which is the whole requirement here and nothing more.
  const [query, setQuery] = useSessionState('posty.audit.q', '');
  const [actor, setActor] = useSessionState('posty.audit.actor', 'all');
  const [action, setAction] = useSessionState('posty.audit.action', 'all');

  const shows = (key) => visible.includes(key);

  function toggleColumn(key) {
    const next = visible.includes(key)
      ? visible.filter((k) => k !== key)
      : [...visible, key];
    setVisible(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // Filter options come from the rows themselves — a hardcoded list of
  // actions goes stale the moment a new one is recorded.
  const actors = useMemo(
    () => [...new Set(logs.map((l) => l.userEmail).filter(Boolean))].sort(),
    [logs],
  );
  const actions = useMemo(
    () => [...new Set(logs.map((l) => l.action).filter(Boolean))].sort(),
    [logs],
  );

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (actor !== 'all' && log.userEmail !== actor) return false;
      if (action !== 'all' && log.action !== action) return false;
      if (!term) return true;
      // Search everything on the row, so a resource id or an IP pasted in
      // from somewhere else finds its row.
      const haystack = [
        log.userEmail, log.action, log.resource, log.resourceId,
        log.ip, log.userAgent, describeMetadata(log.metadata),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [logs, query, actor, action]);

  const filtered = rows.length !== logs.length;

  return (
    <>
      <div className="al-tools">
        <label className="al-search">
          <Search size={14} aria-hidden="true" />
          <span className="visually-hidden">Search the activity log</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search everything"
          />
        </label>

        <label className="al-filter">
          <span className="visually-hidden">Filter by person</span>
          <select value={actor} onChange={(event) => setActor(event.target.value)}>
            <option value="all">Anyone</option>
            {actors.map((email) => <option key={email} value={email}>{email}</option>)}
          </select>
        </label>

        <label className="al-filter">
          <span className="visually-hidden">Filter by action</span>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="all">Any action</option>
            {actions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>

        <span className="al-count" role="status">
          {filtered ? `${rows.length} of ${logs.length}` : `${logs.length} events`}
        </span>

        {(filtered || query) && (
          <button
            type="button"
            className="sm-btn"
            onClick={() => { setQuery(''); setActor('all'); setAction('all'); }}
          >
            <X size={13} aria-hidden="true" /> Clear
          </button>
        )}

        <div className="al-chooser">
          <button
            type="button"
            className="sm-btn"
            aria-expanded={chooserOpen}
            onClick={() => setChooserOpen((open) => !open)}
          >
            <Columns3 size={14} aria-hidden="true" /> Columns
          </button>
          {chooserOpen && (
            <div className="al-chooser-panel" role="dialog" aria-label="Choose columns">
              {COLUMNS.map((column) => (
                <label key={column.key} className="al-chooser-row">
                  <input
                    type="checkbox"
                    checked={column.always || shows(column.key)}
                    disabled={column.always}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                  {column.always && <span className="al-chooser-fixed">always</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {onRefresh && (
          <button type="button" className="sm-btn" onClick={onRefresh}>Refresh</button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          {logs.length === 0
            ? 'No activity yet.'
            : 'No event matches these filters.'}
        </p>
      ) : (
        <div className="al-frame" tabIndex={0} role="region" aria-label="Activity log, scrollable">
          <table className="sm-table sm-audit">
            <thead>
              <tr>
                {COLUMNS.filter((c) => c.always || shows(c.key)).map((c) => (
                  <th key={c.key} className={`al-col-${c.key}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => {
                const ua = parseUserAgent(log.userAgent);
                const details = describeMetadata(log.metadata);
                return (
                  <tr key={log.id} className="sm-row">
                    <td className="sm-dim sm-when" title={new Date(log.createdAt).toString()}>
                      {formatTime(log.createdAt)}
                    </td>
                    <td className="sm-trunc" title={log.userEmail || undefined}>
                      {log.userEmail || 'system'}
                    </td>
                    <td><span className="sm-audit-action">{log.action}</span></td>
                    {shows('target') && (
                      <td className="sm-dim sm-trunc" title={log.resourceId || undefined}>
                        {log.resource || '-'}
                        {log.resourceId && (
                          <span className="sm-audit-id">{log.resourceId.slice(0, 8)}</span>
                        )}
                      </td>
                    )}
                    {shows('details') && (
                      <td className="sm-dim sm-trunc" title={details || undefined}>
                        {details || '-'}
                      </td>
                    )}
                    {shows('browser') && (
                      <td className="sm-dim sm-trunc" title={log.userAgent || undefined}>
                        {ua.label || '-'}
                      </td>
                    )}
                    {shows('device') && (
                      <td className="sm-dim">{ua.device || '-'}</td>
                    )}
                    {shows('ip') && <td className="sm-dim">{log.ip || '-'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
