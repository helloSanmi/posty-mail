import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  MailCheck,
  MailOpen,
  MousePointer,
  ShieldOff,
  X,
} from 'lucide-react';
import { getCampaigns, getEvents } from '../services/brevoApi';
import { SkeletonCard } from '../components/Skeleton';
import { eventLabel, eventPill, isBotEvent } from '../utils/brevoEvents';

// Date-range presets for the Reports filter. Each one returns
// `{ since, until }` Date objects (or null for "everything").
// Used by both the UI dropdown and the request to /api/events.
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
];
const DEFAULT_RANGE = '7d';

function resolveRange(id) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (id) {
    case 'today':
      return { since: startOfToday, until: null };
    case 'yesterday': {
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      return { since: startOfYesterday, until: startOfToday };
    }
    case '7d': {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 7);
      return { since: start, until: null };
    }
    case '30d': {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 30);
      return { since: start, until: null };
    }
    case '90d': {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 90);
      return { since: start, until: null };
    }
    case 'all':
    default:
      return { since: null, until: null };
  }
}

// Filter a list of items by a date field. Used for the per-campaign table
// so a "Last 7 days" view only shows campaigns sent (or created) in that
// window. Items with no/unparseable date pass through (defensive — we'd
// rather show too much than silently drop a row).
function withinRange(value, since, until) {
  if (!since && !until) return true;
  if (!value) return true;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return true;
  if (since && t < since.getTime()) return false;
  if (until && t > until.getTime()) return false;
  return true;
}

// Brevo event-name groups. Mirrors backend/routes/campaigns.js so the report
// totals always agree with the per-campaign metrics.
const OPEN_NAMES = new Set(['opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy']);
const CLICK_NAMES = new Set(['click', 'clicked', 'unique_clicked']);
const BOUNCE_NAMES = new Set(['hard_bounce', 'soft_bounce', 'blocked', 'invalid_email']);

