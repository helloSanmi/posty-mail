import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Copy, FileText, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  cloneCampaign,
  deleteCampaign,
  deleteDraft,
  getCampaigns,
  getDrafts,
  updateCampaign,
} from '../services/brevoApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditCampaignModal } from '../components/EditCampaignModal';
import { SkeletonCard } from '../components/Skeleton';

const PAGE_SIZE = 8;

// The status chips, in the order the design draws them. `key` is the real
// campaign.status the chip filters on; `label` is the design's vocabulary
// for it ("Sending", not "running"); `tone` drives the chip dot, the row
// pill and the row's left-edge state rule. One table here means a chip and
// the pill on the rows it filters can never disagree.
//
// `draft` is not in the mock — the mock's campaigns were all live — but it
// is a real status in this app (cloning a campaign produces one), so it
// gets a chip rather than being a bucket of rows no filter can reach.
const STATUS_FILTERS = [
  { key: 'all', label: 'All', tone: null },
  { key: 'running', label: 'Sending', tone: 'accent' },
  { key: 'scheduled', label: 'Scheduled', tone: 'pending' },
  { key: 'completed', label: 'Completed', tone: 'success' },
  { key: 'completed_with_errors', label: 'Errors', tone: 'warn' },
  { key: 'draft', label: 'Draft', tone: 'muted' },
];

const STATUS_META = Object.fromEntries(
  STATUS_FILTERS.filter((filter) => filter.key !== 'all').map((filter) => [filter.key, filter]),
);

