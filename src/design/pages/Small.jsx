import { useState } from 'react';
import {
  ArrowLeft, Building2, Check, Plus, RefreshCw, Trash2,
} from 'lucide-react';
import './small.css';

// The four remaining pages. They share enough structure — a header, a
// table, a set of rows — that keeping them in one file keeps that shared
// treatment honest rather than letting each drift.

// ===========================================================================
// CAMPAIGN DETAIL
//
// The header band carried FIVE identity signals at once: the topbar's "Campaigns"
// (the /campaigns fallback, since /campaigns/:id has no entry in pageTitles),
// a back button reading "All campaigns", the campaign-name h2, a pulsing
// "Live · updated 14:32:07" badge and a Refresh button — all on one line.
// The topbar now carries the campaign name as the page title with
// "Campaigns" as its eyebrow, which is what the eyebrow is for, so the back
// link can be a plain link and the h2 disappears.
//
// Counts were printed three times: in the tab labels, in the pagination
// status, and again as "Total clicks: n". They are printed once, on the tab.
// ===========================================================================

const KPIS = [
  { label: 'Sent', value: '4,120', tone: null },
  { label: 'Opens', value: '1,776', rate: '43.1%', tone: 'accent' },
  { label: 'Clicks', value: '379', rate: '9.2%', tone: 'success' },
  { label: 'Bounces', value: '8', rate: '0.2%', tone: 'danger' },
];

const RECIPIENTS = [
  { email: 'amara.okafor@example.com', opens: 3, clicks: 1, state: 'Opened', tone: 'accent' },
  { email: 'j.whitfield@example.org', opens: 1, clicks: 2, state: 'Clicked', tone: 'success' },
  { email: 'r.mensah@example.com', opens: 2, clicks: 0, state: 'Opened', tone: 'accent' },
  { email: 'old-address@example.net', opens: 0, clicks: 0, state: 'Bounced', tone: 'danger' },
  { email: 's.marchetti@example.it', opens: 0, clicks: 0, state: 'Delivered', tone: 'muted' },
];

