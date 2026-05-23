// Two-line activity chart for the Reports page. Buckets events by day
// across the selected window and draws opens + clicks as overlapping
// area-under-line curves. Hand-built SVG so the bundle doesn't pull
// chart.js + react-chartjs-2 just for one visualization. The same
// scaling logic could be reused for a hour-of-day version later.
import { useMemo } from 'react';

// Buckets `events` into one slot per calendar day between `since` and
// `until`, counting events that pass `matcher`. Returns
// [{ date: 'YYYY-MM-DD', count: number }] in chronological order.
// Both bounds are inclusive at the calendar-day level.
function bucketByDay(events, since, until, matcher) {
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);
  const end = new Date(until || Date.now());
  end.setHours(0, 0, 0, 0);
  const buckets = [];
  const indexByKey = new Map();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDay(d);
    indexByKey.set(key, buckets.length);
    buckets.push({ date: key, count: 0 });
  }
  events.forEach((event) => {
    if (!matcher(event)) return;
    const at = event.receivedAt;
    if (!at) return;
    const key = isoDay(new Date(at));
    const i = indexByKey.get(key);
    if (i != null) buckets[i].count += 1;
  });
  return buckets;
}

function isoDay(date) {
  // Local-time day key — using toISOString() would bucket past midnight
  // UTC and shift events into the wrong day for non-UTC admins.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Build an SVG <path d="..."> string from an array of {x, y} points,
// rendering as a line. Used for both the opens and clicks curves.
function buildLine(points) {
  if (!points.length) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

// Same point list, but closed into a filled area under the curve. Used
// for the subtle fill behind each line.
function buildArea(points, baselineY) {
  if (!points.length) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return [
    `M${first.x},${baselineY}`,
    ...points.map((p) => `L${p.x},${p.y}`),
    `L${last.x},${baselineY}`,
    'Z',
  ].join(' ');
}

export function ActivityChart({ events, since, until }) {
  // The chart needs a start date. "All time" passes since=null, in which
  // case we use the earliest event we have as the floor — otherwise
  // there's nothing to bucket.
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

  const buckets = useMemo(() => {
    if (!effectiveSince) return [];
    return ['opens', 'clicks'].reduce((acc, key) => {
      acc[key] = bucketByDay(events, effectiveSince, until, (event) => {
        const name = String(event.payload?.event || '').toLowerCase();
        if (key === 'opens') return ['opened', 'open', 'unique_opened', 'proxy_open', 'loadedbyproxy'].includes(name);
        return ['click', 'clicked', 'unique_clicked'].includes(name);
      });
      return acc;
    }, {});
  }, [events, effectiveSince, until]);

  if (!buckets.opens || buckets.opens.length === 0) {
    return <p className="empty-state compact">No engagement events in this window.</p>;
  }

  // Chart geometry. viewBox is fixed; the parent stretches via width:100%.
  const VIEW_WIDTH = 800;
  const VIEW_HEIGHT = 200;
  const PAD_LEFT = 32;
  const PAD_RIGHT = 12;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 26;
  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const days = buckets.opens.length;
  // Shared Y-scale so opens and clicks are comparable in the same chart.
  const maxValue = Math.max(
    1,
    ...buckets.opens.map((b) => b.count),
    ...buckets.clicks.map((b) => b.count),
  );
  // Three Y-gridlines: 0, mid, max. Rounded up to a nicer max where possible.
  const niceMax = roundToNice(maxValue);
  const yGridValues = [0, Math.round(niceMax / 2), niceMax];

  // Map a single day's count to chart coordinates.
  function toPoint(bucket, index) {
    const x = days <= 1
      ? PAD_LEFT + plotWidth / 2
      : PAD_LEFT + (index / (days - 1)) * plotWidth;
    const y = PAD_TOP + plotHeight - (bucket.count / niceMax) * plotHeight;
    return { x, y };
  }

  const opensPoints = buckets.opens.map(toPoint);
  const clicksPoints = buckets.clicks.map(toPoint);
  const baselineY = PAD_TOP + plotHeight;

  // X-axis labels: first, middle, last. Three is enough to give shape
  // without crowding the axis on narrow screens.
  const xLabelIndices = days <= 1 ? [0] : [0, Math.floor((days - 1) / 2), days - 1];

  return (
    <div className="activity-chart">
      <div className="activity-chart-legend">
        <span><i className="activity-chart-swatch is-opens" aria-hidden="true" /> Opens</span>
        <span><i className="activity-chart-swatch is-clicks" aria-hidden="true" /> Clicks</span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily opens and clicks over the selected period"
        className="activity-chart-svg"
      >
        {/* Gridlines + Y labels */}
        {yGridValues.map((value) => {
          const y = PAD_TOP + plotHeight - (value / niceMax) * plotHeight;
          return (
            <g key={value}>
              <line
                x1={PAD_LEFT}
                x2={VIEW_WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                className="activity-chart-grid"
              />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" className="activity-chart-axis">
                {value}
              </text>
            </g>
          );
        })}

        {/* Opens — drawn first so clicks render on top */}
        <path d={buildArea(opensPoints, baselineY)} className="activity-chart-area is-opens" />
        <path d={buildLine(opensPoints)} className="activity-chart-line is-opens" />

        {/* Clicks */}
        <path d={buildArea(clicksPoints, baselineY)} className="activity-chart-area is-clicks" />
        <path d={buildLine(clicksPoints)} className="activity-chart-line is-clicks" />

        {/* X-axis labels */}
        {xLabelIndices.map((i) => {
          const point = opensPoints[i];
          if (!point) return null;
          return (
            <text
              key={i}
              x={point.x}
              y={VIEW_HEIGHT - 8}
              textAnchor="middle"
              className="activity-chart-axis"
            >
              {formatDayLabel(buckets.opens[i].date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// Round a max value to the nearest "nice" round number so Y-axis labels
// land on something readable (10 / 25 / 50 / 100) instead of "max=37".
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
  // 'YYYY-MM-DD' → '12 May' style. Compact and readable.
  const [, m, d] = iso.split('-');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || '';
  return `${Number(d)} ${month}`;
}
