import {
  ChevronLeft, ChevronRight, Copy, FileText, Pencil, RefreshCw, Trash2,
} from 'lucide-react';
import './campaigns.css';

// Campaigns, redesigned.
//
// THE TAB STRIP IS GONE. Today the page opens with "All campaigns / New
// campaign" as a two-tab strip, but "New campaign" is not a sibling view —
// it navigates to the builder, a different page with different chrome and
// no way back to the tab it was on. It is a button wearing a tab's clothes.
// It becomes the topbar's primary action, matching Home, and with only one
// real view left there is no strip to draw.
//
// CARDS BECAME A TABLE. Twenty-eight campaigns rendered as a grid of cards
// means scanning by name costs a saccade per card and the eye never gets a
// column to run down. Campaign, schedule, progress and status are four
// aligned facts — that is a table. It also lets the status colour and the
// left-edge state rule do the work a pill-per-card was doing.
//
// ROW ACTIONS REVEAL. Edit, Clone and Delete on every row is thirty icon
// buttons on a page whose job is to let you read a list. They appear on
// hover and on keyboard focus, and stay permanently visible on touch, where
// there is no hover to reveal them with.

const CAMPAIGNS = [
  {
    name: 'September newsletter',
    schedule: '3 Sep, 09:00',
    progress: '4,120 sent',
    state: 'Completed',
    tone: 'success',
  },
  {
    name: 'Autumn offer — cohort B',
    schedule: 'Started 11:42',
    progress: '1,204 / 2,860',
    pct: 42,
    state: 'Sending',
    tone: 'accent',
    running: true,
  },
  {
    name: 'Welcome sequence',
    schedule: '14 Sep, 08:00',
    progress: '1,204 queued',
    state: 'Scheduled',
    tone: 'pending',
  },
  {
    name: 'Re-engagement',
    schedule: '28 Aug, 14:00',
    progress: '3,297 sent · 37 failed',
    state: 'Errors',
    tone: 'warn',
  },
  {
    name: 'August roundup',
    schedule: '1 Aug, 09:00',
    progress: '3,980 sent',
    state: 'Completed',
    tone: 'success',
  },
  {
    name: 'Pricing update',
    schedule: '22 Jul, 16:30',
    progress: '2,740 sent',
    state: 'Completed',
    tone: 'success',
  },
];

const DRAFTS = [
  { name: 'Product update', updated: '2d ago' },
  { name: '12-Weeks DevOps Registration 1', updated: '5d ago' },
  { name: 'Untitled draft', updated: '3 Sep' },
];

export function Campaigns() {
  return (
    <div className="cp-grid">
      <section className="cp-card">
        <div className="cp-card-head">
          <div className="cp-card-title">
            <h2>All campaigns</h2>
            <span className="cp-count">28 total</span>
          </div>
          <button type="button" className="cp-icon-btn" aria-label="Refresh campaigns" title="Refresh">
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>

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
            {CAMPAIGNS.map((c) => (
              <tr key={c.name} className={`cp-row is-${c.tone}`}>
                <td className="cp-name">{c.name}</td>
                <td className="cp-dim">{c.schedule}</td>
                <td>
                  <span className="cp-progress">
                    <span className="cp-progress-text">{c.progress}</span>
                    {c.pct != null && (
                      <span className="cp-track" aria-hidden="true">
                        <span className="cp-fill" style={{ width: `${c.pct}%` }} />
                      </span>
                    )}
                  </span>
                </td>
                <td><span className={`cp-pill is-${c.tone}`}>{c.state}</span></td>
                <td>
                  <span className="cp-actions">
                    {/* A running campaign cannot be edited, so the control
                        is absent rather than present-and-disabled — a
                        disabled button invites a click and explains
                        nothing. */}
                    {!c.running && (
                      <button type="button" className="cp-icon-btn" aria-label={`Edit ${c.name}`} title="Edit">
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    )}
                    <button type="button" className="cp-icon-btn" aria-label={`Clone ${c.name}`} title="Clone">
                      <Copy size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="cp-icon-btn is-danger"
                      aria-label={`Delete ${c.name}`}
                      title="Delete"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <nav className="cp-pagination" aria-label="Campaign pagination">
          <button type="button" className="cp-page-btn" disabled aria-label="Previous page">
            <ChevronLeft size={14} aria-hidden="true" /> Prev
          </button>
          <span className="cp-page-status">Page 1 of 5</span>
          <button type="button" className="cp-page-btn" aria-label="Next page">
            Next <ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
      </section>

      <aside className="cp-card cp-drafts">
        <div className="cp-card-head">
          <div className="cp-card-title">
            <h2><FileText size={15} aria-hidden="true" /> Drafts</h2>
            <span className="cp-count">3</span>
          </div>
        </div>
        <ul className="cp-draft-list">
          {DRAFTS.map((d) => (
            <li key={d.name} className="cp-draft">
              <button type="button" className="cp-draft-resume">
                <span className="cp-draft-text">
                  <span className="cp-draft-name">{d.name}</span>
                  <span className="cp-dim">Updated {d.updated}</span>
                </span>
                <ChevronRight size={14} aria-hidden="true" className="cp-draft-chevron" />
              </button>
              <button
                type="button"
                className="cp-icon-btn is-danger cp-draft-delete"
                aria-label={`Delete draft ${d.name}`}
                title="Delete draft"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
