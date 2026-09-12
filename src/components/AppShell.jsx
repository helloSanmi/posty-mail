import { useEffect, useState } from 'react';
import {
  LogOut, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, X,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { navItems, pageTitles } from '../data/navigation';
import { useAuth } from '../auth/AuthContext';
import { PageSectionContext } from './PageSectionContext';
import { DemoBanner } from './DemoBanner';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

// localStorage key for the collapsed-sidebar preference. Persisted so the
// admin's choice survives reloads. Keyed under the same `posty.*` prefix
// other UI prefs use.
const SIDEBAR_COLLAPSED_KEY = 'posty.sidebar.collapsed';

// Initials for the sidebar avatar. Derived from the signed-in user, never
// stored: name first ("Sanmi Idowu" -> "SI"), falling back to the local
// part of the email ("sanmi.idowu@..." -> "SI") so the row still reads as a
// person for accounts that never set a display name.
function userInitials(user) {
  const source = String(user?.name || user?.email || '').trim();
  if (!source) return '?';
  const local = source.split('@')[0];
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join('');
  return (letters || local[0]).toUpperCase();
}

export function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user, logout, can, canAny,
  } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sign out and land on a CLEAN /login. Without the explicit navigate,
  // clearing the token leaves RequireAuth mounted on the current route
  // (e.g. /admin), which captures ?redirect=/admin — so the next login
  // would dump you back on Admin instead of Home.
  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }
  // Collapsed sidebar state. Lazy initializer so we read localStorage
  // once on mount; persisted back via the effect below whenever the
  // user toggles. SSR-safe via the `typeof window` guard so a future
  // server render doesn't crash.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  // Cmd/Ctrl+K opens the global search palette. Also toggled by the
  // search button in the topbar.
  const [searchOpen, setSearchOpen] = useState(false);
  // The section the current page has open, published by the page itself via
  // usePageSectionLabel. Drives the topbar eyebrow; null means the page has
  // no second level and the eyebrow is not rendered at all.
  const [section, setSection] = useState(null);
  // Resolve a page title for the current route. Exact match wins; otherwise
  // strip the trailing segments one at a time and try again so dynamic
  // routes like /campaigns/:id fall back to /campaigns ("Campaigns"). This
  // is why the topbar was reading "Home" on the campaign detail page — the
  // exact pathname (/campaigns/abc) wasn't in pageTitles and we landed on
  // the '/' default.
  const meta = (() => {
    if (pageTitles[location.pathname]) return pageTitles[location.pathname];
    const segments = location.pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 1; i -= 1) {
      const candidate = `/${segments.slice(0, i).join('/')}`;
      if (pageTitles[candidate]) return pageTitles[candidate];
    }
    return pageTitles['/'];
  })();
  const visibleNav = navItems.filter((item) => {
    if (item.superAdminOnly) return Boolean(user?.isSuperAdmin);
    if (item.anyPermission) return canAny(item.anyPermission);
    if (item.permission) return can(item.permission);
    return true;
  });

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Global Cmd/Ctrl+K shortcut for the search palette. Captured at the
  // document level so it works regardless of which field has focus. The
  // palette's own Escape handler closes it; we only toggle open here.
  // Browsers reserve Cmd+K for the URL bar in Safari/Firefox but inside
  // a focused app it gets through. We also intercept "/" when nothing
  // editable has focus, matching the GitHub / Notion convention.
  useEffect(() => {
    const onKey = (event) => {
      const inEditable = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)
        || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((value) => !value);
      } else if (event.key === '/' && !inEditable) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Three planes instead of one: the rail sits on surface-sunken, the
  // topbar on surface, the page on bg. `is-collapsed` and `is-drawer-open`
  // live on the frame because the rail's width (desktop) and its transform
  // (mobile drawer) are both driven from the grid container.
  return (
    <main className={`sh${collapsed ? ' is-collapsed' : ''}${drawerOpen ? ' is-drawer-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {/* Spans both grid columns (grid-column: 1 / -1) so it reads as a
          band above the whole frame, not a strip over the content. */}
      <DemoBanner />
      <aside className="sh-side" aria-label="Primary navigation">
        <div className="sh-brand">
          <img src="/posty-mark.svg" alt="" className="sh-mark is-image" aria-hidden="true" />
          <span className="sh-brand-text">
            <strong>Posty</strong>
            {/* The workspace name tells you WHICH tenant you're operating
                in, so it sits with the brand rather than as a detached line
                below it. Removed from the flow when collapsed via the
                .sh-brand-text rule (only the mark shows). */}
            {user?.accountName && (
              <span className="sh-workspace">{user.accountName}</span>
            )}
          </span>
          {/* Collapse / expand toggle. Hidden on mobile (where the sidebar
              is a drawer instead of a persistent column) via the @media
              rule on .sh-collapse. Title + aria-label flip with state
              so screen readers + native tooltips announce the action. */}
          <button
            type="button"
            className="sh-icon-btn sh-collapse"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed
              ? <PanelLeftOpen size={16} aria-hidden="true" />
              : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="sh-icon-btn sh-drawer-close"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <nav className="sh-nav" aria-label="Main">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                end={item.path === '/'}
                // Active is a LIFT (surface-raised + one accent rail), not
                // a filled block. NavLink sets aria-current="page" itself.
                className={({ isActive }) => (isActive ? 'sh-nav-item is-active' : 'sh-nav-item')}
                // title attribute surfaces the label as a native tooltip
                // when the sidebar is collapsed and only the icon shows.
                title={collapsed ? item.label : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="sh-nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {user && (
          <div className="sh-user">
            <span className="sh-avatar" aria-hidden="true">{userInitials(user)}</span>
            <span className="sh-user-text">
              <strong>{user.name || user.email}</strong>
              <span>{user.role}</span>
            </span>
            <button
              type="button"
              className="sh-icon-btn"
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="sh-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <section className="sh-main">
        <header className="sh-top">
          <button
            type="button"
            className="sh-icon-btn sh-menu"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>
          <div className="sh-title">
            {/* Only rendered when there is a second level to name. It used
                to show meta.label, which was identical to the heading. */}
            {section && <span className="sh-eyebrow">{section}</span>}
            <h1>{meta.title}</h1>
          </div>
          {/* Global search trigger. Renders the keyboard shortcut hint
              on wider screens; on mobile the label and the kbd are hidden
              via the shell sheet's @media rule and it collapses to the
              icon. */}
          {user && (
            <button
              type="button"
              className="sh-search"
              onClick={() => setSearchOpen(true)}
              aria-label="Open search"
              title="Open search (⌘K)"
            >
              <Search size={14} aria-hidden="true" />
              <span className="sh-search-label">Search</span>
              <kbd>⌘K</kbd>
            </button>
          )}
          {user && <NotificationBell />}
        </header>
        <div id="main-content" className="sh-content" tabIndex={-1}>
          <PageSectionContext.Provider value={setSection}>
            {children}
          </PageSectionContext.Provider>
        </div>
      </section>
      {user && (
        <GlobalSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </main>
  );
}
