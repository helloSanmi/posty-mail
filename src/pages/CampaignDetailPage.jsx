import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import {
  getCampaignLinks,
  getCampaignMetrics,
  getCampaignRecipients,
  getCampaignVariants,
} from '../services/brevoApi';
import { SkeletonCard } from '../components/Skeleton';

// 50-per-page matches the other paginated list endpoints. Picked so a
// typical campaign of a few hundred recipients fits in 2-5 pages — few
// enough that paging through is realistic, big enough that you can scan.
const RECIPIENTS_PAGE_SIZE = 50;

// How often the detail page silently re-fetches while open, so opens /
// clicks / bounces tick up live as webhook events land — no manual
// Refresh needed. Polling pauses when the browser tab is hidden.
const POLL_INTERVAL_MS = 25000;

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Paginated recipients response: { rows, total, page, pageSize, totalPages }.
  // Default shape keeps the initial render from blowing up before the first
  // fetch lands.
  const [recipientsPage, setRecipientsPage] = useState({
    rows: [], total: 0, page: 1, totalPages: 1,
  });
  const [page, setPage] = useState(1);
  const [links, setLinks] = useState({ totalClicks: 0, links: [] });
  const [variants, setVariants] = useState({ variants: [] });
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('recipients');
  // Timestamp of the last successful (manual or auto) data fetch, shown
  // next to the live indicator so the user knows the page is current.
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  // Fetch the per-campaign things that don't depend on the recipients
  // page index: links, variants, aggregate metrics. Re-runs only when
  // the route id changes so paging doesn't refetch them.
  async function refreshSummary() {
    try {
      const [l, v, m] = await Promise.all([
        getCampaignLinks(id),
        getCampaignVariants(id),
        getCampaignMetrics(id),
      ]);
      setLinks(l);
      setVariants(v);
      setMetrics(m);
    } catch (error) {
      setLoadError(error.response?.data?.error || 'Could not load campaign details');
    }
  }

  // Fetch ONE page of recipients. Called on mount + every time the user
  // pages. Keeps the network cost of paging down to a single endpoint
  // instead of refetching links / variants / metrics every page click.
  async function refreshRecipients() {
    try {
      const r = await getCampaignRecipients(id, { page, pageSize: RECIPIENTS_PAGE_SIZE });
      setRecipientsPage(r);
    } catch (error) {
      setLoadError(error.response?.data?.error || 'Could not load recipients');
    }
  }

  // Manual refresh button — re-fetch everything from scratch.
  async function refresh() {
    setLoading(true);
    setLoadError('');
    await Promise.all([refreshSummary(), refreshRecipients()]);
    setLastUpdatedAt(new Date());
    setLoading(false);
  }

  // Silent background refresh used by the poll — same fetches, but
  // never toggles the loading skeleton so the table updates in place
  // without a flash.
  async function silentRefresh() {
    await Promise.all([refreshSummary(), refreshRecipients()]);
    setLastUpdatedAt(new Date());
  }

  // Reset to page 1 when the route id changes — guards against landing
  // on "page 7" of a campaign that only has 2 pages.
  useEffect(() => { setPage(1); }, [id]);

  // Summary refetch — links + variants + metrics. Only when id changes,
  // not on page changes (paging doesn't affect any of these).
  useEffect(() => {
    setLoading(true);
    setLoadError('');
    refreshSummary().finally(() => {
      setLastUpdatedAt(new Date());
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Recipients refetch — runs on mount AND on page change. Decoupled
  // from the summary effect so paging stays cheap (one endpoint, not
  // four). When switching campaigns, both this and the id-reset above
  // fire, costing one extra fetch with the stale page value before
  // setPage(1) lands; acceptable for an admin UI.
  useEffect(() => {
    refreshRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page]);

  // Live auto-refresh. Polls every POLL_INTERVAL_MS while the page is
  // open so engagement metrics update on their own as webhook events
  // arrive. Skips a tick when the tab is hidden (no point fetching for
  // an off-screen page) and fires an immediate catch-up refresh when
  // the tab regains focus. Re-armed on [id, page] so the closure always
  // sees the current campaign + page.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      silentRefresh();
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) silentRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, page]);

  // Aggregate counts come from /api/campaigns/:id/metrics (a separate
  // endpoint, fetched in the same Promise.all). Reading them here instead
  // of reducing the per-row recipients list means the KPI cards stay
  // accurate even when only one page worth of recipients is loaded.
  const totals = {
    sent: metrics?.sent ?? 0,
    opens: metrics?.uniqueOpens ?? 0,
    clicks: metrics?.uniqueClicks ?? 0,
    bounces: metrics?.bounces ?? 0,
  };

  return (
    <div className="page-stack content-page">
      <div className="back-row">
        <button type="button" onClick={() => navigate('/campaigns')}>
          <ArrowLeft size={14} aria-hidden="true" /> All campaigns
        </button>
        <h2 className="campaign-detail-title">{metrics?.campaign?.name || 'Campaign'}</h2>
        <div className="campaign-detail-actions">
          <span className="campaign-live" title="Metrics auto-refresh every 25 seconds">
            <span className="campaign-live-dot" aria-hidden="true" />
            Live
            {lastUpdatedAt && (
              <span className="campaign-live-time"> · updated {formatClock(lastUpdatedAt)}</span>
            )}
          </span>
          <button type="button" onClick={refresh} aria-label="Refresh">
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Sent" value={totals.sent} />
        <Kpi label="Unique opens" value={totals.opens} />
        <Kpi label="Unique clicks" value={totals.clicks} />
        <Kpi label="Bounces" value={totals.bounces} />
      </div>

      <div className="detail-tabs">
        <button
          type="button"
          className={tab === 'recipients' ? 'active' : ''}
          onClick={() => setTab('recipients')}
        >
          {/* Recipient tab count comes from the server-paginated total,
              not from the rows on the current page. */}
          Recipients ({recipientsPage.total})
        </button>
        <button
          type="button"
          className={tab === 'links' ? 'active' : ''}
          onClick={() => setTab('links')}
        >
          Links ({links.links.length})
        </button>
        {variants.variants.length > 0 && (
          <button
            type="button"
            className={tab === 'variants' ? 'active' : ''}
            onClick={() => setTab('variants')}
          >
            A/B variants
          </button>
        )}
      </div>

      <section className="surface">
        {loadError ? (
          <p className="empty-state error" role="alert">
            {loadError} <button type="button" className="text-button" onClick={refresh}>Retry</button>
          </p>
        ) : loading ? (
          <SkeletonCard />
        ) : tab === 'recipients' ? (
          <>
            <RecipientsTable rows={recipientsPage.rows} />
            {recipientsPage.totalPages > 1 && (
              <nav className="pagination" aria-label="Recipients pagination">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} aria-hidden="true" /> Prev
                </button>
                <span className="muted pagination-status">
                  Page {recipientsPage.page} of {recipientsPage.totalPages}
                  {' · '}
                  {recipientsPage.total} recipient{recipientsPage.total === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(recipientsPage.totalPages, p + 1))}
                  disabled={page >= recipientsPage.totalPages}
                  aria-label="Next page"
                >
                  Next <ChevronRight size={14} aria-hidden="true" />
                </button>
              </nav>
            )}
          </>
        ) : tab === 'links' ? (
          <LinksTable links={links} />
        ) : (
          <VariantsTable variants={variants.variants} />
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="kpi-card">
      <div>
        <span className="muted">{label}</span>
        <strong>{value.toLocaleString()}</strong>
      </div>
    </div>
  );
}

