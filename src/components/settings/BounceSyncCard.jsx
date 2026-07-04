import { useEffect, useId, useState } from 'react';
import { getBounceSync, setBounceSync } from '../../services/brevoApi';
import { StatusPill } from './StatusPill';

// Toggle for "when Brevo reports a hard bounce / spam complaint, add the
// recipient to our suppression list automatically." Stored as a single
// boolean in the Setting table. Self-fetches the initial value on mount.
export function BounceSyncCard({ notify }) {
  const [enabled, setEnabled] = useState(false);
  const checkboxId = useId();

  useEffect(() => {
    getBounceSync()
      .then((data) => setEnabled(Boolean(data?.enabled)))
      .catch(() => {});
  }, []);

  async function toggle(next) {
    try {
      await setBounceSync(next);
      setEnabled(next);
      notify(next ? 'Bounces will auto-unsubscribe' : 'Bounce auto-sync disabled');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not update setting', 'error');
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Bounce auto-sync</h3>
          <p className="muted">
            Auto-suppress hard bounces, blocked addresses, and spam
            complaints so future sends skip them.
          </p>
        </div>
        <StatusPill ok={enabled} okLabel="On" emptyLabel="Off" />
      </div>
      <label className="checkbox-line" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        Enable bounce auto-sync
      </label>
    </section>
  );
}
