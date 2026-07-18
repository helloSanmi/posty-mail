import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { UiProvider, useUi } from './components/UiProvider';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { blankTemplate } from './templates/defaultTemplates';
import { getSavedContacts } from './services/brevoApi';
import { DashboardPage } from './pages/DashboardPage';
import { ContactsPage } from './pages/ContactsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { BuilderPage } from './pages/BuilderPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { CampaignDetailPage } from './pages/CampaignDetailPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { LoginPage } from './pages/LoginPage';
import './styles.css';

function RequireAuth({ children }) {
  const { token, user, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) {
    return <div className="auth-shell"><p className="status-line">Loading…</p></div>;
  }

  if (!token || !user) {
    const search = location.pathname !== '/'
      ? `?redirect=${encodeURIComponent(location.pathname)}`
      : '';
    return <Navigate to={`/login${search}`} replace />;
  }

  return children;
}

// Route-level access gate. Sends a user who lacks the area back to Home
// (the sidebar already hides these, but this covers deep links + stale
// bookmarks). Backend enforcement is independent — this is UX, not security.
function Guard({
  area, anyOf, superAdmin, children,
}) {
  const { user, can, canAny } = useAuth();
  let ok;
  if (superAdmin) ok = Boolean(user?.isSuperAdmin);
  else if (anyOf) ok = canAny(anyOf);
  else ok = can(area);
  return ok ? children : <Navigate to="/" replace />;
}

function ProtectedShell() {
  const navigate = useNavigate();
  const { notify } = useUi();
  const [contacts, setContacts] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [template, setTemplate] = useState(blankTemplate);
  const [refreshTick, setRefreshTick] = useState(0);
  // Bump refreshTick to force a re-fetch of the saved contacts list. Every
  // page that mutates contacts or that needs an up-to-date audience count
  // (e.g., the campaign builder) calls this so the parent state never goes
  // stale after a CSV import / contact add on a different route.
  const refreshContacts = useCallback(() => setRefreshTick((value) => value + 1), []);

  useEffect(() => {
    getSavedContacts()
      .then((saved) => {
        setContacts(saved);
        setInvalidRows([]);
      })
      .catch(() => {});
  }, [refreshTick]);

  const audienceProps = {
    contacts,
    invalidRows,
    onParsed: ({ valid, invalid }) => {
      setContacts(valid);
      setInvalidRows(invalid);
    },
    refreshContacts,
    notify,
  };

  const goTo = useCallback((target) => {
    const map = {
      dashboard: '/',
      contacts: '/contacts',
      templates: '/templates',
      builder: '/builder',
      analytics: '/analytics',
      integrations: '/settings',
    };
    navigate(map[target] || target);
  }, [navigate]);

  return (
    <AppShell>
      <Routes>
        <Route
          index
          element={
            <DashboardPage
              contacts={contacts}
              template={template}
              setPage={goTo}
            />
          }
        />
        <Route
          path="/contacts"
          element={<Guard area="contacts"><ContactsPage {...audienceProps} /></Guard>}
        />
        <Route
          path="/templates"
          element={(
            <Guard area="templates">
              <TemplatesPage
                template={template}
                setTemplate={setTemplate}
                contacts={contacts}
                notify={notify}
              />
            </Guard>
          )}
        />
        <Route
          path="/builder"
          element={(
            <Guard area="campaigns">
              <BuilderPage
                contacts={contacts}
                template={template}
                setTemplate={setTemplate}
                setPage={goTo}
                notify={notify}
                refreshContacts={refreshContacts}
                onCampaignScheduled={refreshContacts}
              />
            </Guard>
          )}
        />
        <Route
          path="/campaigns"
          element={<Guard area="campaigns"><CampaignsPage notify={notify} /></Guard>}
        />
        <Route
          path="/campaigns/:id"
          element={<Guard area="campaigns"><CampaignDetailPage /></Guard>}
        />
        {/* Segments moved under Audience; Sequences was removed. Redirect
            old links so bookmarks don't dead-end. */}
        <Route path="/segments" element={<Navigate to="/contacts" replace />} />
        <Route path="/sequences" element={<Navigate to="/" replace />} />
        <Route
          path="/analytics"
          element={<Guard area="analytics"><AnalyticsPage key={refreshTick} /></Guard>}
        />
        <Route
          path="/settings"
          element={<Guard anyOf={['settings', 'connections']}><SettingsPage notify={notify} /></Guard>}
        />
        <Route
          path="/admin"
          element={<Guard area="admin"><AdminPage notify={notify} /></Guard>}
        />
        <Route
          path="/workspaces"
          element={<Guard superAdmin><WorkspacesPage notify={notify} /></Guard>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

function App() {
  const navigate = useNavigate();
  const handleUnauthorized = useCallback(() => {
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthProvider>
      <UiProvider onUnauthorized={handleUnauthorized}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <ProtectedShell />
              </RequireAuth>
            }
          />
        </Routes>
      </UiProvider>
    </AuthProvider>
  );
}

// Opt into the v7 router behaviors explicitly. On react-router-dom@7 these
// are the defaults. Passing them here is defensive: it silences any
// "future-flag will become default" dev warnings from older transitive
// installs, and documents the behaviors we rely on.
createRoot(document.getElementById('root')).render(
  <BrowserRouter
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  >
    <App />
  </BrowserRouter>,
);
