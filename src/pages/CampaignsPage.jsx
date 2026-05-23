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
import { CampaignTabs } from '../components/CampaignTabs';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditCampaignModal } from '../components/EditCampaignModal';
import { SkeletonCard } from '../components/Skeleton';

const PAGE_SIZE = 8;

export function CampaignsPage({ notify }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [campaignData, setCampaignData] = useState({ rows: [], total: 0, totalPages: 1 });
  const [drafts, setDrafts] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  async function refresh({ silent = false, targetPage = page } = {}) {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const [list, draftList] = await Promise.all([
        getCampaigns({ page: targetPage, pageSize: PAGE_SIZE }),
        getDrafts(),
      ]);
      setCampaignData(list);
      setDrafts(draftList);
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

  // Poll while a campaign is in flight so the user sees progress live.
  useEffect(() => {
    const inFlight = campaignData.rows.some(
      (campaign) => campaign.status === 'running' || campaign.status === 'scheduled',
    );
    if (!inFlight) return undefined;
    const interval = setInterval(() => refresh({ silent: true, targetPage: page }), 8000);
    return () => clearInterval(interval);
  }, [campaignData.rows, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const campaigns = campaignData.rows;
  const totalCampaigns = campaignData.total;
  const totalPages = campaignData.totalPages || 1;

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
      <CampaignTabs active="all" />
      <div className="campaigns-shell">
        <section className="surface campaigns-main">
          <div className="section-heading">
            <div>
              <h2>Campaigns</h2>
              <span className="muted">
                {totalCampaigns} total
                {totalPages > 1 && ` · page ${page} of ${totalPages}`}
              </span>
            </div>
            <button type="button" onClick={() => refresh()} aria-label="Refresh campaigns">
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>
          {loadError ? (
            <p className="empty-state error" role="alert">
              {loadError} <button type="button" className="text-button" onClick={() => refresh()}>Retry</button>
            </p>
          ) : loading ? (
            <div className="campaigns-grid">
              {[0, 1, 2].map((index) => <SkeletonCard key={index} />)}
            </div>
          ) : campaigns.length === 0 ? (
            <p className="empty-state">No campaigns yet. Schedule one from the Send page.</p>
          ) : (
            <>
              <div className="campaigns-grid">
                {campaigns.map((campaign) => (
                  <article key={campaign.id} className="campaign-card">
                    {/* Whole body is the "Details" affordance, same pattern
                        as the Drafts redesign — click anywhere on the title
                        / meta row to open the per-campaign metrics page.
                        Action buttons (Edit, Clone, Delete) sit OUTSIDE the
                        body button so the nesting stays valid. */}
                    <button
                      type="button"
                      className="campaign-card-body"
                      onClick={() => navigate(`/campaigns/${campaign.id}`)}
                      aria-label={`View details for "${campaign.name}"`}
                    >
                      <div className="campaign-card-head">
                        <strong>{campaign.name}</strong>
                        <span className={`pill ${statusPill(campaign.status)}`}>
                          {labelStatus(campaign.status)}
                        </span>
                      </div>
                      <div className="campaign-card-meta-inline">
                        {campaign.scheduledAt && (
                          <span>
                            <em>Scheduled</em>
                            {formatDate(campaign.scheduledAt)}
                          </span>
                        )}
                        <span>
                          <em>Progress</em>
                          {progressLine(campaign.progress)}
                        </span>
                      </div>
                    </button>
                    <div className="campaign-card-actions">
                      {campaign.status !== 'running' && (
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => setEditing(campaign)}
                          title="Edit campaign"
                          aria-label="Edit campaign"
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => handleClone(campaign.id)}
                        title="Clone campaign"
                        aria-label="Clone campaign"
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="row-action row-action-danger"
                        onClick={() => handleDeleteCampaign(campaign)}
                        title="Delete campaign"
                        aria-label="Delete campaign"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="pagination" aria-label="Campaign pagination">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> Prev
                  </button>
                  <span className="muted pagination-status">Page {page} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    aria-label="Next page"
                  >
                    Next <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>

        <aside className="surface campaigns-drafts">
          <div className="section-heading">
            <h2><FileText size={18} aria-hidden="true" /> Drafts</h2>
            <span className="muted">{drafts.length}</span>
          </div>
          {loading ? (
            <SkeletonCard />
          ) : drafts.length === 0 ? (
            <p className="empty-state compact">No drafts saved.</p>
          ) : (
            <ul className="draft-list">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  {/* The whole card is the "Resume" affordance — clicking
                      anywhere in the title area opens the builder. Avoids
                      the old layout's heavy primary button competing with
                      the title for space (titles like "12-Weeks DevOps
                      Registration 1" wrapped to three lines). */}
                  <button
                    type="button"
                    className="draft-resume"
                    onClick={() => navigate('/builder', { state: { draft } })}
                    aria-label={`Resume draft "${draft.name || 'Untitled draft'}"`}
                  >
                    <span className="draft-resume-text">
                      <strong>{draft.name || 'Untitled draft'}</strong>
                      <span className="muted">Updated {formatDate(draft.updatedAt)}</span>
                    </span>
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className="draft-resume-chevron"
                    />
                  </button>
                  <button
                    type="button"
                    className="draft-delete"
                    onClick={() => handleDeleteDraft(draft.id)}
                    aria-label={`Delete draft "${draft.name || 'Untitled draft'}"`}
                    title="Delete draft"
                  >
                    <Trash2 size={14} aria-hidden="true" />
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

function labelStatus(status) {
  if (status === 'completed_with_errors') return 'completed (errors)';
  return status;
}

function statusPill(status) {
  if (status === 'completed') return 'green';
  if (status === 'completed_with_errors' || status === 'running') return 'amber';
  if (status === 'scheduled') return 'blue';
  return 'muted';
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