export function CampaignDetail() {
  const [tab, setTab] = useState('recipients');
  return (
    <>
      <div className="sm-detail-head">
        <button type="button" className="sm-back">
          <ArrowLeft size={14} aria-hidden="true" /> All campaigns
        </button>
        <span className="sm-spacer" />
        <span className="sm-live">
          <span className="sm-live-dot" aria-hidden="true" />
          Updated 14:32
        </span>
        <button type="button" className="sm-icon-btn" aria-label="Refresh" title="Refresh">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <section className="sm-kpis">
        {KPIS.map((k) => (
          <div key={k.label} className={`sm-kpi${k.tone ? ` is-${k.tone}` : ''}`}>
            <span className="sm-kpi-label">{k.label}</span>
            <strong className="sm-kpi-value">{k.value}</strong>
            <span className="sm-kpi-rate">{k.rate || ' '}</span>
          </div>
        ))}
      </section>

      <section className="sm-card">
        {/* The tab strip used to float above the card it controlled, as a
            separate grey inset object — two containers for one thing. It is
            now the card's own head. */}
        <div className="sm-card-head">
          <div className="sm-tabs" role="tablist" aria-label="Campaign detail">
            {[['recipients', 'Recipients', 4120], ['links', 'Links', 12], ['variants', 'A/B variants', 2]].map(
              ([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`sm-tab${tab === key ? ' is-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  <span className="sm-tab-n">{n.toLocaleString()}</span>
                </button>
              ),
            )}
          </div>
        </div>
        <table className="sm-table">
          <thead>
            <tr>
              <th>Recipient</th>
              <th className="sm-num">Opens</th>
              <th className="sm-num">Clicks</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {RECIPIENTS.map((r) => (
              <tr key={r.email} className={`sm-row is-${r.tone}`}>
                <td className="sm-trunc">{r.email}</td>
                <td className="sm-num">{r.opens}</td>
                <td className="sm-num">{r.clicks}</td>
                <td><span className={`sm-pill is-${r.tone}`}>{r.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ===========================================================================
// ADMIN
//
// The same label was rendered three times above one list — the topbar
// eyebrow, the active subtab and the section h3 all said "Team members" —
// and two control rows stacked within about 60px. The subtab names the
// view, so the h3 goes and the action joins the tab row.
//
// Role rows carried up to five competing elements on one line: name, a
// "Full access" chip, a member count, up to six area pills and two icon
// actions. The area pills become a count with the names on the row's second
// line, which is where a list of six things belongs.
// ===========================================================================

const USERS = [
  { name: 'Sanmi Idowu', email: 'sanmi@purify-tech.co.uk', role: 'Admin', you: true },
  { name: 'Rita Mensah', email: 'rita@usecomplier.com', role: 'Editor' },
  { name: 'Dev Patel', email: 'dev@usecomplier.com', role: 'Viewer' },
];

const ROLES = [
  { name: 'Admin', members: 1, areas: 'Everything, including users and roles', full: true },
  { name: 'Editor', members: 1, areas: 'Email, Audience, Campaigns, Reports' },
  { name: 'Viewer', members: 1, areas: 'Reports' },
];

export function Admin() {
  const [tab, setTab] = useState('team');
  return (
    <section className="sm-card">
      <div className="sm-card-head">
        <div className="sm-tabs" role="tablist" aria-label="Admin sections">
          {[['team', 'Team members', 3], ['roles', 'Roles & access', 3], ['activity', 'Activity log', null]].map(
            ([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`sm-tab${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
                {n != null && <span className="sm-tab-n">{n}</span>}
              </button>
            ),
          )}
        </div>
        <button type="button" className="sm-btn sm-btn-primary">
          <Plus size={14} aria-hidden="true" /> {tab === 'roles' ? 'New role' : 'Add user'}
        </button>
      </div>

      {tab === 'team' && (
        <ul className="sm-rows">
          {USERS.map((u) => (
            <li key={u.email} className="sm-rowitem">
              <span className="sm-avatar" aria-hidden="true">
                {u.name.split(' ').map((p) => p[0]).join('')}
              </span>
              <span className="sm-rowtext">
                <span className="sm-rowname">
                  {u.name}
                  {u.you && <span className="sm-chip">you</span>}
                </span>
                <span className="sm-dim">{u.email}</span>
              </span>
              <span className="sm-role">{u.role}</span>
              <span className="sm-rowactions">
                <button type="button" className="sm-icon-btn" aria-label={`Edit ${u.name}`} title="Edit">
                  <Check size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="sm-icon-btn is-danger"
                  aria-label={`Remove ${u.name}`}
                  title="Remove"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'roles' && (
        <ul className="sm-rows">
          {ROLES.map((r) => (
            <li key={r.name} className="sm-rowitem">
              <span className="sm-rowtext">
                <span className="sm-rowname">
                  {r.name}
                  {r.full && <span className="sm-chip">full access</span>}
                  <span className="sm-dim">{r.members} member{r.members === 1 ? '' : 's'}</span>
                </span>
                <span className="sm-dim">{r.areas}</span>
              </span>
              <span className="sm-rowactions">
                <button type="button" className="sm-icon-btn" aria-label={`Edit ${r.name}`} title="Edit">
                  <Check size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'activity' && (
        <table className="sm-table">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th></tr>
          </thead>
          <tbody>
            {[
              ['14:32', 'Sanmi Idowu', 'Updated sender identity'],
              ['11:04', 'Rita Mensah', 'Sent campaign “September newsletter”'],
              ['09:47', 'Sanmi Idowu', 'Added user dev@usecomplier.com'],
            ].map(([w, who, what]) => (
              <tr key={w} className="sm-row">
                <td className="sm-dim sm-when">{w}</td>
                <td>{who}</td>
                <td className="sm-dim">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ===========================================================================
// WORKSPACES
//
// The audit's note here was the opposite of everywhere else: "the redesign
// risk is under-structure, not clutter". Six columns spent ~270px on three
// single-digit numbers, each with an icon AND an uppercase label; below
// 760px the header vanished and five unlabelled values stacked as bare
// lines. The three counts become one cell, which fixes both.
// ===========================================================================

const WORKSPACES = [
  { name: 'Complier', sender: 'hello@usecomplier.com', users: 3, contacts: 2847, campaigns: 28, isDefault: true, you: true },
  { name: 'Bloom & Become', sender: 'info@bloomnbecome.org.uk', users: 2, contacts: 1120, campaigns: 9 },
];

export function Workspaces() {
  return (
    <section className="sm-card">
      <div className="sm-card-head">
        <h2><Building2 size={15} aria-hidden="true" /> 2 workspaces</h2>
      </div>
      <ul className="sm-rows">
        {WORKSPACES.map((w) => (
          <li key={w.name} className="sm-rowitem sm-ws">
            <span className="sm-rowtext">
              <span className="sm-rowname">
                {w.name}
                {w.isDefault && <span className="sm-chip">default</span>}
                {w.you && <span className="sm-chip is-accent">you</span>}
              </span>
              <span className="sm-dim">{w.sender}</span>
            </span>
            {/* Three columns of one number each became one cell. The labels
                are inline, so they survive the narrow breakpoint that used
                to strip the header row and leave bare digits. */}
            <span className="sm-counts">
              <span><b>{w.users}</b> users</span>
              <span><b>{w.contacts.toLocaleString()}</b> contacts</span>
              <span><b>{w.campaigns}</b> campaigns</span>
            </span>
            <span className="sm-rowactions">
              {/* Absent, not disabled, on the workspace you are signed into
                  — but the column keeps its width so the right edge does
                  not go ragged down the list. */}
              {!w.you && (
                <button
                  type="button"
                  className="sm-icon-btn is-danger"
                  aria-label={`Delete ${w.name}`}
                  title="Delete workspace"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===========================================================================
// LOGIN
//
// A three-line centred preamble — logo, heading, subheading — above a
// two-field form, where the subheading restated the heading. "Sign in" over
// "Sign in to your Posty workspace." is the same sentence twice. The
// subheading goes; the workspace name earns the second line instead,
// because on a self-hosted install knowing WHICH Posty you are signing into
// is the one thing the screen can usefully add.
// ===========================================================================

export function Login() {
  const [mode, setMode] = useState('signin');
  return (
    <div className="sm-auth">
      <form className="sm-authcard" onSubmit={(e) => e.preventDefault()}>
        <div className="sm-authbrand">
          <span className="sm-authmark" aria-hidden="true" />
          <h1>{mode === 'signin' ? 'Sign in' : 'Reset password'}</h1>
          <span className="sm-dim">Complier</span>
        </div>

        <label className="sm-field">
          Email
          <input type="email" placeholder="you@example.com" />
        </label>
        <label className="sm-field">
          {mode === 'signin' ? 'Password' : 'New password'}
          <input type="password" placeholder={mode === 'signin' ? '' : 'At least 8 characters'} />
        </label>

        <button type="submit" className="sm-authbtn">
          {mode === 'signin' ? 'Sign in' : 'Reset password'}
        </button>

        {/* One row, not a divider plus a stack of two same-coloured links
            reading as a second action zone under the primary button. */}
        <div className="sm-authlinks">
          <button type="button" onClick={() => setMode(mode === 'signin' ? 'forgot' : 'signin')}>
            {mode === 'signin' ? 'Forgot password' : 'Back to sign in'}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button">Create an account</button>
        </div>
      </form>
    </div>
  );
}
