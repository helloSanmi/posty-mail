import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import {
  authStatus,
  forgotPasswordRequest,
  getCurrentUser,
  loginRequest,
  signupRequest,
} from '../services/authApi';
import { setAuthHeader } from '../services/apiClient';
import { clearPersistedViewState } from '../hooks/useViewState';
import { hasAnyArea, hasLevel } from '../../shared/permissions.js';

const TOKEN_KEY = 'campaign-suite-token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => window.localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [hasUsers, setHasUsers] = useState(true);
  const [openSignup, setOpenSignup] = useState(false);
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    setAuthHeader(token);
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const status = await authStatus();
        if (cancelled) return;
        setHasUsers(status.hasUsers);
        setOpenSignup(status.openSignup);
        setPasswordResetEnabled(status.passwordResetEnabled !== false);
      } catch {
        // server may be unreachable. Let pages handle that
      }

      if (token) {
        try {
          const me = await getCurrentUser();
          if (!cancelled) setUser(me.user);
        } catch {
          if (!cancelled) {
            // An expired token found at PAGE LOAD is the shared-machine case
            // the purge exists for, and it was the one path that skipped it.
            // User A leaves a tab open overnight with an IP typed into the
            // audit search; the token expires; user B reloads that tab in the
            // morning and the search term is still there, because nothing
            // between "token rejected" and the login screen cleared it.
            endSession();
          }
        }
      }

      if (!cancelled) setBootstrapping(false);
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function login(email, password) {
    const result = await loginRequest(email, password);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }

  async function signup(email, password, name) {
    const result = await signupRequest(email, password, name);
    setToken(result.token);
    setUser(result.user);
    setHasUsers(true);
    return result.user;
  }

  // Everything that ends a session goes through here: the sign-out button,
  // a token rejected at boot, and a 401 mid-use. Before, each did a different
  // subset — sign-out cleared the token and the view state, boot cleared the
  // token only, and the 401 handler cleared the view state but left the token,
  // the Authorization header and `user` in place, so the app stayed signed in
  // behind the login screen.
  // useCallback with no deps: it only touches state setters, which React
  // guarantees are stable. The identity matters because the 401 handler is
  // built from it and handed to UiProvider, which subscribes in an effect —
  // an unstable identity would tear down and re-register that subscription
  // on every single render.
  const endSession = useCallback(() => {
    setToken(null);
    setUser(null);
    clearPersistedViewState();
  }, []);

  // After a self-service profile save. The server returns the updated user,
  // so this takes it rather than refetching — and it has to go through the
  // provider, or the topbar keeps showing the old name until a reload.
  function applyUser(next) {
    setUser(next);
  }

  // The theme and the sidebar width are deliberately kept by endSession:
  // those belong to the screen someone is sitting at, not to the account.
  // Stable for the same reason endSession is: the context value is memoised,
  // and an unstable member would rebuild it on every render, which defeats
  // the memo for every consumer.
  const logout = useCallback(() => { endSession(); }, [endSession]);

  async function forgotPassword(email, newPassword) {
    return forgotPasswordRequest(email, newPassword);
  }

  const value = useMemo(() => ({
    token,
    user,
    hasUsers,
    openSignup,
    passwordResetEnabled,
    bootstrapping,
    login,
    signup,
    logout,
    endSession,
    applyUser,
    forgotPassword,
    // Access checks, driven by the permissions the backend resolved for this
    // user's role. can('dashboard') is always true.
    //
    // `can(area)` still means "can open this at all" (read or better), so
    // every existing call site keeps its meaning. `can(area, 'write')` and
    // `can(area, 'manage')` are the new question — used to hide a Send
    // button from someone who can build a campaign but not send it.
    //
    // These only decide what is DRAWN. The server decides what is allowed;
    // a hidden button is a courtesy, not a control.
    can: (area, level = 'read') => hasLevel(user?.permissions, area, level),
    canAny: (areas) => hasAnyArea(user?.permissions, areas),
    // endSession is stable (useCallback, no deps) so listing it changes
    // nothing; logout is not, but it only ever calls endSession, so its
    // identity carries no state. Both are listed rather than suppressed,
    // because a suppressed dependency list is where a genuinely stale
    // closure hides next time.
  }), [
    token, user, hasUsers, openSignup, passwordResetEnabled, bootstrapping,
    endSession, logout,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
