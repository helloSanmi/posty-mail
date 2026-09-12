import './preview.css';

// The page CONTENT used inside the redesigned shell — metric tiles, a
// campaign table and the deliverability rows. The frame (sidebar, topbar)
// belongs to Shell.jsx, so this is only what sits inside it.
//
// It exists so the palette and the density rules can be judged on
// something that looks like the real product rather than on a swatch grid.

const TILES = [
  { label: 'Delivered', value: '12,481', delta: '+4.2%', tone: 'success' },
  { label: 'Opens', value: '5,309', delta: '+1.8%', tone: 'accent' },
  { label: 'Clicks', value: '1,142', delta: '+0.6%', tone: 'success' },
  { label: 'Bounces', value: '37', delta: '+0.4%', tone: 'danger' },
];

const ROWS = [
  { name: 'September newsletter', sent: '4,120', open: '43.1%', click: '9.2%', state: 'Completed', tone: 'success' },
  { name: 'Autumn offer — cohort B', sent: '2,860', open: '38.4%', click: '7.7%', state: 'Sending', tone: 'accent' },
  { name: 'Welcome sequence', sent: '1,204', open: '51.0%', click: '12.4%', state: 'Scheduled', tone: 'plum' },
  { name: 'Re-engagement', sent: '3,297', open: '11.2%', click: '1.1%', state: 'Errors', tone: 'warn' },
  { name: 'Product update draft', sent: '—', open: '—', click: '—', state: 'Draft', tone: 'muted' },
];

// Fourteen days of opens and clicks. Fixed sample, not generated — the
// sandbox must render identically every reload so two screenshots can be
// compared.
const ACTIVITY = [
  [38, 9], [52, 14], [44, 11], [61, 19], [58, 16], [72, 24], [49, 12],
  [66, 21], [81, 29], [74, 23], [55, 15], [69, 22], [88, 31], [79, 26],
];

const DNS = [
  { name: 'SPF', value: 'v=spf1 include:spf.brevo.com ~all', state: 'Pass', tone: 'success' },
  { name: 'DKIM', value: 'Signing at selector brevo1', state: 'Pass', tone: 'success' },
  { name: 'DMARC', value: 'Monitor only — nothing is enforced', state: 'Needs work', tone: 'warn' },
];

export function PreviewContent() {
  return (
    <>
      <section className="ds-tiles">
        {TILES.map((t) => (
          <div key={t.label} className={`ds-tile is-${t.tone}`}>
            <span className="ds-tile-label">{t.label}</span>
            <strong className="ds-tile-value">{t.value}</strong>
            <span className={`ds-delta is-${t.tone}`}>{t.delta}</span>
          </div>
        ))}
      </section>

      <section className="ds-card">
        <div className="ds-card-head">
          <h2>Engagement</h2>
          <span className="ds-legend">
            <span className="ds-legend-item is-accent">Opens</span>
            <span className="ds-legend-item is-success">Clicks</span>
          </span>
        </div>
        <div className="ds-chart" role="img" aria-label="Opens and clicks over the last 14 days">
          {ACTIVITY.map(([opens, clicks], i) => (
            // Clicks are a SUBSET of opens — you cannot click without
            // opening — so they stack rather than sit side by side. Paired
            // bars would read as two independent quantities and overstate
            // the day's total.
            <span className="ds-chart-col" key={`day-${i}`} style={{ height: `${opens}%` }}>
              <span className="ds-chart-bar is-opens" />
              <span
                className="ds-chart-bar is-clicks"
                style={{ height: `${Math.round((clicks / opens) * 100)}%` }}
              />
            </span>
          ))}
        </div>
        <div className="ds-chart-axis">
          <span>14 days ago</span>
          <span>Today</span>
        </div>
      </section>

      <section className="ds-card">
        <div className="ds-card-head">
          <h2>All campaigns</h2>
          <span className="ds-muted">5 of 28</span>
        </div>
        <table className="ds-table">
          <thead>
            <tr>
              <th>Campaign</th><th>Sent</th><th>Open</th><th>Click</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.name} className={`is-${r.tone}`}>
                <td>{r.name}</td>
                <td className="ds-num">{r.sent}</td>
                <td className="ds-num">{r.open}</td>
                <td className="ds-num">{r.click}</td>
                <td><span className={`ds-pill is-${r.tone}`}>{r.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="ds-card">
        <div className="ds-card-head">
          <h2>Domain authentication</h2>
          <span className="ds-pill is-warn">Needs attention</span>
        </div>
        <div className="ds-rows">
          {DNS.map((d) => (
            <div key={d.name} className={`ds-row is-${d.tone}`}>
              <span className="ds-row-label">
                <strong>{d.name}</strong>
                <span className="ds-muted">{d.value}</span>
              </span>
              <span className={`ds-pill is-${d.tone}`}>{d.state}</span>
            </div>
          ))}
        </div>
        <div className="ds-actions">
          <button type="button" className="ds-btn">Re-check</button>
          <button type="button" className="ds-btn ds-btn-primary">Fix DMARC</button>
        </div>
      </section>
    </>
  );
}
