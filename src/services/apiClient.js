import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4010';
const TOKEN_KEY = 'campaign-suite-token';

export const apiClient = axios.create({ baseURL: API_URL });

let activeRequests = 0;
const loadingListeners = new Set();
const errorListeners = new Set();
const unauthorizedListeners = new Set();

function emitLoading() {
  loadingListeners.forEach((listener) => listener(activeRequests > 0));
}

export function onLoadingChange(listener) {
  loadingListeners.add(listener);
  return () => loadingListeners.delete(listener);
}

export function onApiError(listener) {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function setAuthHeader(token) {
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common.Authorization;
  }
}

setAuthHeader(window.localStorage.getItem(TOKEN_KEY));

apiClient.interceptors.request.use((config) => {
  activeRequests += 1;
  emitLoading();
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    activeRequests = Math.max(0, activeRequests - 1);
    emitLoading();
    return response;
  },
  (error) => {
    activeRequests = Math.max(0, activeRequests - 1);
    emitLoading();

    const status = error.response?.status;
    const message = error.response?.data?.error || error.message || 'Request failed';

    if (status === 401 && !error.config?.skipAuthRedirect) {
      unauthorizedListeners.forEach((listener) => listener());
    } else if (status && status >= 400 && !error.config?.silent) {
      errorListeners.forEach((listener) => listener({ status, message }));
    }

    return Promise.reject(error);
  },
);

export { API_URL };
