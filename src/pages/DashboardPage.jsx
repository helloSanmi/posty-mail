import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
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
import { useAuth } from '../auth/AuthContext';
import { eventLabel, eventPill, isBotEvent } from '../utils/brevoEvents';

// `template` and `setPage` were threaded through the legacy first-run
// <Onboarding> component. Both are unused now that the onboarding lives in
// its own component and routes via useNavigate. Kept off the destructure so
// lint stays happy; if main.jsx still passes them, they're harmless.
export function DashboardPage({ contacts }) {
  const navigate = useNavigate();
  const { user } = useAuth();
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

  const firstName = (user?.name || '').trim().split(/\s+/)[0] || null;

  return (
    <div className="page-stack content-page dashboard-page">
      {/* Onboarding banner. Shows above the dashboard until every setup step
          is complete OR the user dismisses it. Lets people who jumped in
          via "Add audience" still see the "Configure sender" nudge. */}
      <OnboardingChecklist mode="banner" contacts={contacts} campaigns={campaigns} />
      {/* Hero. Greets the user, summarises state in one line, surfaces the
          single most likely next action. Replaces the loose row of buttons
          that lived above the KPI strip; those duplicate the sidebar nav. */}
      <section className="surface dashboard-hero">
        <div className="dashboard-hero-text">
          <span className="eyebrow muted">{greeting()}{firstName ? `, ${firstName}` : ''}</span>
          <h2>{heroHeadline(contacts.length, campaigns.length, inFlight.length)}</h2>
          <p className="muted">{heroSubtitle(contacts.length, lastCampaign)}</p>
        </div>
        <div className="dashboard-hero-actions">
          <button type="button" className="primary" onClick={() => navigate('/builder')}>
            <Send size={16} aria-hidden="true" /> New campaign
          </button>
          {contacts.length === 0 && (
            <button type="button" onClick={() => navigate('/contacts')}>
              <Users size={16} aria-hidden="true" /> Add audience
            </button>
          )}
        </div>
      </section>

      <section className="kpi-grid dashboard-kpi">
        <KpiCard
          icon={<Users size={16} aria-hidden="true" />}
          label="Contacts"
          value={contacts.length}
          onClick={() => navigate('/contacts')}
        />
        <KpiCard
          icon={<Inbox size={16} aria-hidden="true" />}
          label="Campaigns"
          value={campaigns.length}
          onClick={() => navigate('/campaigns')}
        />
        <KpiCard
          icon={<MailCheck size={16} aria-hidden="true" />}
          label="Emails sent"
          value={totalSent}
        />
        <KpiCard
          icon={<ShieldOff size={16} aria-hidden="true" />}
          label="Unsubscribed"
          value={unsubscribes.length}
        />
      </section>

      <section className="dashboard-grid">
        <div className="surface dashboard-block">
          <div className="section-heading">
            <h2>Recent campaigns</h2>
            <button type="button" className="text-button" onClick={() => navigate('/campaigns')}>
              View all
            </button>
          </div>
          {loading ? (
            <SkeletonCard />
          ) : campaigns.length === 0 ? (
            <p className="empty-state">No campaigns yet.</p>
          ) : (
            <ul className="dashboard-list">
              {campaigns.slice(0, 5).map((campaign) => (
                <li key={campaign.id}>
                  <button
                    type="button"
                    className="dashboard-list-item"
                    onClick={() => navigate(`/campaigns/${campaign.id}`)}
                  >
                    <div className="dashboard-campaign-main">
                      <div className="dashboard-campaign-line">
                        <strong>{campaign.name}</strong>
                        <span className={`pill ${pillFor(campaign.status)}`}>
                          {labelFor(campaign.status)}
                        </span>
                      </div>
                      <span className="muted">
                        {progressSummary(campaign)} · {formatDate(campaign.createdAt)}
                      </span>
                      {campaign.status === 'running' && (
                        <ProgressBar campaign={campaign} />
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="surface dashboard-block">
          <div className="section-heading">
            <h2>Recent activity</h2>
            <button type="button" className="text-button" onClick={() => navigate('/analytics')}>
              View all
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
              <ul className="dashboard-list">
                {events.filter((event) => !isBotEvent(event.payload)).slice(0, 6).map((event) => (
                  <li key={event.id} className="dashboard-event">
                    <span className={`pill ${eventPill(event.payload?.event)} dashboard-event-pill`}>
                      {eventLabel(event.payload?.event || event.provider)}
                    </span>
                    <strong className="dashboard-event-email">
                      {event.payload?.email || event.provider}
                    </strong>
                    <span className="muted dashboard-event-time">
                      {formatRelative(event.receivedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {(() => {
                const botCount = events.filter((event) => isBotEvent(event.payload)).length;
                if (!botCount) return null;
                return (
                  <small className="muted dashboard-bot-note">
                    Hiding {botCount} mailbox-scanner {botCount === 1 ? 'event' : 'events'} (Gmail link prefetch).
                  </small>
                );
              })()}
            </>
          )}
        </div>
      </section>

    </div>
  );
}

function ProgressBar({ campaign }) {
  const sent = campaign.progress?.sent || 0;
  const failed = campaign.progress?.failed || 0;
  const total = campaign.progress?.total || (sent + failed) || 1;
  const pct = Math.min(100, Math.round(((sent + failed) / total) * 100));
  return (
    <div className="dashboard-progress" aria-label={`${pct}% complete`}>
      <div className="dashboard-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

function progressSummary(campaign) {
  const sent = campaign.progress?.sent || 0;
  const failed = campaign.progress?.failed || 0;
  const total = campaign.progress?.total;
  if (campaign.status === 'running' && total) return `${sent}/${total} sent`;
  if (failed) return `${sent} sent · ${failed} failed`;
  return `${sent} sent`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function heroHeadline(contactsCount, campaignsCount, inFlightCount) {
  if (inFlightCount > 0) {
    return `${inFlightCount} campaign${inFlightCount === 1 ? '' : 's'} in flight.`;
  }
  if (contactsCount === 0) return 'Add your audience to start sending.';
  if (campaignsCount === 0) return 'Send your first campaign.';
  return 'Ready when you are.';
}

function heroSubtitle(contactsCount, lastCampaign) {
  if (contactsCount === 0) {
    return 'Upload a CSV or add contacts manually. Your list is saved in this app.';
  }
  if (!lastCampaign) {
    return `${contactsCount.toLocaleString()} ${contactsCount === 1 ? 'person' : 'people'} ready to receive your first campaign.`;
  }
  return `${contactsCount.toLocaleString()} ${contactsCount === 1 ? 'person' : 'people'} on your list · last campaign ${formatDate(lastCampaign.createdAt)}.`;
}

function KpiCard({ icon, label, value, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`kpi-card${onClick ? ' is-link' : ''}`}
      onClick={onClick}
    >
      <span className="kpi-icon" aria-hidden="true">{icon}</span>
      <div>
        <span className="muted">{label}</span>
        <strong>{Number(value).toLocaleString()}</strong>
      </div>
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

function labelFor(status) {
  if (status === 'completed_with_errors') return 'completed (errors)';
  return status || '-';
}

function pillFor(status) {
  if (status === 'completed') return 'green';
  if (status === 'completed_with_errors' || status === 'running') return 'amber';
  if (status === 'scheduled') return 'blue';
  return 'muted';
}