export function CampaignsPage({ notify }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [campaignData, setCampaignData] = useState({ rows: [], total: 0, totalPages: 1 });
  // Every campaign in the account, not just the current page. The status
  // chips carry counts, and a count taken from the visible page would read
  // "3" for a status the server holds twelve of. The list endpoint has no
  // per-status aggregate and no status filter, so the server-wide list IS
  // the total — and it doubles as the row source while a chip is active,
  // since page 2 of "Errors" can hold rows that live on page 5 of "All".
  const [allCampaigns, setAllCampaigns] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [drafts, setDrafts] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  async function refresh({ silent = false, targetPage = page } = {}) {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const [list, draftList, everything] = await Promise.all([
        getCampaigns({ page: targetPage, pageSize: PAGE_SIZE }),
        getDrafts(),
        // No pagination params -> the flat, account-wide array.
        getCampaigns(),
      ]);
      setCampaignData(list);
      setDrafts(draftList);
      setAllCampaigns(Array.isArray(everything) ? everything : everything?.rows || []);
      // If a delete dropped us off the last page, snap back.
      if (list.rows.length === 0 && targetPage > 1 && list.totalPages > 0) {
        setPage(list.totalPages);
      }
    } catch (error) {
      if (!silent) setLoadError(error.response?.data?.error || 'Could not load campaigns');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh({ targetPage: page }); }, [page]);

  const totalCampaigns = campaignData.total;

  // Chip counts: `all` from the server's own count query, each status from
  // the account-wide list. Both are server truth, neither is page-local.
  const statusCounts = allCampaigns.reduce((counts, campaign) => {
    counts[campaign.status] = (counts[campaign.status] || 0) + 1;
    return counts;
  }, {});
  const filters = STATUS_FILTERS.map((filter) => ({
    ...filter,
    count: filter.key === 'all' ? totalCampaigns : statusCounts[filter.key] || 0,
  }));
  const activeFilter = filters.find((filter) => filter.key === statusFilter) || filters[0];

  // "All" is served page-by-page by the server; a status filter is paged
  // here, over the account-wide list, because the endpoint cannot filter.
  const isFiltered = statusFilter !== 'all';
  const matching = isFiltered
    ? allCampaigns.filter((campaign) => campaign.status === statusFilter)
    : campaignData.rows;
  const totalPages = isFiltered
    ? Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
    : campaignData.totalPages || 1;
  const currentPage = Math.min(page, totalPages);
  const campaigns = isFiltered
    ? matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : matching;

  // Poll while a campaign the user can SEE is in flight, so progress moves
  // live. The test has to run over `campaigns` — the rows actually on
  // screen — rather than over the server page: once a status chip is
  // active the rendered rows come from the account-wide list instead, and
  // testing the server page would leave the progress bar frozen whenever
  // the running campaign sits on a different page of it. That is reachable
  // in ordinary use, since ordering is createdAt desc and an older running
  // campaign is routinely off page one.
  useEffect(() => {
    const inFlight = campaigns.some(
      (campaign) => campaign.status === 'running' || campaign.status === 'scheduled',
    );
    if (!inFlight) return undefined;
    const interval = setInterval(() => refresh({ silent: true, targetPage: page }), 8000);
    return () => clearInterval(interval);
  }, [campaigns, page]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectFilter(key) {
    setStatusFilter(key);
    setPage(1);
  }

  async function handleSaveEdit(payload) {
    try {
      await updateCampaign(editing.id, payload);
      notify('Campaign updated');
      setEditing(null);
      refresh({ silent: true });
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update campaign', 'error');
    }
  }

  async function handleClone(id) {
    try {
      const cloned = await cloneCampaign(id);
      notify(`Cloned as "${cloned.name}"`);
      refresh();
    } catch (error) {
      notify(error.response?.data?.error || 'Clone failed', 'error');
    }
  }

  function handleDeleteCampaign(campaign) {
    setConfirm({
      title: `Delete "${campaign.name}"?`,
      message: 'Send history for this campaign will also be removed. This cannot be undone.',
      confirmVariant: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await deleteCampaign(campaign.id);
          notify('Campaign deleted');
          refresh();
        } catch (error) {
          notify(error.response?.data?.error || 'Delete failed', 'error');
        }
      },
    });
  }

  function handleDeleteDraft(id) {
    setConfirm({
      title: 'Delete this draft?',
      message: 'Drafts cannot be recovered after deletion.',
      confirmVariant: 'danger',
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await deleteDraft(id);
          notify('Draft deleted');
          refresh();
        } catch (error) {
          notify(error.response?.data?.error || 'Delete failed', 'error');
        }
      },
    });
  }

  return (
    <div className="page-stack content-page">
      {/* THE TAB STRIP IS GONE. "New campaign" was never a sibling view of
          "All campaigns" — it navigates to the builder, which has its own
          chrome and no way back — so it stops wearing a tab's clothes. The
          design gives it to the shell topbar, but the topbar takes no
          per-page action yet (AppShell owns that markup), so rather than
          drop the only route to the builder it sits in this card's head,
          which is the page's one remaining band of controls. */}
      <div className="cp-grid">
        <section className="cp-card">
          <div className="cp-card-head">
            <div className="cp-card-title">
              <h2>All campaigns</h2>
              <span className="cp-count">
                {activeFilter.count} total
                {totalPages > 1 && ` · page ${currentPage} of ${totalPages}`}
              </span>
            </div>
            <span className="cp-actions">
              {/* .cp-page-btn gives the sheet's button shape; button.primary
                  (base.css) out-specifies it on colour, so this stays the
                  page's one accented action. */}
              <button type="button" className="cp-page-btn primary" onClick={() => navigate('/builder')}>
                New campaign
              </button>
              <button
                type="button"
                className="cp-icon-btn"
                onClick={() => refresh()}
                aria-label="Refresh campaigns"
                title="Refresh"
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            </span>
          </div>

          {loadError ? (
            <p className="empty-state error" role="alert">
              {loadError} <button type="button" className="text-button" onClick={() => refresh()}>Retry</button>
            </p>
          ) : loading ? (
            <div className="cp-loading" role="status" aria-busy="true">
              <span className="cp-sr">Loading campaigns…</span>
              {[0, 1, 2].map((index) => <SkeletonCard key={index} />)}
            </div>
          ) : totalCampaigns === 0 ? (
            <p className="empty-state">No campaigns yet. Schedule one from the Send page.</p>
          ) : (
            <>
              {/* The filter doubles as the status summary — each chip carries
                  its own state colour and its count, so the distribution is
                  readable without clicking anything. A separate "3 campaigns
                  have errors" line would say the same thing in a sentence. */}
              <div className="cp-filters" role="group" aria-label="Filter by status">
                {filters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`cp-filter${statusFilter === filter.key ? ' is-active' : ''}`}
                    aria-pressed={statusFilter === filter.key}
                    onClick={() => selectFilter(filter.key)}
                  >
                    {filter.tone && (
                      <span className={`cp-filter-dot is-${filter.tone}`} aria-hidden="true" />
                    )}
                    {filter.label}
                    <span className="cp-filter-count">{filter.count}</span>
                  </button>
                ))}
              </div>

              {campaigns.length === 0 ? (
                <p className="cp-empty">
                  No {activeFilter.label.toLowerCase()} campaigns.
                  <button type="button" className="cp-link" onClick={() => selectFilter('all')}>
                    Show all
                  </button>
                </p>
              ) : (
                <table className="cp-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Schedule</th>
                      <th>Progress</th>
                      <th>Status</th>
                      <th><span className="cp-sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => {
                      const tone = statusTone(campaign.status);
                      const percent = progressPercent(campaign);
                      return (
                        <tr key={campaign.id} className={`cp-row is-${tone}`}>
                          <td className="cp-name">{campaign.name}</td>
                          <td className="cp-dim">{scheduleLine(campaign)}</td>
                          <td>
                            <span className="cp-progress">
                              <span className="cp-progress-text">{progressLine(campaign.progress)}</span>
                              {percent != null && (
                                <span className="cp-track" aria-hidden="true">
                                  <span className="cp-fill" style={{ width: `${percent}%` }} />
                                </span>
                              )}
                            </span>
                          </td>
                          <td><span className={`cp-pill is-${tone}`}>{labelStatus(campaign.status)}</span></td>
                          <td>
                            <span className="cp-actions">
                              {/* The card layout made the whole body the
                                  "open details" target. A table row has no
                                  body to click without swallowing the row's
                                  own controls, so the affordance becomes the
                                  first action — same chevron the drafts rail
                                  uses for "go". */}
                              <button
                                type="button"
                                className="cp-icon-btn"
                                onClick={() => navigate(`/campaigns/${campaign.id}`)}
                                aria-label={`View details for "${campaign.name}"`}
                                title="View details"
                              >
                                <ChevronRight size={14} aria-hidden="true" />
                              </button>
                              {/* A running campaign cannot be edited (the
                                  API rejects it), so the control is absent
                                  rather than present-and-disabled — a
                                  disabled button invites a click and
                                  explains nothing. */}
                              {campaign.status !== 'running' && (
                                <button
                                  type="button"
                                  className="cp-icon-btn"
                                  onClick={() => setEditing(campaign)}
                                  aria-label={`Edit "${campaign.name}"`}
                                  title="Edit"
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="cp-icon-btn"
                                onClick={() => handleClone(campaign.id)}
                                aria-label={`Clone "${campaign.name}"`}
                                title="Clone"
                              >
                                <Copy size={14} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="cp-icon-btn is-danger"
                                onClick={() => handleDeleteCampaign(campaign)}
                                aria-label={`Delete "${campaign.name}"`}
                                title="Delete"
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {totalPages > 1 && (
                <nav className="cp-pagination" aria-label="Campaign pagination">
                  <button
                    type="button"
                    className="cp-page-btn"
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Prev
                  </button>
                  <span className="cp-page-status">Page {currentPage} of {totalPages}</span>
                  <button
                    type="button"
                    className="cp-page-btn"
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage >= totalPages}
                    aria-label="Next page"
                  >
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>

        <aside className="cp-card cp-drafts">
          <div className="cp-card-head">
            <div className="cp-card-title">
              <h2><FileText size={15} aria-hidden="true" /> Drafts</h2>
              <span className="cp-count">{drafts.length}</span>
            </div>
          </div>
          {loading ? (
            <SkeletonCard />
          ) : drafts.length === 0 ? (
            <p className="empty-state compact">No drafts saved.</p>
          ) : (
            <ul className="cp-draft-list">
              {drafts.map((draft) => (
                <li key={draft.id} className="cp-draft">
                  {/* The whole row is the "Resume" affordance — clicking
                      anywhere in the title area opens the builder. Avoids
                      the old layout's heavy primary button competing with
                      the title for space (titles like "12-Weeks DevOps
                      Registration 1" wrapped to three lines). */}
                  <button
                    type="button"
                    className="cp-draft-resume"
                    onClick={() => navigate('/builder', { state: { draft } })}
                    aria-label={`Resume draft "${draft.name || 'Untitled draft'}"`}
                  >
                    <span className="cp-draft-text">
                      <span className="cp-draft-name">{draft.name || 'Untitled draft'}</span>
                      <span className="cp-dim">Updated {formatDate(draft.updatedAt)}</span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" className="cp-draft-chevron" />
                  </button>
                  <button
                    type="button"
                    className="cp-icon-btn is-danger cp-draft-delete"
                    onClick={() => handleDeleteDraft(draft.id)}
                    aria-label={`Delete draft "${draft.name || 'Untitled draft'}"`}
                    title="Delete draft"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {confirm && (
        <ConfirmDialog
          {...confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await confirm.onConfirm();
            setConfirm(null);
          }}
        />
      )}

      {editing && (
        <EditCampaignModal
          campaign={editing}
          onSave={handleSaveEdit}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function progressLine(progress) {
  if (!progress) return '-';
  const sent = progress.sent || 0;
  const failed = progress.failed || 0;
  const skipped = progress.skipped || 0;
  if (!sent && !failed && !skipped) return 'Not started';
  const parts = [`${sent} sent`];
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(' · ');
}

// The bar is only drawn for a send actually in flight, and only when the
// runner has told us how many batches there are — a track with nothing
// behind it is worse than no track.
function progressPercent(campaign) {
  if (campaign.status !== 'running') return null;
  const total = campaign.progress?.totalBatches || 0;
  if (!total) return null;
  const done = campaign.progress?.currentBatch || 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

// A running campaign's schedule slot is spent: what you want to know is
// when it started.
function scheduleLine(campaign) {
  if (campaign.status === 'running' && campaign.startedAt) {
    return `Started ${formatDate(campaign.startedAt)}`;
  }
  return formatDate(campaign.scheduledAt);
}

function labelStatus(status) {
  return STATUS_META[status]?.label || status;
}

function statusTone(status) {
  return STATUS_META[status]?.tone || 'muted';
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
