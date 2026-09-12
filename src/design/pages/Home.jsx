import { useState } from 'react';
import {
  ArrowRight, Check, Inbox, MailCheck, ShieldOff, Users,
} from 'lucide-react';
import './home.css';

// Home, redesigned.
//
// WHAT CAME OUT, AND WHY
//
// The hero. Today it stacks a greeting eyebrow ("Good afternoon"), an h2
// ("Ready when you are.") and a subtitle ("847 people on your list · last
// campaign 3 Sep"). With the topbar's own "Home" above it that is four
// heading-weight strings in the first 200px, and between the h1 and the h2
// there is no information at all — one says where you are and the other
// says nothing. The subtitle's facts survive; they move into the tiles,
// which is where a number belongs.
//
// WHAT REPLACED IT
//
// A live strip, but only when something is actually sending. That is the
// one thing a hero could legitimately have been for: answering "is anything
// happening right now" before you look at anything else. When nothing is in
// flight it is absent rather than padded with a greeting.
//
// The primary action moves to the topbar, where it is a property of the
// page rather than a component of a banner.

const CONTACT_COUNT = 2847;

const INFLIGHT = {
  name: 'Autumn offer — cohort B',
  sent: 1204,
  total: 2860,
};

const TILES = [
  {
    key: 'contacts',
    icon: Users,
    label: 'Contacts',
    value: '2,847',
    meta: '+124 this month',
    tone: 'accent',
    link: true,
  },
  {
    key: 'campaigns',
    icon: Inbox,
    label: 'Campaigns',
    value: '28',
    meta: '1 sending now',
    tone: 'warn',
    link: true,
  },
  {
    key: 'sent',
    icon: MailCheck,
    label: 'Emails sent',
    value: '48,210',
    meta: '12,481 this month',
    tone: 'success',
  },
  {
    key: 'unsubscribed',
    icon: ShieldOff,
    label: 'Unsubscribed',
    value: '163',
    meta: '0.34% of sends',
    tone: 'danger',
  },
];

const CAMPAIGNS = [
  { name: 'September newsletter', meta: '4,120 sent · 3 Sep', state: 'Completed', tone: 'success' },
  { name: 'Autumn offer — cohort B', meta: '1,204 / 2,860 sent', state: 'Sending', tone: 'accent', progress: 42 },
  { name: 'Welcome sequence', meta: 'Scheduled for 14 Sep', state: 'Scheduled', tone: 'pending' },
  { name: 'Re-engagement', meta: '3,297 sent · 37 failed', state: 'Errors', tone: 'warn' },
  { name: 'Product update', meta: 'Draft · edited 2d ago', state: 'Draft', tone: 'muted' },
];

const EVENTS = [
  { kind: 'Opened', tone: 'accent', who: 'amara.okafor@example.com', when: '12s' },
  { kind: 'Clicked', tone: 'success', who: 'j.whitfield@example.org', when: '4m' },
  { kind: 'Opened', tone: 'accent', who: 'r.mensah@example.com', when: '11m' },
  { kind: 'Bounced', tone: 'danger', who: 'old-address@example.net', when: '38m' },
  { kind: 'Unsubscribed', tone: 'warn', who: 'k.lindqvist@example.se', when: '1h' },
  { kind: 'Opened', tone: 'accent', who: 'dev.patel@example.co.uk', when: '2h' },
];

// The one screen where the whole state palette appears together, which is
// what makes it teach the vocabulary before the operator needs it: done in
// success, the current step on an accent rail, what is still ahead in
// text-subtle.
const SETUP = [
  { label: 'Connect your email provider', meta: 'Brevo · key valid', done: true },
  { label: 'Set your sender address', meta: 'hello@usecomplier.com', done: true },
  { label: 'Add your audience', meta: 'Import a CSV, or add people one at a time', done: false },
  { label: 'Send your first campaign', meta: null, done: false },
];

