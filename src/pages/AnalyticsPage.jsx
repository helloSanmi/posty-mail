import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, RefreshCw, X } from 'lucide-react';
import { getCampaigns, getEvents } from '../services/brevoApi';
import { SkeletonCard } from '../components/Skeleton';
import { ActivityChart } from '../components/analytics/ActivityChart';
import { TopLinks } from '../components/analytics/TopLinks';
import { eventLabel, isBotEvent } from '../utils/brevoEvents';

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

// Compute the "previous period" window of the same length as `range` so
// KPI cards can show a vs-previous delta. Returns null for "all time"
// (there's nothing meaningful before "everything"). The current
// window's `until` is treated as `now` when null, so a rolling "Last 7
// days" compares against the 7 days before that.
function resolvePreviousRange(range) {
  if (!range.since) return null;
  const endOfCurrent = range.until || new Date();
  const startOfCurrent = range.since;
  const lengthMs = endOfCurrent.getTime() - startOfCurrent.getTime();
  if (lengthMs <= 0) return null;
  return {
    since: new Date(startOfCurrent.getTime() - lengthMs),
    until: startOfCurrent,
  };
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

// `tone` is the product-wide identity for each metric: opens accent, clicks
// success, bounces danger, unsubscribes warn — the same four colours these
// carry on Home and in the campaign table, so they are learned once. The
// summary column, its drill panel's top edge and the event pills inside it
// all read from this one map.
const METRIC_DEFINITIONS = {
  opens: { label: 'Opens', tone: 'accent', empty: 'No opens yet.', match: (e) => OPEN_NAMES.has(e) },
  clicks: { label: 'Clicks', tone: 'success', empty: 'No clicks yet.', match: (e) => CLICK_NAMES.has(e) },
  bounces: { label: 'Bounces', tone: 'danger', empty: 'No bounces yet.', match: (e) => BOUNCE_NAMES.has(e) },
  unsubscribes: {
    // "Unsubscribed" (the event verb) rather than "Unsubscribes", so the
    // band column and the panel it opens read as the same thing.
    label: 'Unsubscribed',
    tone: 'warn',
    empty: 'No unsubscribe events from Brevo yet.',
    match: (e) => e === 'unsubscribed',
  },
  // "All events" is the drill target behind the drop-off strip's link. It
  // carries what the standalone "Recent activity" surface used to show —
  // the drill panel already rendered the same events with more fields and a
  // hundred-row cap, so the log was a strictly poorer duplicate. No tone:
  // it is not one metric's identity, so the panel keeps the neutral edge.
  all: {
    label: 'All events',
    tone: null,
    empty: (
      <>
        No webhook events received. Configure your Brevo webhook in
        Settings to point at <code>/api/webhooks/brevo</code>.
      </>
    ),
    match: () => true,
  },
};

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  // Events from the period preceding the selected window. Used to compute
  // a vs-previous delta on each KPI card. Empty array for "all time".
  const [prevEvents, setPrevEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Which KPI is currently expanded into the drill-down panel below the grid.
  const [drilledMetric, setDrilledMetric] = useState(null);
  // Selected time window. URL-backed so a refresh / share preserves the view.
  const rangeId = RANGES.some((r) => r.id === searchParams.get('range'))
    ? searchParams.get('range')
    : DEFAULT_RANGE;
  const range = useMemo(() => resolveRange(rangeId), [rangeId]);
  const prevRange = useMemo(() => resolvePreviousRange(range), [range]);

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      const [c, e, pe] = await Promise.all([
        getCampaigns(),
        // Server-side date filter so a "Last 7 days" view doesn't get
        // truncated by the 500-event default cap. Returns up to 5000 when
        // filtered — enough for typical low-to-mid volume installs.
        getEvents({
          since: range.since || undefined,
          until: range.until || undefined,
        }),
        // Previous period of equal length, so KPI cards can show a delta.
        // Skip entirely on "All time" (prevRange is null) — no events fetched.
        prevRange
          ? getEvents({ since: prevRange.since, until: prevRange.until })
          : Promise.resolve([]),
      ]);
      setCampaigns(c);
      setEvents(e);
      setPrevEvents(pe);
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

  // Webhook liveness for the control row. Reads the raw (pre bot-filter)
  // feed: the question this line answers is "is anything arriving at all",
  // and a scanner's click still proves the webhook fired.
  const lastEventAt = useMemo(() => {
    let latest = null;
    events.forEach((event) => {
      if (!event.receivedAt) return;
      const at = new Date(event.receivedAt).getTime();
      if (Number.isNaN(at)) return;
      if (latest == null || at > latest) latest = at;
    });
    return latest;
  }, [events]);

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

  // Same shape as `totals`, but for the previous-period window.
  // `prevSent` reads from campaigns whose scheduledAt fell in the prev
  // window — mirrors how the current `sent` total is computed so deltas
  // compare like-for-like.
  const prevTotals = useMemo(() => {
    if (!prevRange) return null;
    let sent = 0;
    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    let unsubscribes = 0;
    campaigns.forEach((campaign) => {
      if (withinRange(campaign.scheduledAt || campaign.createdAt, prevRange.since, prevRange.until)) {
        sent += campaign.progress?.sent || 0;
      }
    });
    prevEvents
      .filter((event) => !isBotEvent(event.payload))
      .forEach((event) => {
        const name = String(event.payload?.event || '').toLowerCase();
        if (OPEN_NAMES.has(name)) opens += 1;
        if (CLICK_NAMES.has(name)) clicks += 1;
        if (BOUNCE_NAMES.has(name)) bounces += 1;
        if (name === 'unsubscribed') unsubscribes += 1;
      });
    return { sent, opens, clicks, bounces, unsubscribes };
  }, [campaigns, prevEvents, prevRange]);

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

  // The only two numbers the engagement funnel had that the band above did
  // not already show. Everything else it drew was a byte-for-byte repeat.
  const sentToOpened = ratePercent(totals.opens, totals.sent);
  const openedToClicked = ratePercent(totals.clicks, totals.opens);

  return (
    <div className="page-stack content-page reports-page">
      {/* One control row. The range used to own a full-width sectioning
          landmark plus a "Showing" label, pushing the numbers it scopes
          about 64px down the page. Scope and figures are now one object.
          Still URL-backed (?range=30d) so refresh / share works. */}
      <div className="rp-controls">
        {/* A select, not a six-button strip. Six ranges whose labels run
            from "Today" to "Last 90 days" gave six chips of six different
            widths, so the control row never lined up and the strip ate the
            width the figures need. A dropdown states the current range in
            one place and is the same size whichever one is chosen. */}
        <label className="rp-range-select">
          <span className="visually-hidden">Time range</span>
          <select value={rangeId} onChange={(event) => setRange(event.target.value)}>
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
        <span className="rp-spacer" />
        {/* Replaces a whole surface whose only unique content was "is the
            webhook firing". One line answers it on every range. */}
        <span className="rp-health">
          {lastEventAt != null && <span className="rp-health-dot" aria-hidden="true" />}
          {lastEventAt != null
            ? `Last event ${relativeTime(lastEventAt)} ago`
            : 'No events in this window'}
        </span>
        <button type="button" className="rp-icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      {/* One unified summary band instead of five disconnected cards. Each
          metric is a column carrying its product-wide identity colour; the
          engagement columns are the controls that open the drill-down. */}
      <section className="rp-band">
        <div className="rp-metrics">
          <SummaryStat
            label="Sent"
            value={totals.sent}
            delta={deltaPercent(totals.sent, prevTotals?.sent)}
          />
          <SummaryStat
            label="Opens"
            tone={METRIC_DEFINITIONS.opens.tone}
            value={totals.opens}
            rate={ratePercent(totals.opens, totals.sent)}
            delta={deltaPercent(totals.opens, prevTotals?.opens)}
            onClick={() => toggleDrill('opens')}
            active={drilledMetric === 'opens'}
          />
          <SummaryStat
            label="Clicks"
            tone={METRIC_DEFINITIONS.clicks.tone}
            value={totals.clicks}
            rate={ratePercent(totals.clicks, totals.sent)}
            delta={deltaPercent(totals.clicks, prevTotals?.clicks)}
            onClick={() => toggleDrill('clicks')}
            active={drilledMetric === 'clicks'}
          />
          <SummaryStat
            label="Bounces"
            tone={METRIC_DEFINITIONS.bounces.tone}
            value={totals.bounces}
            rate={ratePercent(totals.bounces, totals.sent)}
            delta={deltaPercent(totals.bounces, prevTotals?.bounces)}
            onClick={() => toggleDrill('bounces')}
            active={drilledMetric === 'bounces'}
          />
          <SummaryStat
            label="Unsubscribed"
            tone={METRIC_DEFINITIONS.unsubscribes.tone}
            value={totals.unsubscribes}
            rate={ratePercent(totals.unsubscribes, totals.sent)}
            delta={deltaPercent(totals.unsubscribes, prevTotals?.unsubscribes)}
            onClick={() => toggleDrill('unsubscribes')}
            active={drilledMetric === 'unsubscribes'}
          />
        </div>
        {/* All that survived the funnel: the only two numbers it had that
            the band above did not already show. */}
        <div className="rp-dropoff">
          <span>
            Sent <ArrowRight size={12} aria-hidden="true" /> Opened
            {' '}<b>{sentToOpened != null ? `${sentToOpened}%` : '—'}</b>
          </span>
          <span>
            Opened <ArrowRight size={12} aria-hidden="true" /> Clicked
            {' '}<b>{openedToClicked != null ? `${openedToClicked}%` : '—'}</b>
          </span>
          <span className="rp-spacer" />
          <button
            type="button"
            className={`rp-alllink${drilledMetric === 'all' ? ' is-active' : ''}`}
            aria-pressed={drilledMetric === 'all'}
            onClick={() => toggleDrill('all')}
          >
            All events
          </button>
        </div>
      </section>

      {drilledMetric && (
        <DrillDown
          metric={drilledMetric}
          events={drillEvents}
          campaignsById={campaignsById}
          loading={loading}
          onClose={() => setDrilledMetric(null)}
          onCampaignClick={(id) => navigate(`/campaigns/${id}`)}
        />
      )}

      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Campaign performance</h2>
          <span className="rp-count">
            {rangedCampaigns.length === 1 ? '1 campaign' : `${rangedCampaigns.length} campaigns`}
          </span>
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
          <table className="rp-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="rp-num">Sent</th>
                <th className="rp-num">Opened</th>
                <th className="rp-num">Clicked</th>
                <th className="rp-num">Bounced</th>
              </tr>
            </thead>
            <tbody>
              {rangedCampaigns.map((campaign) => {
                const stats = perCampaignStats(realEvents, campaign.id);
                const sent = campaign.progress?.sent || 0;
                const state = stateFor(campaign.status);
                const open = () => navigate(`/campaigns/${campaign.id}`);
                return (
                  <tr
                    key={campaign.id}
                    className="rp-row is-interactive"
                    tabIndex={0}
                    aria-label={`${campaign.name} — open campaign`}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      open();
                    }}
                  >
                    <td>
                      <span className="rp-cname">
                        {/* Status was a 110px column where almost every row
                            said "completed". It is now a dot, present only
                            when the row needs attention — the full status
                            still reaches screen readers on every row. */}
                        {state && <span className={`rp-state is-${state}`} aria-hidden="true" />}
                        <span className="rp-trunc">{campaign.name}</span>
                      </span>
                      <span className="rp-dim rp-when" title={formatDate(campaign.createdAt)}>
                        {shortDate(campaign.createdAt)}
                      </span>
                      <span className="visually-hidden">Status: {labelFor(campaign.status)}</span>
                    </td>
                    <td className="rp-num">
                      <span className="rp-figure">{sent.toLocaleString()}</span>
                    </td>
                    <RateCell count={stats.opens} sent={sent} tone="accent" />
                    <RateCell count={stats.clicks} sent={sent} tone="success" />
                    <RateCell count={stats.bounces} sent={sent} tone="danger" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Activity over time — daily opens + clicks across the selected
          window. Hidden behind a skeleton while loading so users don't see
          a flicker of empty chart while the request lands. */}
      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Activity</h2>
          <span className="rp-count">
            {realEvents.length === 0 ? 'No events yet' : `${realEvents.length} events`}
          </span>
        </div>
        {loading ? (
          <SkeletonCard />
        ) : (
          <ActivityChart
            events={realEvents}
            since={range.since}
            until={range.until}
          />
        )}
      </section>

      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Top clicked links</h2>
        </div>
        {loading ? <SkeletonCard /> : <TopLinks events={realEvents} />}
      </section>
    </div>
  );
}

// Compute a percent rate as a string with one decimal, or null when there's
// no denominator. Caller decides how to render null (we show "—" in the UI).
function ratePercent(numerator, denominator) {
  if (!denominator) return null;
  return ((numerator / denominator) * 100).toFixed(1);
}

// Percentage change from `prev` to `current`. Returns null when there's
// nothing to compare against (no previous data, or both sides are 0).
// 0 → N is treated as "+100%" by convention — most reporting tools do
// the same so an audit reader's eye can find new spikes quickly.
function deltaPercent(current, prev) {
  if (prev == null) return null;
  if (current === prev) return 0;
  if (prev === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - prev) / prev) * 100);
}

