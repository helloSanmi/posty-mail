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

export async function forgotPasswordRequest(email, newPassword) {
  const { data } = await apiClient.post(
    '/api/auth/forgot-password',
    { email, newPassword },
    { skipAuthRedirect: true },
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
