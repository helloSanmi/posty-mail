import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Inbox,
  MailCheck,
  Send,
  ShieldOff,
  Users,
} from 'lucide-react';
import {
  getCampaigns,
  getEvents,
  getUnsubscribes,
} from '../services/brevoApi';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { SkeletonCard } from '../components/Skeleton';
import { eventLabel, eventPill, isBotEvent } from '../utils/brevoEvents';

// Home, on the redesigned `hm-` vocabulary.
//
// The old hero stacked a greeting eyebrow, an h2 and a subtitle under the
// topbar's own "Home" — four heading-weight strings in the first 200px, with
// no information between the first two. It's gone. The page now opens on the
// numbers:
//
//   - "N campaigns in flight" became the live strip, which renders ONLY while
//     a campaign is actually sending. Nothing in flight, no strip.
//   - The subtitle's facts moved into the tiles, where a number belongs: the
//     list size is the Contacts tile (with this month's additions under it),
//     and "last campaign 3 Sep" is the Campaigns tile's second line.
//   - The greeting survives as one quiet line next to the page's primary
//     action. The design moves that action into the topbar; the topbar isn't
//     this file's to edit, so the buttons keep their place here rather than
//     being dropped.
//
// `template` and `setPage` were threaded through the legacy first-run
// <Onboarding> component. Both are unused now that the onboarding lives in
// its own component and routes via useNavigate. Kept off the destructure so
// lint stays happy; if main.jsx still passes them, they're harmless.
export function DashboardPage({ contacts }) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [events, setEvents] = useState([]);
  const [unsubscribes, setUnsubscribes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCampaigns().catch(() => []),
      getEvents().catch(() => []),
      getUnsubscribes().catch(() => []),
    ]).then(([c, e, u]) => {
      if (cancelled) return;
      setCampaigns(c);
      setEvents(e);
      setUnsubscribes(u);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const totalSent = campaigns.reduce((acc, campaign) => acc + (campaign.progress?.sent || 0), 0);
  const inFlight = campaigns.filter((c) => c.status === 'running' || c.status === 'scheduled');
  const sending = campaigns.filter((c) => c.status === 'running');
  const lastCampaign = campaigns[0]; // backend sorts by createdAt desc
  const isFirstRun = !loading && contacts.length === 0 && campaigns.length === 0;

  if (isFirstRun) {
    // First-run dashboard. Just the onboarding card; nothing else to show
    // until the user has actual data to summarize.
    return (
      <div className="page-stack overview-page home-page">
        <OnboardingChecklist mode="full" contacts={contacts} campaigns={campaigns} />
      </div>
    );
  }
  const headline = heroHeadline(contacts.length, campaigns.length, inFlight.length);

  // The strip speaks for one campaign — the first one actually sending. The
  // count of everything in flight is already in the line above it.
  const liveCampaign = sending[0] || null;
  const livePct = liveCampaign ? progressPct(liveCampaign) : 0;

  // Tile second lines. Every one of these is derived from the same data the
  // page already had; none of them is decoration.
  const contactsThisMonth = contacts.filter((c) => isThisMonth(c.savedAt)).length;
  const sentThisMonth = campaigns
    .filter((c) => isThisMonth(c.createdAt))
    .reduce((acc, c) => acc + (c.progress?.sent || 0), 0);
  const scheduledCount = inFlight.length - sending.length;
  const campaignsMeta = (() => {
    if (sending.length) return `${sending.length} sending now`;
    if (scheduledCount) return `${scheduledCount} scheduled`;
    if (lastCampaign) return `Last campaign ${formatDate(lastCampaign.createdAt)}`;
    return 'None yet';
  })();
  const unsubscribeMeta = totalSent
    ? `${((unsubscribes.length / totalSent) * 100).toFixed(2)}% of sends`
    : 'No sends yet';

  const visibleEvents = events.filter((event) => !isBotEvent(event.payload));
  const botCount = events.filter((event) => isBotEvent(event.payload)).length;

  return (
    <div className="page-stack content-page dashboard-page">
      {/* Onboarding banner. Shows above the dashboard until every setup step
          is complete OR the user dismisses it. Lets people who jumped in
          via "Add audience" still see the "Configure sender" nudge. */}
      <OnboardingChecklist mode="banner" contacts={contacts} campaigns={campaigns} />

      {/* The greeting moved to the topbar, where it shows on every page.
          What stays is the one line only this page can say — what is in
          flight, or what to do first — and the actions. */}
      <div className="section-heading">
        <p className="status-line">{headline}</p>
        <div className="actions-row">
          <button type="button" className="hm-btn hm-btn-primary" onClick={() => navigate('/builder')}>
            <Send size={14} aria-hidden="true" /> New campaign
          </button>
          {contacts.length === 0 && (
            <button type="button" className="hm-btn" onClick={() => navigate('/contacts')}>
              <Users size={14} aria-hidden="true" /> Add audience
            </button>
          )}
        </div>
      </div>

      {/* Present only because something IS sending. Nothing in flight, no
          strip — the page starts at the numbers. */}
      {liveCampaign && (
        <section className="hm-live" aria-live="polite">
          <span className="hm-live-dot" aria-hidden="true" />
          <span className="hm-live-text">
            <strong>{liveCampaign.name}</strong>
            <span className="hm-live-meta">{progressSummary(liveCampaign)}</span>
          </span>
          <span className="hm-live-track" aria-hidden="true">
            <span className="hm-live-fill" style={{ width: `${livePct}%` }} />
          </span>
          <span className="hm-live-pct">{livePct}%</span>
          <button
            type="button"
            className="hm-link"
            onClick={() => navigate(`/campaigns/${liveCampaign.id}`)}
          >
            View <ArrowRight size={13} aria-hidden="true" />
          </button>
        </section>
      )}

      <section className="hm-tiles">
        <Tile
          icon={<Users size={14} aria-hidden="true" />}
          label="Contacts"
          value={contacts.length}
          meta={`+${contactsThisMonth.toLocaleString()} this month`}
          tone="accent"
          onClick={() => navigate('/contacts')}
        />
        <Tile
          icon={<Inbox size={14} aria-hidden="true" />}
          label="Campaigns"
          value={campaigns.length}
          meta={campaignsMeta}
          tone="warn"
          onClick={() => navigate('/campaigns')}
        />
        <Tile
          icon={<MailCheck size={14} aria-hidden="true" />}
          label="Emails sent"
          value={totalSent}
          meta={`${sentThisMonth.toLocaleString()} this month`}
          tone="success"
        />
        <Tile
          icon={<ShieldOff size={14} aria-hidden="true" />}
          label="Unsubscribed"
          value={unsubscribes.length}
          meta={unsubscribeMeta}
          tone="danger"
        />
      </section>

      <div className="hm-grid">
        <section className="hm-card">
          <div className="hm-card-head">
            <h2>Recent campaigns</h2>
            <button type="button" className="hm-link" onClick={() => navigate('/campaigns')}>
              All campaigns <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
          {loading ? (
            <SkeletonCard />
          ) : campaigns.length === 0 ? (
            <p className="empty-state">No campaigns yet.</p>
          ) : (
            <ul className="hm-list">
              {campaigns.slice(0, 5).map((campaign) => {
                const tone = toneFor(campaign.status);
                return (
                  <li key={campaign.id}>
                    <button
                      type="button"
                      className={`hm-row is-${tone}`}
                      onClick={() => navigate(`/campaigns/${campaign.id}`)}
                    >
                      <span className="hm-row-main">
                        <span className="hm-row-name">{campaign.name}</span>
                        <span className="hm-row-meta">
                          {progressSummary(campaign)} · {formatDate(campaign.createdAt)}
                        </span>
                        {campaign.status === 'running' && (
                          <ProgressBar campaign={campaign} />
                        )}
                      </span>
                      <span className={`hm-pill is-${tone}`}>{labelFor(campaign.status)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="hm-card">
          <div className="hm-card-head">
            <h2>Recent activity</h2>
            <button type="button" className="hm-link" onClick={() => navigate('/analytics')}>
              Reports <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
          {loading ? (
            <SkeletonCard />
          ) : events.length === 0 ? (
            <p className="empty-state">
              No webhook events yet. Configure your Brevo webhook in Settings to start tracking opens and clicks.
            </p>
          ) : (
            <>
              <ul className="hm-events">
                {visibleEvents.slice(0, 6).map((event) => (
                  <li key={event.id} className="hm-event">
                    <span
                      className={`hm-dot is-${eventTone(event.payload?.event)}`}
                      aria-hidden="true"
                    />
                    <span className="hm-event-kind">
                      {eventLabel(event.payload?.event || event.provider)}
                    </span>
                    <span className="hm-event-who">
                      {event.payload?.email || event.provider}
                    </span>
                    <span className="hm-event-when">
                      {formatRelative(event.receivedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Was: "Hiding 14 mailbox-scanner events (Gmail link prefetch)."
                  The parenthetical explains a cause nobody reading a dashboard
                  needs; the count and the noun carry it. */}
              {botCount > 0 && (
                <p className="hm-foot">
                  {botCount} scanner {botCount === 1 ? 'event' : 'events'} hidden
                </p>
              )}
            </>
          )}
        </section>
      </div>

    </div>
  );
}

function ProgressBar({ campaign }) {
  const pct = progressPct(campaign);
  return (
    <span className="hm-row-track" role="img" aria-label={`${pct}% complete`}>
      <span className="hm-row-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

// Shared by the row bar and the live strip so the two can never disagree
// about how far along a send is.
function progressPct(campaign) {
  const sent = campaign.progress?.sent || 0;
  const failed = campaign.progress?.failed || 0;
  const total = campaign.progress?.total || (sent + failed) || 1;
  return Math.min(100, Math.round(((sent + failed) / total) * 100));
}

function progressSummary(campaign) {
  const sent = campaign.progress?.sent || 0;
  const failed = campaign.progress?.failed || 0;
  const total = campaign.progress?.total;
  if (campaign.status === 'running' && total) return `${sent}/${total} sent`;
  if (failed) return `${sent} sent · ${failed} failed`;
  return `${sent} sent`;
}


function heroHeadline(contactsCount, campaignsCount, inFlightCount) {
  if (inFlightCount > 0) {
    return `${inFlightCount} campaign${inFlightCount === 1 ? '' : 's'} in flight.`;
  }
  if (contactsCount === 0) return 'Add your audience to start sending.';
  if (campaignsCount === 0) return 'Send your first campaign.';
  // Nothing to report. The three branches above each tell you something you
  // would otherwise have to go and look up; there is no fourth fact, and a
  // sentence written to fill the gap is just noise on every visit after the
  // first two. The greeting stands on its own.
  return null;
}

// "This month" is the current calendar month — the window the tiles' second
// lines promise. An absent or unparseable date simply doesn't count.
function isThisMonth(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
}

function Tile({
  icon, label, value, meta, tone, onClick,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`hm-tile is-${tone}${onClick ? ' is-link' : ''}`}
      onClick={onClick}
    >
      <span className="hm-tile-head">
        <span className="hm-tile-icon" aria-hidden="true">{icon}</span>
        <span className="hm-tile-label">{label}</span>
      </span>
      <strong className="hm-tile-value">{Number(value).toLocaleString()}</strong>
      <span className="hm-tile-meta">{meta}</span>
    </Tag>
  );
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

// Compact relative time for the activity feed. "12s", "5m", "3h", "2d", or
// the short date for anything older. Keeps the right column narrow and
// scannable instead of carrying a full datetime per row.
function formatRelative(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1_000))}s`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  } catch {
    return value;
  }
}

// Pill copy. `completed_with_errors` still gets its own wording; the strings
// are the design's — capitalised, and "running" reads as "Sending", which is
// what the row's progress bar is showing anyway.
function labelFor(status) {
  if (status === 'completed_with_errors') return 'Errors';
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'Sending';
  if (status === 'scheduled') return 'Scheduled';
  if (status === 'draft') return 'Draft';
  return status || '-';
}

// Was `pillFor`, which returned the legacy .pill colour names. Same mapping,
// spoken in the hm- vocabulary. One tone per campaign drives BOTH the pill
// and the row's left rail — and only is-warn / is-danger draw a rail, which
// is how the rule stays scarce enough to mean something.
function toneFor(status) {
  if (status === 'completed') return 'success';
  if (status === 'running') return 'accent';
  if (status === 'completed_with_errors') return 'warn';
  if (status === 'scheduled') return 'pending';
  return 'muted';
}

// The feed's dot replaces the per-row pill, so it needs a finer split than
// eventPill's green/amber/muted: a click is not an open, and a bounce is not
// an unsubscribe. Built on eventPill so the underlying positive/negative
// classification stays in one place.
//
// Neutral events (request / sent / deferred) fall through to `accent` —
// home.css has no `.hm-dot.is-muted`, and a dot with no tone class would be
// an invisible 7px gap.
function eventTone(eventName) {
  const name = String(eventName || '').toLowerCase();
  const pill = eventPill(eventName);
  if (pill === 'amber') {
    return /bounce|spam|blocked|invalid/.test(name) ? 'danger' : 'warn';
  }
  if (pill === 'green') return name.includes('click') ? 'success' : 'accent';
  // Neutral machine events — request, sent, deferred — carry no state worth
  // colouring. They were falling through to accent only because a dot with
  // no tone had no background and rendered as a blank gap.
  return 'muted';
}
