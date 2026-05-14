import { useEffect, useState } from 'react';
import { Key } from 'lucide-react';
import { getHealth } from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// Read-only status card. Hits /api/health on mount to learn whether the
// backend has a BREVO_API_KEY configured. No mutation here — the API key
// lives in the backend's .env, not the database, so the admin can't edit
// it from the UI. We just surface "is it set?" so they know whether real
// sends will go out or whether everything's in dry-run mode.
export function BrevoApiStatusCard() {
  // null = still loading. true / false = answered.
  const [brevoConfigured, setBrevoConfigured] = useState(null);

  useEffect(() => {
    getHealth()
      .then((data) => setBrevoConfigured(Boolean(data?.brevoConfigured)))
      .catch(() => setBrevoConfigured(false));
  }, []);

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3><Key size={16} aria-hidden="true" /> Brevo API key</h3>
          <p className="muted">Required to deliver email through Brevo.</p>
        </div>
        {brevoConfigured === null ? (
          <span className="pill muted">Checking…</span>
        ) : (
          <StatusPill
            ok={brevoConfigured}
            okLabel="Configured"
            emptyLabel="Not configured"
          />
        )}
      </div>
      {brevoConfigured === false && (
        <small className="muted">
          Add <code>BREVO_API_KEY=xkeysib-…</code> to your backend{' '}
          <code>.env</code> and restart the server. Until then, every send
          is a dry-run (logged, not delivered).
        </small>
      )}
    </section>
  );
}
