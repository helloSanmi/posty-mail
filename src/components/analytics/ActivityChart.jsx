// Stacked bar chart for daily engagement (opens + clicks) over the
// selected window. HTML/CSS grid instead of SVG so it stays sharp at
// any container width — the previous SVG version used
// preserveAspectRatio="none" which distorted lines and text once the
// parent grew past the viewBox width.
//
// Each bar is one calendar day. Opens stack on the bottom (blue),
// clicks on top (green). Hovering a bar shows a floating tooltip with
// the date + counts. Y-axis labels sit on the left edge; X-axis shows
// first / middle / last day. Empty days render as a faint baseline tick
// so the eye can still see the spacing even when nothing happened.
import { useMemo, useState } from 'react';

const OPEN_NAMES = new Set(['opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy']);
const CLICK_NAMES = new Set(['click', 'clicked', 'unique_clicked']);

// Local-time day key — toISOString would bucket past midnight UTC and
// shift events into the wrong day for non-UTC admins.
function isoDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Walk the range from `since` to `until` (or now) and tally opens +
// clicks per calendar day. Returns one entry per day with both metrics
// so we only iterate the events list once.
function bucketEvents(events, since, until) {
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);
  const end = new Date(until || Date.now());
  end.setHours(0, 0, 0, 0);
  const buckets = [];
  const indexByKey = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDay(d);
    indexByKey.set(key, buckets.length);
    buckets.push({ date: key, opens: 0, clicks: 0 });
  }
  events.forEach((event) => {
    const at = event.receivedAt;
    if (!at) return;
    const name = String(event.payload?.event || '').toLowerCase();
    if (!OPEN_NAMES.has(name) && !CLICK_NAMES.has(name)) return;
    const key = isoDay(new Date(at));
    const i = indexByKey.get(key);
    if (i == null) return;
    if (OPEN_NAMES.has(name)) buckets[i].opens += 1;
    else buckets[i].clicks += 1;
  });
  return buckets;
}

// Round a max value to the next "nice" round number so Y labels land
// on something readable (10 / 25 / 50 / 100) instead of "max=37".
function roundToNice(value) {
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  if (value <= 25) return 25;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatDayLabel(iso) {
  const [, m, d] = iso.split('-');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || '';
  return `${Number(d)} ${month}`;
}

function formatTooltipDate(iso) {
  const [y, m, d] = iso.split('-');
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1] || '';
  return `${month} ${Number(d)}, ${y}`;
}

export function ActivityChart({ events, since, until }) {
  // "All time" passes since=null — walk back to the earliest event so
  // the chart still has a starting boundary.
  const effectiveSince = useMemo(() => {
    if (since) return since;
    const earliest = events.reduce((min, event) => {
      const at = event.receivedAt ? new Date(event.receivedAt) : null;
      if (!at) return min;
      if (!min || at < min) return at;
      return min;
    }, null);
    return earliest;
  }, [events, since]);

  const buckets = useMemo(
    () => (effectiveSince ? bucketEvents(events, effectiveSince, until) : []),
    [events, effectiveSince, until],
  );

  const [hoverIndex, setHoverIndex] = useState(null);

  if (buckets.length === 0) {
    return <p className="empty-state compact">No engagement events in this window.</p>;
  }

  const peak = buckets.reduce((m, b) => Math.max(m, b.opens + b.clicks), 0);
  const niceMax = roundToNice(Math.max(1, peak));
  const yGridValues = [0, Math.round(niceMax / 2), niceMax];

  // Show first / middle / last day labels on the X-axis. Anything more
  // and the labels collide on narrow viewports.
  const xLabelIndices = buckets.length <= 1
    ? [0]
    : [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1];

  return (
    <div className="activity-chart">
      <div className="activity-chart-legend">
        <span><i className="activity-chart-swatch is-opens" aria-hidden="true" /> Opens</span>
        <span><i className="activity-chart-swatch is-clicks" aria-hidden="true" /> Clicks</span>
      </div>

      <div className="activity-chart-frame">
        {/* Y-axis gridlines + labels. Absolute-positioned by percent of
            chart height so they line up with bar heights computed the
            same way below. */}
        <div className="activity-chart-grid" aria-hidden="true">
          {yGridValues.map((value) => (
            <div
              key={value}
              className="activity-chart-gridline"
              style={{ bottom: `${(value / niceMax) * 100}%` }}
            >
              <span className="activity-chart-axis">{value}</span>
            </div>
          ))}
        </div>

        {/* Bar grid — N equal columns. Each cell is a stacked bar with
            a thin baseline tick when both metrics are 0, otherwise an
            opens segment (blue) plus a clicks segment (green) on top. */}
        <div
          className="activity-chart-bars"
          style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
        >
          {buckets.map((bucket, index) => {
            const total = bucket.opens + bucket.clicks;
            const opensHeight = (bucket.opens / niceMax) * 100;
            const clicksHeight = (bucket.clicks / niceMax) * 100;
            const isHovered = hoverIndex === index;
            return (
              <button
                key={bucket.date}
                type="button"
                className={`activity-chart-bar${isHovered ? ' is-hovered' : ''}`}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(index)}
                onBlur={() => setHoverIndex(null)}
                aria-label={`${formatTooltipDate(bucket.date)}: ${bucket.opens} opens, ${bucket.clicks} clicks`}
              >
                {total === 0 ? (
                  <span className="activity-chart-bar-empty" aria-hidden="true" />
                ) : (
                  <>
                    <span
                      className="activity-chart-bar-segment is-opens"
                      style={{ height: `${opensHeight}%` }}
                      aria-hidden="true"
                    />
                    <span
                      className="activity-chart-bar-segment is-clicks"
                      style={{ height: `${clicksHeight}%` }}
                      aria-hidden="true"
                    />
                  </>
                )}
                {isHovered && (
                  <div className="activity-chart-tooltip" role="tooltip">
                    <strong>{formatTooltipDate(bucket.date)}</strong>
                    <span><i className="activity-chart-swatch is-opens" aria-hidden="true" /> Opens <b>{bucket.opens}</b></span>
                    <span><i className="activity-chart-swatch is-clicks" aria-hidden="true" /> Clicks <b>{bucket.clicks}</b></span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* X-axis labels — first, middle, last. Same grid template as the
          bars so they align directly below their day. */}
      <div
        className="activity-chart-xaxis"
        style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {buckets.map((bucket, index) => (
          <span key={bucket.date} className="activity-chart-xlabel">
            {xLabelIndices.includes(index) ? formatDayLabel(bucket.date) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
