import { apiClient } from './apiClient';

export async function authStatus() {
  const { data } = await apiClient.get('/api/auth/status', { skipAuthRedirect: true, silent: true });
  return data;
}

export async function loginRequest(email, password) {
  const { data } = await apiClient.post(
    '/api/auth/login',
    { email, password },
    { skipAuthRedirect: true },
  );
  return data;
}

export async function signupRequest(email, password, name) {
  const { data } = await apiClient.post(
    '/api/auth/signup',
    { email, password, name },
    { skipAuthRedirect: true },
  );
  return data;
}

export async function getCurrentUser() {
  const { data } = await apiClient.get('/api/auth/me', { skipAuthRedirect: true, silent: true });
  return data;
}

// --- password reset -------------------------------------------------------
//
// These replace forgotPasswordRequest(email, newPassword), which POSTed a new
// password to an unauthenticated endpoint that then set it. Renamed rather
// than kept with a discarded second argument: the next reader of
// `forgotPassword(email, password)` would reasonably assume it still sets a
// password, and renaming makes every stale call site fail at build time
// instead of silently doing nothing.
//
// All three pass skipAuthRedirect and silent. Without skipAuthRedirect a 401
// reaches Session()'s handler in main.jsx, which ends the session and
// navigates to /login — teleporting the user off the reset page with no
// explanation. Without silent, the interceptor also fires the global error
// listener, so the same sentence appears inline AND as a toast that floats
// away.
export async function requestPasswordReset(email) {
  const { data } = await apiClient.post(
    '/api/auth/forgot-password',
    { email },
    { skipAuthRedirect: true, silent: true },
  );
  return data;
}

export async function checkResetToken(token) {
  const { data } = await apiClient.post(
    '/api/auth/reset-password/check',
    { token },
    { skipAuthRedirect: true, silent: true },
  );
  return data;
}

// The token travels in the JSON BODY. Never in the URL — it would land in
// every reverse-proxy access log along the way, and in the axios request URL —
// and never in a header, which would collide with setAuthHeader's
// instance-wide default and leak the reset token onto every subsequent request
// the tab makes.
export async function resetPassword(token, newPassword) {
  const { data } = await apiClient.post(
    '/api/auth/reset-password',
    { token, newPassword },
    { skipAuthRedirect: true, silent: true },
  );
  return data;
}

// Self-service profile. Separate from the admin user routes in brevoApi:
// these only ever act on the caller, and the server enforces that by scoping
// every write to req.user.id rather than to an id in the payload.
export async function updateProfile(payload) {
  const { data } = await apiClient.patch('/api/auth/profile', payload);
  return data;
}

export async function changeOwnPassword(currentPassword, newPassword, signOutOthers = false) {
  // silent: the panel renders the failure inline, next to the field that
  // caused it. Without this the axios interceptor ALSO fires the global
  // error listener, so "Your current password is not correct." appears
  // twice — once where it belongs and once as a toast that floats away.
  const { data } = await apiClient.post('/api/auth/password', {
    currentPassword,
    newPassword,
    signOutOthers,
  }, { silent: true });
  return data;
}
