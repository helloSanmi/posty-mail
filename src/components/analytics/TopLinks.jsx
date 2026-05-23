// Top clicked links across the selected period. Aggregates click events
// by their `payload.link` URL, sorts by count descending, and renders
// the top N with a visual bar so the leader is obvious at a glance.
// Practical insight: tells the admin which CTAs are pulling weight
// across campaigns, without having to drill into each one.
import { ExternalLink } from 'lucide-react';

const CLICK_NAMES = new Set(['click', 'clicked', 'unique_clicked']);

export function TopLinks({ events, limit = 8 }) {
  const aggregated = new Map();
  events.forEach((event) => {
    const eventName = String(event.payload?.event || '').toLowerCase();
    if (!CLICK_NAMES.has(eventName)) return;
    const url = event.payload?.link || event.payload?.url;
    if (!url) return;
    aggregated.set(url, (aggregated.get(url) || 0) + 1);
  });

  const ranked = Array.from(aggregated.entries())
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  if (!ranked.length) {
    return <p className="empty-state compact">No tracked clicks in this window.</p>;
  }

  const max = ranked[0].count;

  return (
    <ol className="top-links">
      {ranked.map((row, index) => {
        const widthPercent = max ? (row.count / max) * 100 : 0;
        return (
          <li key={row.url} className="top-links-row">
            <span className="top-links-rank">#{index + 1}</span>
            <div className="top-links-body">
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="top-links-url"
                title={row.url}
              >
                {summariseLink(row.url)}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
              <div className="top-links-bar" aria-hidden="true">
                <div className="top-links-bar-fill" style={{ width: `${widthPercent}%` }} />
              </div>
            </div>
            <span className="top-links-count">{row.count.toLocaleString()}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Same compaction logic as the drilldown link cell — strip the protocol,
// keep host + short path so the row stays one line.
function summariseLink(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path.length > 24 ? `${path.slice(0, 24)}…` : path}`;
  } catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url;
  }
}