const METRIC_DEFINITIONS = {
  opens: { label: 'Opens', empty: 'No opens yet.', match: (e) => OPEN_NAMES.has(e) },
  clicks: { label: 'Clicks', empty: 'No clicks yet.', match: (e) => CLICK_NAMES.has(e) },
  bounces: { label: 'Bounces', empty: 'No bounces yet.', match: (e) => BOUNCE_NAMES.has(e) },
  unsubscribes: { label: 'Unsubscribes', empty: 'No unsubscribe events from Brevo yet.', match: (e) => e === 'unsubscribed' },
};

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Which KPI is currently expanded into the drill-down panel below the grid.
  const [drilledMetric, setDrilledMetric] = useState(null);
  // Selected time window. URL-backed so a refresh / share preserves the view.
  const rangeId = RANGES.some((r) => r.id === searchParams.get('range'))
    ? searchParams.get('range')
    : DEFAULT_RANGE;
  const range = useMemo(() => resolveRange(rangeId), [rangeId]);

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      const [c, e] = await Promise.all([
        getCampaigns(),
        // Server-side date filter so a "Last 7 days" view doesn't get
        // truncated by the 500-event default cap. Returns up to 5000 when
        // filtered — enough for typical low-to-mid volume installs.
        getEvents({
          since: range.since || undefined,
          until: range.until || undefined,
        }),
      ]);
      setCampaigns(c);
      setEvents(e);
    } catch (error) {
      setLoadError(error.response?.data?.error || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }

  // Refetch when the user changes the time window. URL-backed so deep links
  // ("/analytics?range=30d") show the right view on first load.
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [rangeId]);

  function setRange(id) {
    const next = new URLSearchParams(searchParams);
    if (id === DEFAULT_RANGE) next.delete('range');
    else next.set('range', id);
    setSearchParams(next, { replace: true });
  }

  const campaignsById = useMemo(() => {
    const map = new Map();
    campaigns.forEach((c) => map.set(c.id, c));
    return map;
  }, [campaigns]);

  // Campaigns sent within the selected window. Used to scope the "Sent" KPI
  // and the per-campaign table. Events are already filtered server-side by
  // `receivedAt`. The campaign date we filter on is `scheduledAt` (the
  // intended send time, present on every campaign) with `createdAt` as a
  // fallback for legacy rows that never had scheduledAt populated.
  const rangedCampaigns = useMemo(
    () => campaigns.filter((c) => withinRange(c.scheduledAt || c.createdAt, range.since, range.until)),
    [campaigns, range.since, range.until],
  );

  // Real (non-bot) events inside the selected window. Two filters layer:
  //   1. Date range — applied client-side as a safety net in addition to the
  //      server's `since/until` filter. Belt-and-suspenders against stale
  //      backends and to keep the UI honest the instant the user changes
  //      the range (no flicker waiting on the refetch).
  //   2. Bot filter — drops Gmail link-prefetch clicks etc. so engagement
  //      KPIs track real humans.
  const realEvents = useMemo(
    () => events
      .filter((event) => withinRange(event.receivedAt, range.since, range.until))
      .filter((event) => !isBotEvent(event.payload)),
    [events, range.since, range.until],
  );

  const totals = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    let unsubscribes = 0;
    rangedCampaigns.forEach((campaign) => {
      sent += campaign.progress?.sent || 0;
      failed += campaign.progress?.failed || 0;
    });
    realEvents.forEach((event) => {
      const name = String(event.payload?.event || '').toLowerCase();
      if (OPEN_NAMES.has(name)) opens += 1;
      if (CLICK_NAMES.has(name)) clicks += 1;
      if (BOUNCE_NAMES.has(name)) bounces += 1;
      if (name === 'unsubscribed') unsubscribes += 1;
    });
    return { sent, failed, opens, clicks, bounces, unsubscribes };
  }, [rangedCampaigns, realEvents]);

  const drillEvents = useMemo(() => {
    if (!drilledMetric) return [];
    const def = METRIC_DEFINITIONS[drilledMetric];
    return realEvents
      .filter((event) => def.match(String(event.payload?.event || '').toLowerCase()))
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  }, [realEvents, drilledMetric]);

  function toggleDrill(metric) {
    setDrilledMetric((current) => (current === metric ? null : metric));
  }

  return (
    <div className="page-stack content-page reports-page">
      {/* Time-range filter. URL-backed (?range=30d) so refresh / share works.
          The default is "Last 7 days" — most useful at a glance without
          getting too noisy. "All time" is the escape hatch. */}
      <section className="reports-range-bar">
        <span className="muted reports-range-label">Showing</span>
        <div className="reports-range-tabs" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={rangeId === r.id}
              className={`reports-range-tab${rangeId === r.id ? ' is-active' : ''}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>

      <section className="kpi-grid reports-kpi">
        <KpiCard
          icon={<MailCheck size={16} aria-hidden="true" />}
          label="Sent"
          value={totals.sent}
        />
        <KpiCard
          icon={<MailOpen size={16} aria-hidden="true" />}
          label="Opens"
          value={totals.opens}
          onClick={() => toggleDrill('opens')}
          active={drilledMetric === 'opens'}
        />
        <KpiCard
          icon={<MousePointer size={16} aria-hidden="true" />}
          label="Clicks"
          value={totals.clicks}
          onClick={() => toggleDrill('clicks')}
          active={drilledMetric === 'clicks'}
        />
        <KpiCard
          icon={<AlertTriangle size={16} aria-hidden="true" />}
          label="Bounces"
          value={totals.bounces}
          onClick={() => toggleDrill('bounces')}
          active={drilledMetric === 'bounces'}
        />
        <KpiCard
          icon={<ShieldOff size={16} aria-hidden="true" />}
          label="Unsubscribes"
          value={totals.unsubscribes}
          onClick={() => toggleDrill('unsubscribes')}
          active={drilledMetric === 'unsubscribes'}
        />
      </section>

      {drilledMetric && (
        <DrillDown
          metric={drilledMetric}
          events={drillEvents}
          campaignsById={campaignsById}
          onClose={() => setDrilledMetric(null)}
          onCampaignClick={(id) => navigate(`/campaigns/${id}`)}
        />
      )}

      <section className="surface">
        <div className="section-heading">
          <h2>Campaign performance</h2>
          <button type="button" onClick={refresh} aria-label="Refresh">
            <Activity size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        {loadError ? (
          <p className="empty-state error" role="alert">
            {loadError} <button type="button" className="text-button" onClick={refresh}>Retry</button>
          </p>
        ) : loading ? (
          <SkeletonCard />
        ) : rangedCampaigns.length === 0 ? (
          <p className="empty-state">
            {campaigns.length === 0
              ? 'No campaigns yet. Send one to see metrics here.'
              : `No campaigns in this window. Try a wider range like "All time".`}
          </p>
        ) : (
          <div className="reports-table">
            <div className="reports-table-head">
              <span>Campaign</span>
              <span>Status</span>
              <span>Sent</span>
              <span>Opens</span>
              <span>Clicks</span>
              <span>Bounces</span>
              <span aria-hidden="true" />
            </div>
            {rangedCampaigns.map((campaign) => {
              const stats = perCampaignStats(realEvents, campaign.id);
              return (
                <button
                  key={campaign.id}
                  type="button"
                  className="reports-table-row"
                  onClick={() => navigate(`/campaigns/${campaign.id}`)}
                >
                  <span className="reports-row-name">
                    <strong>{campaign.name}</strong>
                    <span className="muted">{formatDate(campaign.createdAt)}</span>
                  </span>
                  <span className={`pill ${pillFor(campaign.status)}`}>
                    {labelFor(campaign.status)}
                  </span>
                  <span>{campaign.progress?.sent || 0}</span>
                  <span>{stats.opens}</span>
                  <span>{stats.clicks}</span>
                  <span>{stats.bounces}</span>
                  <ChevronRight size={14} aria-hidden="true" className="muted" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <span className="muted">{realEvents.length === 0 ? 'No events yet' : `${realEvents.length} events`}</span>
        </div>
        {loading ? (
          <SkeletonCard />
        ) : realEvents.length === 0 ? (
          <p className="empty-state">
            No webhook events received. Configure your Brevo webhook in
            Settings to point at <code>/api/webhooks/brevo</code>.
          </p>
        ) : (
          <ul className="reports-events">
            {realEvents.slice(0, 12).map((event) => (
              <li key={event.id}>
                <span className={`pill ${eventPill(event.payload?.event)}`}>
                  {eventLabel(event.payload?.event || event.provider)}
                </span>
                <span className="reports-event-email">{event.payload?.email || '-'}</span>
                <span className="muted">{formatDate(event.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({ icon, label, value, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`kpi-card${onClick ? ' is-link' : ''}${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-pressed={onClick ? Boolean(active) : undefined}
    >
      <span className="kpi-icon" aria-hidden="true">{icon}</span>
      <div>
        <span className="muted">{label}</span>
        <strong>{Number(value).toLocaleString()}</strong>
      </div>
    </Tag>
  );
}

function DrillDown({ metric, events, campaignsById, onClose, onCampaignClick }) {
  const def = METRIC_DEFINITIONS[metric];
  const showLink = metric === 'clicks';
  const visible = events.slice(0, 100);
  return (
    <section className="surface analytics-drill">
      <div className="section-heading">
        <h2>
          {def.label} <span className="muted">{events.length}</span>
        </h2>
        <button type="button" onClick={onClose} aria-label="Close drill-down">
          <X size={14} aria-hidden="true" /> Close
        </button>
      </div>
      {events.length === 0 ? (
        <p className="empty-state compact">{def.empty}</p>
      ) : (
        <div className={`analytics-drill-table${showLink ? ' has-link' : ''}`}>
          <div className="analytics-drill-head">
            <span>Recipient</span>
            <span>Campaign</span>
            <span>Subject</span>
            {showLink && <span>Link clicked</span>}
            <span>When</span>
          </div>
          {visible.map((event) => {
            const campaignId = eventCampaignId(event);
            const campaign = campaignsById.get(campaignId);
            const link = event.payload?.link;
            return (
              <div key={event.id} className="analytics-drill-row">
                <span className="analytics-drill-email">{event.payload?.email || '-'}</span>
                <span>
                  {campaign ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onCampaignClick(campaign.id)}
                    >
                      {campaign.name}
                    </button>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </span>
                <span className="muted analytics-drill-subject">
                  {event.payload?.subject || '-'}
                </span>
                {showLink && (
                  <span className="analytics-drill-link">
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer" title={link}>
                        <ExternalLink size={11} aria-hidden="true" />
                        {summariseLink(link)}
                      </a>
                    ) : <span className="muted">-</span>}
                  </span>
                )}
                <span className="muted analytics-drill-time">{formatDate(event.receivedAt)}</span>
              </div>
            );
          })}
          {events.length > visible.length && (
            <small className="muted analytics-drill-more">
              Showing {visible.length} of {events.length}.
            </small>
          )}
        </div>
      )}
    </section>
  );
}

function eventCampaignId(event) {
  const tags = event.payload?.tags || [];
  const tag = tags.find((t) => typeof t === 'string' && t.startsWith('campaign:'));
  return tag ? tag.replace('campaign:', '') : null;
}

function summariseLink(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path.length > 24 ? `${path.slice(0, 24)}…` : path}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}

function perCampaignStats(events, campaignId) {
  const tag = `campaign:${campaignId}`;
  let opens = 0;
  let clicks = 0;
  let bounces = 0;
  events.forEach((event) => {
    const tags = event.payload?.tags || [];
    if (!tags.includes(tag)) return;
    const name = String(event.payload?.event || '').toLowerCase();
    if (OPEN_NAMES.has(name)) opens += 1;
    if (CLICK_NAMES.has(name)) clicks += 1;
    if (BOUNCE_NAMES.has(name)) bounces += 1;
  });
  return { opens, clicks, bounces };
}

function labelFor(status) {
  if (status === 'completed_with_errors') return 'errors';
  return status || '-';
}

function pillFor(status) {
  if (status === 'completed') return 'green';
  if (status === 'completed_with_errors' || status === 'running') return 'amber';
  if (status === 'scheduled') return 'blue';
  return 'muted';
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}
