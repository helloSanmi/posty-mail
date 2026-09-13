import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import {
  getCampaignLinks,
  getCampaignMetrics,
  getCampaignRecipients,
  getCampaignVariants,
} from '../services/brevoApi';
import { SkeletonCard } from '../components/Skeleton';
import { useViewState } from '../hooks/useViewState';

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
  // Tab and page in the URL: reading the Links breakdown and refreshing used
  // to dump you back on Recipients, and there was no way to send anyone "the
  // links for this campaign".
  //
  // The allowlist is deliberately withheld until the variants fetch lands.
  // Two traps here, and both produce a page that looks broken:
  //   * the panel below falls through to the variants table for ANY value
  //     that is not 'recipients' or 'links', so an unvalidated ?tab=typo
  //     draws a headers-only table with no tab lit;
  //   * but validating on the first frame is worse — variants arrive on
  //     their own fetch, so a legitimate ?tab=variants would be judged
  //     illegal and scrubbed on every single refresh.
  // So: no allowlist while loading, the real one once we know.
  const [links, setLinks] = useState({ totalClicks: 0, links: [] });
  const [variants, setVariants] = useState({ variants: [] });
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  // The tabs actually on screen right now — not the ones the page could
  // ever render. A/B variants only exists when the campaign has variants,
  // so ?tab=variants on a campaign without them must resolve to Recipients
  // rather than drawing an empty table under no highlighted tab.
  const TAB_IDS = variants.variants.length > 0
    ? ['recipients', 'links', 'variants']
    : ['recipients', 'links'];

  const [view, setView] = useViewState({
    tab: {
      fallback: 'recipients',
      allow: loading ? undefined : TAB_IDS,
    },
    page: { fallback: 1 },
  });
  const { page } = view;
  // Anything that survived an absent allowlist but is not a tab we render
  // still has to resolve to something drawable on this frame.
  const tab = TAB_IDS.includes(view.tab) ? view.tab : 'recipients';
  const setTab = (id) => setView({ tab: id });
  const setPage = (next) => setView({
    page: typeof next === 'function' ? next(page) : next,
  });
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

  // Reset to page 1 when the route id CHANGES — guards against carrying
  // "page 7" from one campaign to another that has two pages.
  //
  // The previous-id ref is load-bearing now that page lives in the URL. A
  // plain [id] effect also fires on mount, which would reset the page before
  // the first paint and quietly destroy a deep-linked ?page=4 — turning a
  // shared link into a lie every time it was opened.
  const previousId = useRef(id);
  useEffect(() => {
    if (previousId.current === id) return;
    previousId.current = id;
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      {/* The header band used to carry five identity signals at once: the
          topbar's "Campaigns", a back button, the campaign-name heading, a
          "Live · updated 14:32:07" badge and a labelled Refresh button. The
          badge is now just a dot and a time, Refresh is an icon with its
          label on aria-label/title, and the back link is quiet.
          The heading itself stays: unlike the design sandbox's shell, this
          app's topbar resolves /campaigns/:id to the plain title
          "Campaigns", and its .eyebrow is display:none above 900px — so
          dropping the h2 here would leave no visible campaign name at all. */}
      <div className="sm-detail-head">
        {/* navigate(-1) rather than navigate('/campaigns'), so "All
            campaigns" returns to the list EXACTLY as it was — the status
            chip you were triaging under and the page you were on, both of
            which now live in that URL. A hardcoded path would throw them
            away, which is the same complaint one gesture along: filter to
            Errors, open a campaign, come back, and you are staring at All
            again with the row you were working through somewhere on page 3.
            The fallback covers arriving here from a link, where there is no
            list entry in history to go back to. */}
        <button
          type="button"
          className="sm-back"
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate('/campaigns');
          }}
        >
          <ArrowLeft size={14} aria-hidden="true" /> All campaigns
        </button>
        <h2 className="sm-detail-title sm-trunc">{metrics?.campaign?.name || 'Campaign'}</h2>
        <span className="sm-spacer" />
        <span className="sm-live" title="Metrics auto-refresh every 25 seconds">
          <span className="sm-live-dot" aria-hidden="true" />
          {lastUpdatedAt ? `Updated ${formatClock(lastUpdatedAt)}` : 'Live'}
        </span>
        <button
          type="button"
          className="sm-icon-btn"
          onClick={refresh}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <section className="sm-kpis">
        <Kpi label="Sent" value={totals.sent} />
        <Kpi label="Unique opens" value={totals.opens} rate={rateOf(totals.opens, totals.sent)} tone="accent" />
        <Kpi label="Unique clicks" value={totals.clicks} rate={rateOf(totals.clicks, totals.sent)} tone="success" />
        <Kpi label="Bounces" value={totals.bounces} rate={rateOf(totals.bounces, totals.sent)} tone="danger" />
      </section>

      <section className="sm-card">
        {/* The tab strip used to float above the panel it controlled, as a
            separate inset object — two containers for one thing. It is now
            the card's own head, and it is the only place the row counts are
            printed. */}
        <div className="sm-card-head">
          <div className="sm-tabs" role="tablist" aria-label="Campaign detail">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recipients'}
              className={`sm-tab${tab === 'recipients' ? ' is-active' : ''}`}
              onClick={() => setTab('recipients')}
            >
              Recipients
              {/* Recipient tab count comes from the server-paginated total,
                  not from the rows on the current page. */}
              <span className="sm-tab-n">{recipientsPage.total.toLocaleString()}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'links'}
              className={`sm-tab${tab === 'links' ? ' is-active' : ''}`}
              onClick={() => setTab('links')}
            >
              Links
              <span className="sm-tab-n">{links.links.length.toLocaleString()}</span>
            </button>
            {variants.variants.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'variants'}
                className={`sm-tab${tab === 'variants' ? ' is-active' : ''}`}
                onClick={() => setTab('variants')}
              >
                A/B variants
                <span className="sm-tab-n">{variants.variants.length.toLocaleString()}</span>
              </button>
            )}
          </div>
        </div>

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
                {/* The recipient total is on the tab; this line says only
                    where in the set you are. */}
                <span className="muted pagination-status">
                  Page {recipientsPage.page} of {recipientsPage.totalPages}
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