// One column inside the unified summary band. The engagement columns are
// buttons; "Sent" is a plain div — no rule, no hue, marking it as a
// different KIND of number (a volume with no rate) and as the one column
// that is not a control.
//
// The delta chip is neutral on purpose: green used to fire both on rising
// opens and on falling bounces, so one colour carried two unrelated
// meanings — and painted the danger-identity metric green. Once each
// column is identity-coloured the reader already knows which direction is
// good, so the chip only has to carry the sign.
function SummaryStat({ label, tone, value, rate, delta, onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`rp-metric${tone ? ` is-${tone}` : ' is-plain'}${active ? ' is-drilled' : ''}`}
      aria-pressed={onClick ? Boolean(active) : undefined}
      onClick={onClick}
    >
      <span className="rp-metric-label">{label}</span>
      <strong className="rp-metric-value">{Number(value).toLocaleString()}</strong>
      <span className="rp-metric-foot">
        {rate != null && <span className="rp-metric-rate">{rate}%</span>}
        {typeof delta === 'number' && (
          <span className="rp-delta" title="vs previous period">
            {delta > 0 ? '+' : ''}{delta}%
            <span className="visually-hidden"> vs previous period</span>
          </span>
        )}
      </span>
    </Tag>
  );
}

// Cell for the campaign-performance table. The rate is the figure that
// matters, so it leads and carries the metric's identity colour; the raw
// count is support underneath (and drops out below 820px, where colour
// survives the breakpoint but column position does not).
function RateCell({ count, sent, tone }) {
  const rate = ratePercent(count, sent);
  return (
    <td className="rp-num">
      <span className={`rp-figure${tone ? ` is-${tone}` : ''}`}>
        {rate != null ? `${rate}%` : '—'}
      </span>
      <span className="rp-sub">{count.toLocaleString()}</span>
    </td>
  );
}

