import { useEffect, useState } from 'react';
import {
  BarChart3, Bell, Building2, Inbox, LayoutDashboard, LogOut, MailCheck,
  PanelLeft, PanelLeftClose, PanelLeftOpen, PlugZap, Search, ShieldCheck,
  Users, X,
} from 'lucide-react';
import './shell.css';

// The application frame, redesigned. Everything the live AppShell does is
// here so it can be judged as a replacement rather than as a mockup:
// collapsible sidebar, mobile drawer with backdrop, workspace identity,
// nav, signed-in user, section eyebrow, search trigger, notifications.
//
// What changes from today:
//
//  - The sidebar sits on surface-sunken rather than the same white as the
//    content. Today the rail, the page and the cards are all near-white, so
//    the frame and the work are the same material and nothing recedes.
//  - One accent rail on the active nav item and nowhere else. Today the
//    active item is a filled blue-tinted block, which is the heaviest
//    element on screen competing with the actual page.
//  - The workspace name is part of the brand block rather than a second
//    line of muted text under it.
//  - The user block loses its box and becomes a quiet row; sign-out stays
//    an icon.
//  - Nothing in the chrome carries an explanatory sentence.

const NAV = [
  { icon: LayoutDashboard, label: 'Home' },
  { icon: MailCheck, label: 'Email' },
  { icon: Users, label: 'Audience' },
  { icon: Inbox, label: 'Campaigns' },
  { icon: BarChart3, label: 'Reports' },
  { icon: PlugZap, label: 'Settings' },
  { icon: ShieldCheck, label: 'Admin' },
  { icon: Building2, label: 'Workspaces' },
];

export function Shell({
  active = 'Campaigns', title, eyebrow, action, children,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Clicking a nav item swaps the frame's own title so the shell can be
  // exercised, without pretending the other pages are designed yet.
  const [current, setCurrent] = useState(active);

  // Escape closes the drawer, matching the live shell.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKey(event) { if (event.key === 'Escape') setDrawerOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className={`sh${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-drawer-open' : ''}`}>
      <aside className="sh-side" aria-label="Primary navigation">
        <div className="sh-brand">
          <span className="sh-mark" aria-hidden="true" />
          <span className="sh-brand-text">
            <strong>Posty</strong>
            <span className="sh-workspace">Complier</span>
          </span>
          <button
            type="button"
            className="sh-icon-btn sh-collapse"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed
              ? <PanelLeftOpen size={16} aria-hidden="true" />
              : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="sh-icon-btn sh-drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <nav className="sh-nav" aria-label="Main">
          {NAV.map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              className={`sh-nav-item${current === label ? ' is-active' : ''}`}
              aria-current={current === label ? 'page' : undefined}
              title={collapsed ? label : undefined}
              onClick={() => { setCurrent(label); setDrawerOpen(false); }}
            >
              <Icon size={17} aria-hidden="true" />
              <span className="sh-nav-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="sh-user">
          <span className="sh-avatar" aria-hidden="true">SI</span>
          <span className="sh-user-text">
            <strong>Sanmi Idowu</strong>
            <span>Admin</span>
          </span>
          <button type="button" className="sh-icon-btn" aria-label="Sign out" title="Sign out">
            <LogOut size={15} aria-hidden="true" />
          </button>
        </div>
      </aside>

      {drawerOpen && (
        <button
          type="button"
          className="sh-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="sh-main">
        <header className="sh-top">
          <button
            type="button"
            className="sh-icon-btn sh-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>

          <div className="sh-title">
            {/* Only rendered when there is a second level to name. It used to
                repeat the heading verbatim. */}
            {current === active && eyebrow && <span className="sh-eyebrow">{eyebrow}</span>}
            <h1>{current === active ? (title || active) : current}</h1>
          </div>

          {/* The page's primary action belongs to the page, not to a banner
              inside it. Home's "New campaign" used to sit in a hero. */}
          {current === active && action}

          <button type="button" className="sh-search">
            <Search size={14} aria-hidden="true" />
            <span className="sh-search-label">Search</span>
            <kbd>⌘K</kbd>
          </button>

          <button type="button" className="sh-icon-btn sh-bell" aria-label="Notifications">
            <Bell size={16} aria-hidden="true" />
            <span className="sh-badge" aria-hidden="true">3</span>
          </button>
        </header>

        <div className="sh-content">
          {current === active ? children : (
            <p className="sh-stub">{current} is not designed yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