function Kpi({
  label, value, rate, tone,
}) {
  return (
    <div className={`sm-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="sm-kpi-label">{label}</span>
      <strong className="sm-kpi-value">{value.toLocaleString()}</strong>
      {/* The rate slot holds a blank when there is nothing to divide by, so
          all four cards keep the same three-line height. */}
      <span className="sm-kpi-rate">{rate || ' '}</span>
    </div>
  );
}

function RecipientsTable({ rows }) {
  if (!rows.length) {
    return <p className="empty-state">No recipient activity yet. Once Brevo posts events back, they&apos;ll appear here.</p>;
  }
  return (
    <table className="sm-table">
      <thead>
        <tr>
          <th>Recipient</th>
          <th className="sm-num">Opens</th>
          <th className="sm-num">Clicks</th>
          <th>Status</th>
          <th>Last event</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          // One tone drives both the pill and the row's left rail, so a
          // bounced row is legible without a column of its own.
          const tone = toneForRecipient(row);
          return (
            <tr key={row.email} className={`sm-row is-${tone}`}>
              <td className="sm-trunc">{row.email}</td>
              <td className="sm-num">{row.opens}</td>
              <td className="sm-num">{row.clicks}</td>
              <td><span className={`sm-pill is-${tone}`}>{recipientLabel(row)}</span></td>
              <td className="sm-dim sm-when">{formatDate(row.lastEventAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LinksTable({ links }) {
  if (!links.links.length) {
    return <p className="empty-state">No clicks tracked yet.</p>;
  }
  return (
    <>
      {/* The aggregate the endpoint returns. It equals the sum of the
          visible Clicks column, but it is the number people quote, and
          fetching it only to never show it is worse than not fetching. */}
      <p className="sm-dim sm-total-clicks">Total clicks: {links.totalClicks}</p>
      <table className="sm-table">
        <thead>
          <tr>
            <th>Link</th>
            <th className="sm-num">Clicks</th>
          </tr>
        </thead>
        <tbody>
          {links.links.map((link) => (
            <tr key={link.url} className="sm-row">
              <td className="sm-trunc">
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.url} <ExternalLink size={12} aria-hidden="true" />
                </a>
              </td>
              <td className="sm-num">{link.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function VariantsTable({ variants }) {
  return (
    <table className="sm-table">
      <thead>
        <tr>
          <th>Variant</th>
          <th>Subject</th>
          <th className="sm-num">Weight</th>
          <th className="sm-num">Opens</th>
          <th className="sm-num">Clicks</th>
        </tr>
      </thead>
      <tbody>
        {variants.map((variant) => (
          <tr key={variant.id} className="sm-row">
            <td><strong>{variant.label || variant.id}</strong></td>
            <td className="sm-dim sm-trunc">{variant.subject || '-'}</td>
            <td className="sm-num">{variant.weight}</td>
            <td className="sm-num">{variant.opens}</td>
            <td className="sm-num">{variant.clicks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function recipientLabel(row) {
  if (row.unsubscribed) return 'unsubscribed';
  if (row.bounces > 0) return 'bounced';
  if (row.clicks > 0) return 'clicked';
  if (row.opens > 0) return 'opened';
  return row.status;
}

// Tone for a recipient row, in the screen sheet's vocabulary. Same
// precedence as recipientLabel above so the pill's colour always matches
// the word inside it.
function toneForRecipient(row) {
  if (row.unsubscribed) return 'warn';
  if (row.bounces > 0) return 'danger';
  if (row.clicks > 0) return 'success';
  if (row.opens > 0) return 'accent';
  if (row.status === 'failed') return 'danger';
  return 'muted';
}

// Share of sent, for the second line of a KPI card. Empty when there is
// nothing to divide by, so a campaign with no sends shows a blank rate
// rather than "NaN%".
function rateOf(value, sent) {
  if (!sent) return '';
  return `${((value / sent) * 100).toFixed(1)}%`;
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
