import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onApiError, onLoadingChange, onUnauthorized } from '../services/apiClient';

const UiContext = createContext(null);

export function UiProvider({ children, onUnauthorized: onUnauthorizedCb }) {
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  const notify = useCallback((message, type = 'success') => {
    if (!message) return;
    setToast({ message, type, id: Date.now() + Math.random() });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const ttl = toast.type === 'error' ? 4500 : 2800;
    const timer = window.setTimeout(() => setToast(null), ttl);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => onLoadingChange(setLoading), []);

  useEffect(() => onApiError(({ message }) => notify(message, 'error')), [notify]);

  useEffect(() => onUnauthorized(() => {
    onUnauthorizedCb?.();
  }), [onUnauthorizedCb]);

  return (
    <UiContext.Provider value={{ notify }}>
      {loading && <div className="loading-bar" aria-hidden="true" />}
      {children}
      <div
        className="toast-region"
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        {toast && (
          <div className={`toast ${toast.type || 'success'}`}>
            {toast.message}
          </div>
        )}
      </div>
    </UiContext.Provider>
  );
}

export function useUi() {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside <UiProvider>');
  return context;
}
