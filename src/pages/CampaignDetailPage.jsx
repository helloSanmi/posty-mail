import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import {
  getCampaignLinks,
  getCampaignMetrics,
  getCampaignRecipients,
  getCampaignVariants,
} from '../services/brevoApi';
import { SkeletonCard } from '../components/Skeleton';

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipients, setRecipients] = useState([]);
  const [links, setLinks] = useState({ totalClicks: 0, links: [] });
  const [variants, setVariants] = useState({ variants: [] });
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('recipients');

  async function refresh() {
    setLoading(true);
    setLoadError('');
    try {
      const [r, l, v, m] = await Promise.all([
        getCampaignRecipients(id),
        getCampaignLinks(id),
        getCampaignVariants(id),
        getCampaignMetrics(id),
      ]);
      setRecipients(r);
      setLinks(l);
      setVariants(v);
      setMetrics(m);
    } catch (error) {
      setLoadError(error.response?.data?.error || 'Could not load campaign details');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => recipients.reduce((acc, r) => ({
    sent: acc.sent + (r.status === 'sent' ? 1 : 0),
    opens: acc.opens + (r.opens ? 1 : 0),
    clicks: acc.clicks + (r.clicks ? 1 : 0),
    bounces: acc.bounces + (r.bounces ? 1 : 0),
  }), { sent: 0, opens: 0, clicks: 0, bounces: 0 }), [recipients]);

  return (
    <div className="page-stack content-page">
      <div className="back-row">
        <button type="button" onClick={() => navigate('/campaigns')}>
          <ArrowLeft size={14} aria-hidden="true" /> All campaigns
        </button>
        <h2 className="campaign-detail-title">{metrics?.campaign?.name || 'Campaign'}</h2>
        <button type="button" onClick={refresh} aria-label="Refresh">
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
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
          Recipients ({recipients.length})
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
          <RecipientsTable rows={recipients} />
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
          <span className="muted">{variant.subject || '—'}</span>
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
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
      .format(new Date(value));
  } catch {
    return value;
  }
}
