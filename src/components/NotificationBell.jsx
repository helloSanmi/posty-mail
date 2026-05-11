import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { clearNotifications, getNotifications, markNotificationsRead } from '../services/brevoApi';
import { eventLabel, eventPill } from '../utils/brevoEvents';

const POLL_INTERVAL = 60_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unreadCount: 0 });
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  async function refresh() {
    setLoading(true);
    try {
      const result = await getNotifications();
      setData(result);
    } catch {
      // silent. Bell can be ignored when offline
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onOutside(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && data.unreadCount > 0) {
      // optimistic: zero the badge while we ask the server
      setData((prev) => ({ ...prev, unreadCount: 0 }));
      try {
        await markNotificationsRead();
      } catch {
        // rollback on failure
        refresh();
      }
    }
  }

  async function handleClear() {
    // Optimistic: empty the panel immediately so the user sees the action took.
    // Underlying Event rows stay; this is just a per-user view filter.
    setData({ items: [], unreadCount: 0 });
    try {
      await clearNotifications();
    } catch {
      // Rollback on failure.
      refresh();
    }
  }

  return (
    <div className="notif-bell" ref={containerRef}>
      <button
        type="button"
        className="notif-bell-button"
        onClick={handleToggle}
        aria-label={data.unreadCount ? `Notifications (${data.unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell size={16} aria-hidden="true" />
        {data.unreadCount > 0 && (
          <span className="notif-bell-badge" aria-hidden="true">
            {data.unreadCount > 9 ? '9+' : data.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-header">
            <strong>Notifications</strong>
            <div className="notif-panel-actions">
              <button type="button" className="text-button" onClick={refresh}>
                Refresh
              </button>
              {data.items.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={handleClear}
                  title="Hide all current items"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="notif-panel-body">
            {loading && data.items.length === 0 ? (
              <p className="muted notif-panel-empty">Loading…</p>
            ) : data.items.length === 0 ? (
              <p className="muted notif-panel-empty">No activity yet.</p>
            ) : (
              <ul>
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className={`notif-item${item.isUnread ? ' is-unread' : ''}`}
                  >
                    <span className={`pill ${eventPill(item.eventName)}`}>{eventLabel(item.eventName)}</span>
                    <span className="notif-item-body">
                      <strong>{item.email || item.provider}</strong>
                      <span className="muted">{formatDate(item.receivedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return value;
  }
}
