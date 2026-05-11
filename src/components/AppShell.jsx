import { useEffect, useState } from 'react';
import { LogOut, PanelLeft, X } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { navItems, pageTitles } from '../data/navigation';
import { useAuth } from '../auth/AuthContext';
import { NotificationBell } from './NotificationBell';

export function AppShell({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const meta = pageTitles[location.pathname] || pageTitles['/'];
  const visibleNav = navItems.filter((item) => !item.adminOnly || user?.role === 'admin');

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside
        className={`sidebar${drawerOpen ? ' open' : ''}`}
        aria-label="Primary navigation"
      >
        <div className="brand">
          <img src="/posty-mark.svg" alt="" className="brand-mark" aria-hidden="true" />
          <div>
            <strong>Posty</strong>
            <span>Send a little something.</span>
          </div>
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
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {user && (
          <div className="sidebar-user">
            <div>
              <strong>{user.name || user.email}</strong>
              <span>{user.role}</span>
            </div>
            <button type="button" onClick={logout} aria-label="Sign out">
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
          {user && <NotificationBell />}
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </section>
    </main>
  );
}