// Adjacent to the band on purpose: the tie between the pressed column and
// the panel it opened is the whole interaction. The top border takes the
// pressed metric's identity colour.
function DrillDown({ metric, events, campaignsById, loading, onClose, onCampaignClick }) {
  const def = METRIC_DEFINITIONS[metric];
  const showLink = metric === 'clicks';
  const visible = events.slice(0, 100);
  return (
    <section className={`rp-drill${def.tone ? ` is-${def.tone}` : ''}`} aria-label={`${def.label} detail`}>
      <div className="rp-card-head">
        <h2>{def.label}</h2>
        <span className="rp-spacer" />
        {/* The list is capped at 100 rows, so "shown" has to describe what
            is on screen — saying it about the unclamped total contradicts
            the "showing first 100" footer directly below. */}
        <span className="rp-count">
          {visible.length < events.length
            ? `${visible.length} of ${events.length}`
            : `${events.length} shown`}
        </span>
        <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close drill-down" title="Close">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {loading ? (
        <SkeletonCard />
      ) : events.length === 0 ? (
        <p className="empty-state compact">{def.empty}</p>
      ) : (
        <>
          <table className="rp-table rp-events">
            <thead>
              <tr>
                <th>Event</th>
                <th>Recipient</th>
                <th>Campaign</th>
                {showLink && <th>Link clicked</th>}
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => {
                const campaignId = eventCampaignId(event);
                const campaign = campaignsById.get(campaignId);
                const link = event.payload?.link;
                const name = event.payload?.event;
                return (
                  <tr key={event.id}>
                    <td>
                      <span className={`rp-pill is-${eventTone(name)}`}>
                        {eventLabel(name || event.provider)}
                      </span>
                    </td>
                    <td className="rp-trunc">{event.payload?.email || '-'}</td>
                    <td className="rp-trunc rp-dim">
                      {campaign ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => onCampaignClick(campaign.id)}
                        >
                          {campaign.name}
                        </button>
                      ) : '-'}
                    </td>
                    {showLink && (
                      <td className="rp-trunc">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link}
                            className="rp-link-url"
                          >
                            <span className="rp-trunc">{summariseLink(link)}</span>
                            <ExternalLink size={11} aria-hidden="true" />
                          </a>
                        ) : <span className="rp-dim">-</span>}
                      </td>
                    )}
                    <td className="rp-dim rp-when" title={formatDate(event.receivedAt)}>
                      {relativeTime(event.receivedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {events.length > visible.length && (
            <small className="rp-dim">Showing {visible.length} of {events.length}.</small>
          )}
        </>
      )}
    </section>
  );
}

