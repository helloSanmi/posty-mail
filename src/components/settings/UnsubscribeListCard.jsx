import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  addUnsubscribe,
  getUnsubscribes,
  restoreUnsubscribe,
} from '../../services/brevoApi';
import { formatDate } from './formatDate';

// Suppression list management. Lists everyone permanently skipped on every
// campaign send, with an add-by-email input and a "Restore" action that
// re-subscribes a single address (removes from suppression + sets
// Contact.consent back to 'yes').
//
// Caps the visible list at 50 rows. The full list lives in the DB; for big
// installs we just show the most recent 50 with a "Showing 50 of N" hint
// rather than rendering thousands of rows.
export function UnsubscribeListCard({ notify }) {
  const [items, setItems] = useState([]);
  const [email, setEmail] = useState('');
  const inputId = useId();

  useEffect(() => {
    getUnsubscribes().then(setItems).catch(() => {});
  }, []);

  async function save() {
    try {
      const record = await addUnsubscribe({ email });
      setItems((prev) => [
        record,
        ...prev.filter((item) => item.email !== record.email),
      ]);
      setEmail('');
      notify('Unsubscribe saved');
    } catch (error) {
      notify(error.response?.data?.error || 'Could not save', 'error');
    }
  }

  async function restore(targetEmail) {
    try {
      await restoreUnsubscribe(targetEmail);
      setItems((prev) => prev.filter((item) => item.email !== targetEmail));
      notify(`${targetEmail} re-subscribed`);
    } catch (error) {
      notify(error.response?.data?.error || 'Could not restore', 'error');
    }
  }

  return (
    <section className="surface settings-card">
      <div className="settings-card-head">
        <div>
          <h3>Unsubscribe list</h3>
          <p className="muted">
            Everyone here is skipped on every send, whatever the audience.
          </p>
        </div>
        <span className="muted settings-count">{items.length} total</span>
      </div>
      <div className="inline-form">
        <label htmlFor={inputId} className="visually-hidden">
          Email to add to unsubscribe list
        </label>
        <input
          id={inputId}
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={!email}
        >
          Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="empty-state compact">No unsubscribes yet.</p>
      ) : (
        <ul className="unsubscribe-list">
          {items.slice(0, 50).map((item) => (
            <li key={item.email}>
              <div className="unsubscribe-meta">
                <strong>{item.email}</strong>
                <span className="muted">
                  {formatDate(item.unsubscribedAt)}
                  {item.reason ? ` · ${item.reason}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => restore(item.email)}
                title={`Re-subscribe ${item.email}. Removes from this list and sets consent back to yes`}
              >
                <RotateCcw size={13} aria-hidden="true" /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > 50 && (
        <small className="muted">Showing 50 of {items.length}.</small>
      )}
    </section>
  );
}