function RecipientsTable({ rows }) {
  if (!rows.length) {
    return <p className="empty-state">No recipient activity yet. Once Brevo posts events back, they&apos;ll appear here.</p>;
  }
  return (
    <div className="data-table" role="table">
      <div className="data-table-head" role="row">
        <span role="columnheader">Email</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Opens</span>
        <span role="columnheader">Clicks</span>
        <span role="columnheader">Bounces</span>
        <span role="columnheader">Last event</span>
      </div>
      {rows.map((row) => (
        <div className="data-table-row" key={row.email} role="row">
          <span>{row.email}</span>
          <span>
            <span className={`pill ${pillForStatus(row)}`}>{recipientLabel(row)}</span>
          </span>
          <span>{row.opens}</span>
          <span>{row.clicks}</span>
          <span>{row.bounces}</span>
          <span className="muted">{formatDate(row.lastEventAt)}</span>
        </div>
      ))}
    </div>
  );
}

function LinksTable({ links }) {
  if (!links.links.length) {
    return <p className="empty-state">No clicks tracked yet.</p>;
  }
  return (
    <div className="links-table">
      <p className="muted">Total clicks: {links.totalClicks}</p>
      <ul className="links-list">
        {links.links.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              {link.url} <ExternalLink size={12} aria-hidden="true" />
            </a>
            <strong>{link.clicks}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VariantsTable({ variants }) {
  return (
    <div className="data-table" role="table">
      <div className="data-table-head variants-head" role="row">
        <span role="columnheader">Variant</span>
        <span role="columnheader">Subject</span>
        <span role="columnheader">Weight</span>
        <span role="columnheader">Opens</span>
        <span role="columnheader">Clicks</span>
      </div>
      {variants.map((variant) => (
        <div className="data-table-row variants-row" key={variant.id} role="row">
          <span><strong>{variant.label || variant.id}</strong></span>
          <span className="muted">{variant.subject || '-'}</span>
          <span>{variant.weight}</span>
          <span>{variant.opens}</span>
          <span>{variant.clicks}</span>
        </div>
      ))}
    </div>
  );
}

function recipientLabel(row) {
  if (row.unsubscribed) return 'unsubscribed';
  if (row.bounces > 0) return 'bounced';
  if (row.clicks > 0) return 'clicked';
  if (row.opens > 0) return 'opened';
  return row.status;
}

function pillForStatus(row) {
  if (row.unsubscribed || row.bounces > 0) return 'amber';
  if (row.clicks > 0 || row.opens > 0) return 'green';
  if (row.status === 'sent') return '';
  if (row.status === 'failed') return 'amber';
  return 'muted';
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}

// Time-only clock for the "updated HH:MM:SS" live indicator.
function formatClock(value) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(value);
  } catch {
    return '';
  }
}
