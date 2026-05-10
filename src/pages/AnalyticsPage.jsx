import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

// Brevo event-name groups. Mirrors backend/routes/campaigns.js so the report
// totals always agree with the per-campaign metrics.
const OPEN_NAMES = new Set(['opened', 'open', 'unique_opened', 'proxy_open']);
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
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // Which KPI is currently expanded into the drill-down panel below the grid.
  const [drilledMetric, setDrilledMetric] = useState(null);

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      const [c, e] = await Promise.all([getCampaigns(), getEvents()]);
      setCampaigns(c);
      setEvents(e);
    } catch (error) {
      setLoadError(error.response?.data?.error || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const campaignsById = useMemo(() => {
    const map = new Map();
    campaigns.forEach((c) => map.set(c.id, c));
    return map;
  }, [campaigns]);

  // Real (non-bot) events only — totals + drill-down both honor the bot
  // filter so engagement numbers track real humans, not Gmail's link scanner.
  const realEvents = useMemo(
    () => events.filter((event) => !isBotEvent(event.payload)),
    [events],
  );

  const totals = useMemo(() => {
    let sent = 0;
    let failed = 0;
    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    let unsubscribes = 0;
    campaigns.forEach((campaign) => {
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
  }, [campaigns, realEvents]);

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
        ) : campaigns.length === 0 ? (
          <p className="empty-state">No campaigns yet. Send one to see metrics here.</p>
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
            {campaigns.map((campaign) => {
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
            No webhook events received. Configure your Brevo webhook in Settings to point at <code>/api/webhooks/brevo</code>.
          </p>
        ) : (
          <ul className="reports-events">
            {realEvents.slice(0, 12).map((event) => (
              <li key={event.id}>
                <span className={`pill ${eventPill(event.payload?.event)}`}>
                  {eventLabel(event.payload?.event || event.provider)}
                </span>
                <span className="reports-event-email">{event.payload?.email || '—'}</span>
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
                <span className="analytics-drill-email">{event.payload?.email || '—'}</span>
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
                    <span className="muted">—</span>
                  )}
                </span>
                <span className="muted analytics-drill-subject">
                  {event.payload?.subject || '—'}
                </span>
                {showLink && (
                  <span className="analytics-drill-link">
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer" title={link}>
                        <ExternalLink size={11} aria-hidden="true" />
                        {summariseLink(link)}
                      </a>
                    ) : <span className="muted">—</span>}
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
  return status || '—';
}

function pillFor(status) {
  if (status === 'completed') return 'green';
  if (status === 'completed_with_errors' || status === 'running') return 'amber';
  if (status === 'scheduled') return 'blue';
  return 'muted';
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}
