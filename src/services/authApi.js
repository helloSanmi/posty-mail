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
