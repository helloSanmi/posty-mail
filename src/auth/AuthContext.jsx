import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  authStatus,
  forgotPasswordRequest,
  getCurrentUser,
  loginRequest,
  signupRequest,
} from '../services/authApi';
import { setAuthHeader } from '../services/apiClient';
import { hasArea, hasAnyArea } from '../../shared/permissions.js';

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
            setToken(null);
            setUser(null);
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

  function logout() {
    setToken(null);
    setUser(null);
  }

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
    forgotPassword,
    // Area-level access checks, driven by the permissions the backend
    // resolved for this user's role. can('dashboard') is always true.
    can: (area) => hasArea(user?.permissions, area),
    canAny: (areas) => hasAnyArea(user?.permissions, areas),
  }), [token, user, hasUsers, openSignup, passwordResetEnabled, bootstrapping]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