export function Home() {
  // Sandbox-only. Home has a completely separate first-run branch in the
  // live app — it returns ONLY the checklist — and empty states are where
  // designs usually fall over, so both are reviewable here.
  const [state, setState] = useState('active');

  return (
    <>
      <div className="hm-statebar">
        <span className="hm-statebar-label">Preview state</span>
        <div className="hm-statebar-seg">
          {[['active', 'In use'], ['firstrun', 'First run']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={state === key}
              onClick={() => setState(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {state === 'firstrun' ? <FirstRun /> : <InUse />}
    </>
  );
}

function InUse() {
  const pct = Math.round((INFLIGHT.sent / INFLIGHT.total) * 100);
  return (
    <>
      {/* Present only because something IS sending. Nothing in flight, no
          strip — the page starts at the numbers. */}
      <section className="hm-live" aria-live="polite">
        <span className="hm-live-dot" aria-hidden="true" />
        <span className="hm-live-text">
          <strong>{INFLIGHT.name}</strong>
          <span className="hm-live-meta">
            {INFLIGHT.sent.toLocaleString()} of {INFLIGHT.total.toLocaleString()} sent
          </span>
        </span>
        <span className="hm-live-track" aria-hidden="true">
          <span className="hm-live-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="hm-live-pct">{pct}%</span>
        <button type="button" className="hm-link">
          View <ArrowRight size={13} aria-hidden="true" />
        </button>
      </section>

      <section className="hm-tiles">
        {TILES.map(({ icon: Icon, ...t }) => {
          const Tag = t.link ? 'button' : 'div';
          return (
            <Tag
              key={t.key}
              type={t.link ? 'button' : undefined}
              className={`hm-tile is-${t.tone}${t.link ? ' is-link' : ''}`}
            >
              <span className="hm-tile-head">
                <span className="hm-tile-icon" aria-hidden="true"><Icon size={14} /></span>
                <span className="hm-tile-label">{t.label}</span>
              </span>
              <strong className="hm-tile-value">{t.value}</strong>
              <span className="hm-tile-meta">{t.meta}</span>
            </Tag>
          );
        })}
      </section>

      <div className="hm-grid">
        <section className="hm-card">
          <div className="hm-card-head">
            <h2>Recent campaigns</h2>
            <button type="button" className="hm-link">
              All campaigns <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
          <ul className="hm-list">
            {CAMPAIGNS.map((c) => (
              <li key={c.name}>
                <button type="button" className={`hm-row is-${c.tone}`}>
                  <span className="hm-row-main">
                    <span className="hm-row-name">{c.name}</span>
                    <span className="hm-row-meta">{c.meta}</span>
                    {c.progress != null && (
                      <span className="hm-row-track" aria-hidden="true">
                        <span className="hm-row-fill" style={{ width: `${c.progress}%` }} />
                      </span>
                    )}
                  </span>
                  <span className={`hm-pill is-${c.tone}`}>{c.state}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="hm-card">
          <div className="hm-card-head">
            <h2>Recent activity</h2>
            <button type="button" className="hm-link">
              Reports <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
          <ul className="hm-events">
            {EVENTS.map((e) => (
              <li key={`${e.who}-${e.when}`} className="hm-event">
                <span className={`hm-dot is-${e.tone}`} aria-hidden="true" />
                <span className="hm-event-kind">{e.kind}</span>
                <span className="hm-event-who">{e.who}</span>
                <span className="hm-event-when">{e.when}</span>
              </li>
            ))}
          </ul>
          {/* Was: "Hiding 14 mailbox-scanner events (Gmail link prefetch)."
              The parenthetical explains a cause nobody reading a dashboard
              needs; the count and the noun carry it. */}
          <p className="hm-foot">14 scanner events hidden</p>
        </section>
      </div>
    </>
  );
}

function FirstRun() {
  const done = SETUP.filter((s) => s.done).length;
  return (
    <section className="hm-setup">
      <div className="hm-setup-head">
        <div>
          <h2>Finish setting up</h2>
          {/* Was: "Knock these out and you're mailing in under five
              minutes." A progress count is the same promise without the
              salesmanship. */}
          <span className="hm-setup-count">{done} of {SETUP.length} done</span>
        </div>
        <span className="hm-setup-track" aria-hidden="true">
          <span className="hm-setup-fill" style={{ width: `${(done / SETUP.length) * 100}%` }} />
        </span>
      </div>

      <ol className="hm-steps">
        {SETUP.map((step, i) => {
          const isCurrent = !step.done && SETUP.findIndex((s) => !s.done) === i;
          return (
            <li
              key={step.label}
              className={`hm-step${step.done ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
            >
              <span className="hm-step-mark" aria-hidden="true">
                {step.done ? <Check size={12} /> : i + 1}
              </span>
              <span className="hm-step-text">
                <span className="hm-step-label">{step.label}</span>
                {step.meta && <span className="hm-step-meta">{step.meta}</span>}
              </span>
              {isCurrent && (
                <button type="button" className="hm-btn hm-btn-primary">Add contacts</button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { CONTACT_COUNT };
