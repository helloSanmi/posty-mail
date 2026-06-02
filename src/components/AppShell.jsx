import { useEffect, useState } from 'react';
import {
  LogOut, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, X,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { navItems, pageTitles } from '../data/navigation';
import { useAuth } from '../auth/AuthContext';
import { DemoBanner } from './DemoBanner';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

// localStorage key for the collapsed-sidebar preference. Persisted so the
// admin's choice survives reloads. Keyed under the same `posty.*` prefix
// other UI prefs use.
const SIDEBAR_COLLAPSED_KEY = 'posty.sidebar.collapsed';

export function AppShell({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    if (item.adminOnly) return user?.role === 'admin';
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

  return (
    <main className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <DemoBanner />
      <aside
        className={`sidebar${drawerOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}
        aria-label="Primary navigation"
      >
        <div className="brand">
          <img src="/posty-mark.svg" alt="" className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <strong>Posty</strong>
            {/* Current workspace name, so a user always knows which tenant
                they're operating in. Hidden when the sidebar is collapsed
                (only the mark shows) via the .brand-text display:none rule. */}
            {user?.accountName && (
              <span className="brand-workspace">{user.accountName}</span>
            )}
          </div>
          {/* Collapse / expand toggle. Hidden on mobile (where the sidebar
              is a drawer instead of a persistent column) via the @media
              rule on .sidebar-toggle. Title + aria-label flip with state
              so screen readers + native tooltips announce the action. */}
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
          >
            {collapsed
              ? <PanelLeftOpen size={18} aria-hidden="true" />
              : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="drawer-close"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Main">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                // title attribute surfaces the label as a native tooltip
                // when the sidebar is collapsed and only the icon shows.
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {user && (
          <div className="sidebar-user">
            <div className="sidebar-user-text">
              <strong>{user.name || user.email}</strong>
              <span>{user.role}</span>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              title={collapsed ? 'Sign out' : undefined}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <section className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="mobile-menu"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <PanelLeft size={18} aria-hidden="true" />
          </button>
          <div className="topbar-title">
            <p className="eyebrow">{meta.label}</p>
            <h1>{meta.title}</h1>
          </div>
          {/* Global search trigger. Renders the keyboard shortcut hint
              on wider screens; on mobile it collapses to an icon-only
              button via the .topbar-search CSS @media rule. */}
          {user && (
            <button
              type="button"
              className="topbar-search"
              onClick={() => setSearchOpen(true)}
              aria-label="Open search"
              title="Open search (⌘K)"
            >
              <Search size={14} aria-hidden="true" />
              <span className="topbar-search-label">Search</span>
              <kbd className="topbar-search-kbd">⌘K</kbd>
            </button>
          )}
          {user && <NotificationBell />}
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
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
