import {
  Suspense, lazy, useCallback, useEffect, useState,
} from 'react';
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
import { LoadingPage } from './components/Spinner';
import { UiProvider, useUi } from './components/UiProvider';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { blankTemplate } from './templates/defaultTemplates';
import { getSavedContacts } from './services/brevoApi';
// LoginPage stays eager — it's the first paint for signed-out users, so
// lazy-loading it would only add a flash. Every in-app page is split into
// its own chunk (loaded on navigation) so the initial bundle is small.
// The pages are named exports, so map them onto `default` for React.lazy.
import { LoginPage } from './pages/LoginPage';
import './styles.css';

const named = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const DashboardPage = named(() => import('./pages/DashboardPage'), 'DashboardPage');
const ContactsPage = named(() => import('./pages/ContactsPage'), 'ContactsPage');
const TemplatesPage = named(() => import('./pages/TemplatesPage'), 'TemplatesPage');
const BuilderPage = named(() => import('./pages/BuilderPage'), 'BuilderPage');
const CampaignsPage = named(() => import('./pages/CampaignsPage'), 'CampaignsPage');
const CampaignDetailPage = named(() => import('./pages/CampaignDetailPage'), 'CampaignDetailPage');
const AnalyticsPage = named(() => import('./pages/AnalyticsPage'), 'AnalyticsPage');
const SettingsPage = named(() => import('./pages/SettingsPage'), 'SettingsPage');
const AdminPage = named(() => import('./pages/AdminPage'), 'AdminPage');
const ProfilePage = named(() => import('./pages/ProfilePage'), 'ProfilePage');
const WorkspacesPage = named(() => import('./pages/WorkspacesPage'), 'WorkspacesPage');

function RequireAuth({ children }) {
  const { token, user, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) {
    return <div className="auth-shell"><LoadingPage label="Checking your session…" /></div>;
  }

  if (!token || !user) {
    // The full location, not just the pathname. Now that the view lives in
    // the query string, dropping it means an expired session returns you to
    // /campaigns instead of the Errors filter on page 3 you were working
    // through — the same complaint, reached by a different door.
    const here = location.pathname + location.search + location.hash;
    const search = here !== '/' ? `?redirect=${encodeURIComponent(here)}` : '';
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
  const { can } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [invalidRows, setInvalidRows] = useState([]);
  const [template, setTemplate] = useState(blankTemplate);
  const [refreshTick, setRefreshTick] = useState(0);
  // Bump refreshTick to force a re-fetch of the saved contacts list. Every
  // page that mutates contacts or that needs an up-to-date audience count
  // (e.g., the campaign builder) calls this so the parent state never goes
  // stale after a CSV import / contact add on a different route.
  const refreshContacts = useCallback(() => setRefreshTick((value) => value + 1), []);

  // Only asked for by a role that can read contacts.
  //
  // This fetch runs for EVERY signed-in user on mount, and reads are gated
  // now — so a Viewer (analytics only) got a 403 within a second of signing
  // in. The local .catch does not help: the axios interceptor fires the
  // global error listener first, so what they actually saw was a red "Not
  // permitted" toast on the dashboard, for something they never did. Then
  // the Contacts tile sat at 0 forever, because `contacts` stayed empty.
  //
  // Asking first is both quieter and more honest than swallowing the error:
  // a role without the area has no business requesting it.
  const canReadContacts = can('contacts');
  useEffect(() => {
    if (!canReadContacts) {
      setContacts([]);
      setInvalidRows([]);
      return;
    }
    getSavedContacts()
      .then((saved) => {
        setContacts(saved);
        setInvalidRows([]);
      })
      .catch(() => {});
  }, [refreshTick, canReadContacts]);

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
      {/* Lazy page chunks. LoadingPage waits 200ms before showing
          anything, so a cached chunk — the common case — swaps in with no
          flash at all. */}
      <Suspense fallback={<LoadingPage />}>
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
          element={<Guard anyOf={['forms', 'bounces', 'unsubscribes', 'connections']}><SettingsPage notify={notify} /></Guard>}
        />
        <Route
          path="/admin"
          element={<Guard area="admin"><AdminPage notify={notify} /></Guard>}
        />
        {/* No Guard. Everyone signed in has a profile, by definition — it is
            the one page whose contents are the viewer. RequireAuth above is
            the only gate it needs. */}
        <Route path="/profile" element={<ProfilePage notify={notify} />} />
        <Route
          path="/workspaces"
          element={<Guard superAdmin><WorkspacesPage notify={notify} /></Guard>}
        />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function App() {
  return (
    <AuthProvider>
      <Session />
    </AuthProvider>
  );
}

// Inside the provider on purpose. A 401 has to END the session, and only
// something under AuthProvider can do that — which is why the handler used to
// live in App and clear the persisted view state and nothing else.
function Session() {
  const navigate = useNavigate();
  const { endSession } = useAuth();

  // A 401 mid-use ends the session rather than only redirecting.
  //
  // It used to purge the view state and navigate, leaving the token in
  // localStorage, the Authorization header on the axios client, and `user`
  // populated in context. So the app stayed signed in behind the login
  // screen: anything already mounted carried on making requests with the
  // dead credential, and whoever sat down next inherited that state.
  const handleUnauthorized = useCallback(() => {
    endSession();
    navigate('/login', { replace: true });
  }, [endSession, navigate]);

  return (
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