function eventCampaignId(event) {
  const tags = event.payload?.tags || [];
  const tag = tags.find((t) => typeof t === 'string' && t.startsWith('campaign:'));
  return tag ? tag.replace('campaign:', '') : null;
}

// Four identities, not two. The pill map the page used to share with the
// rest of the app painted opens and clicks the same green, bounces and
// unsubscribes the same amber, and "Added to list" as a problem. Here a
// pill's hue says WHICH METRIC the row belongs to — the same colour its
// column wears in the band above — and anything outside those four is
// chrome-grey.
function eventTone(eventName) {
  const e = String(eventName || '').toLowerCase();
  if (OPEN_NAMES.has(e)) return 'accent';
  if (CLICK_NAMES.has(e)) return 'success';
  if (BOUNCE_NAMES.has(e)) return 'danger';
  if (e === 'unsubscribed' || e === 'complaint' || e === 'spam') return 'warn';
  return 'muted';
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

// The row-state dot only fires when a row needs attention: amber while a
// send is in flight, red when it finished with failures. Everything else —
// completed, draft, scheduled — carries no dot, which is what stops the
// column from being a wall of "completed".
function stateFor(status) {
  if (status === 'running' || status === 'sending') return 'running';
  if (status === 'completed_with_errors' || status === 'failed') return 'errors';
  return null;
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

// Compact date for the campaign rows ("3 Sep"). The full timestamp stays
// on the element's title so nothing is lost.
function shortDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}

// Age of an event as one short token ("12s", "4m", "1h", "3d"). The event
// table's When column is 64px wide; a full timestamp cannot live there, so
// it lives on the title attribute instead.
function relativeTime(value) {
  if (value == null || value === '') return '-';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '-';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
