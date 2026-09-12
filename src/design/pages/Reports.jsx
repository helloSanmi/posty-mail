import { useState } from 'react';
import { ArrowRight, ExternalLink, RefreshCw } from 'lucide-react';
import './reports.css';

// Reports, redesigned. Seven surfaces and six headings become four
// surfaces and three headings.
//
// WHAT WAS CUT
//
// The engagement funnel. Its Sent / Opens / Clicks counts were byte-for-
// byte the same figures as the summary band two rows above, and its first
// bar was always 100% wide labelled "100.0%" — a percentage that is a
// constant. Only the step-to-step drop-off was new, so that survives as a
// one-line strip along the band's bottom edge.
//
// The standalone "Recent activity" log. The drill-down panel already
// rendered the same events with four more fields and a hundred-row cap, so
// the log was a strictly poorer duplicate costing a heading and a surface.
//
// The "Showing" label — a dangling verb with no object, set at the same
// size as the buttons it introduced.
//
// WHERE THE COLOUR WENT
//
// The single most saturated colour on the page used to fill a range pill
// at the very top, while opens, clicks, bounces and unsubscribes — the
// things the page is actually about — rendered in grey. Colour was loudest
// where it meant least. The active range is now weight, not hue, and the
// accent is reserved for opens. Every metric carries its product-wide
// identity: opens accent, clicks success, bounces danger, unsubscribes
// warn — the same colours they carry on Home and in the campaign table.
//
// Delta chips went neutral on purpose. Green fired both on rising opens
// and on falling bounces, so one colour carried two unrelated meanings and
// landed green on the danger-identity metric. Once each column is
// identity-coloured the reader already knows which direction is good.

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'all', label: 'All time' },
];

const METRICS = [
  { key: 'sent', label: 'Sent', value: '12,481', rate: null, delta: null, tone: null },
  { key: 'opens', label: 'Opens', value: '4,043', rate: '32.4%', delta: '+2.1', tone: 'accent' },
  { key: 'clicks', label: 'Clicks', value: '501', rate: '4.0%', delta: '+0.4', tone: 'success' },
  { key: 'bounces', label: 'Bounces', value: '37', rate: '0.3%', delta: '−0.1', tone: 'danger' },
  { key: 'unsubs', label: 'Unsubscribed', value: '18', rate: '0.14%', delta: '+0.02', tone: 'warn' },
];

const CAMPAIGNS = [
  { name: 'September newsletter', when: '3 Sep', sent: '4,120', open: '43.1%', opens: '1,776', click: '9.2%', clicks: '379', bounce: '0.2%', bounces: '8' },
  { name: 'Autumn offer — cohort B', when: '11 Sep', sent: '2,860', open: '38.4%', opens: '1,098', click: '7.7%', clicks: '220', bounce: '0.3%', bounces: '9', state: 'running' },
  { name: 'August roundup', when: '1 Aug', sent: '3,980', open: '29.1%', opens: '1,158', click: '2.1%', clicks: '84', bounce: '0.2%', bounces: '8' },
  { name: 'Re-engagement', when: '28 Aug', sent: '3,297', open: '11.2%', opens: '369', click: '1.1%', clicks: '36', bounce: '1.1%', bounces: '37', state: 'errors' },
];

const LINKS = [
  { url: 'https://usecomplier.com/pricing', count: 184 },
  { url: 'https://usecomplier.com/blog/soc2-in-90-days', count: 121 },
  { url: 'https://usecomplier.com/book-a-demo', count: 96 },
  { url: 'https://usecomplier.com/changelog', count: 54 },
  { url: 'https://usecomplier.com/docs/getting-started', count: 31 },
];

const EVENTS = [
  { kind: 'Opened', tone: 'accent', who: 'amara.okafor@example.com', campaign: 'September newsletter', when: '12s' },
  { kind: 'Clicked', tone: 'success', who: 'j.whitfield@example.org', campaign: 'Autumn offer — cohort B', when: '4m' },
  { kind: 'Opened', tone: 'accent', who: 'r.mensah@example.com', campaign: 'September newsletter', when: '11m' },
  { kind: 'Bounced', tone: 'danger', who: 'old-address@example.net', campaign: 'Re-engagement', when: '38m' },
  { kind: 'Unsubscribed', tone: 'warn', who: 'k.lindqvist@example.se', campaign: 'Re-engagement', when: '1h' },
  { kind: 'Delivered', tone: 'muted', who: 'dev.patel@example.co.uk', campaign: 'Autumn offer — cohort B', when: '1h' },
];

// Fourteen days. Fixed sample so two screenshots compare.
const DAYS = [
  [38, 9], [52, 14], [44, 11], [61, 19], [58, 16], [72, 24], [49, 12],
  [66, 21], [81, 29], [74, 23], [55, 15], [69, 22], [88, 31], [79, 26],
];

export function Reports() {
  const [range, setRange] = useState('7d');
  const [drill, setDrill] = useState(null);

  const drilled = METRICS.find((m) => m.key === drill);
  const events = drill && drill !== 'all'
    ? EVENTS.filter((e) => e.tone === drilled?.tone)
    : EVENTS;

  return (
    <>
      {/* One control row. The range used to own a full-width sectioning
          landmark plus a "Showing" label, pushing the numbers it scopes
          about 64px down the page. Scope and figures are now one object. */}
      <div className="rp-controls">
        <div className="rp-ranges" role="radiogroup" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              className={`rp-range${range === r.id ? ' is-active' : ''}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="rp-spacer" />
        {/* Replaces a whole surface whose only unique content was "is the
            webhook firing". One line answers it on every range. */}
        <span className="rp-health">
          <span className="rp-health-dot" aria-hidden="true" />
          Last event 4m ago
        </span>
        <button type="button" className="rp-icon-btn" aria-label="Refresh" title="Refresh">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <section className="rp-band">
        <div className="rp-metrics">
          {METRICS.map((m) => {
            const isSent = m.tone === null;
            const Tag = isSent ? 'div' : 'button';
            return (
              <Tag
                key={m.key}
                type={isSent ? undefined : 'button'}
                className={`rp-metric${m.tone ? ` is-${m.tone}` : ' is-plain'}${drill === m.key ? ' is-drilled' : ''}`}
                aria-pressed={isSent ? undefined : drill === m.key}
                onClick={isSent ? undefined : () => setDrill(drill === m.key ? null : m.key)}
              >
                <span className="rp-metric-label">{m.label}</span>
                <strong className="rp-metric-value">{m.value}</strong>
                <span className="rp-metric-foot">
                  {m.rate && <span className="rp-metric-rate">{m.rate}</span>}
                  {m.delta && <span className="rp-delta">{m.delta}</span>}
                </span>
              </Tag>
            );
          })}
        </div>
        {/* All that survived the funnel: the only two numbers it had that
            the band above did not already show. */}
        <div className="rp-dropoff">
          <span>Sent <ArrowRight size={12} aria-hidden="true" /> Opened <b>32.4%</b></span>
          <span>Opened <ArrowRight size={12} aria-hidden="true" /> Clicked <b>12.4%</b></span>
          <span className="rp-spacer" />
          <button
            type="button"
            className={`rp-alllink${drill === 'all' ? ' is-active' : ''}`}
            aria-pressed={drill === 'all'}
            onClick={() => setDrill(drill === 'all' ? null : 'all')}
          >
            All events
          </button>
        </div>
      </section>

      {drill && (
        // Adjacent to the band on purpose: the tie between the pressed
        // column and the panel it opened is the whole interaction. The top
        // border takes the pressed metric's identity colour.
        <section className={`rp-drill${drilled ? ` is-${drilled.tone}` : ''}`}>
          <div className="rp-card-head">
            <h2>{drilled ? drilled.label : 'All events'}</h2>
            <span className="rp-count">{events.length} shown</span>
          </div>
          <table className="rp-table rp-events">
            <thead>
              <tr><th>Event</th><th>Recipient</th><th>Campaign</th><th>When</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.who}-${e.when}`}>
                  <td><span className={`rp-pill is-${e.tone}`}>{e.kind}</span></td>
                  <td className="rp-trunc">{e.who}</td>
                  <td className="rp-trunc rp-dim">{e.campaign}</td>
                  <td className="rp-dim rp-when">{e.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Campaign performance</h2>
          <span className="rp-count">4 campaigns</span>
        </div>
        <table className="rp-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="rp-num">Sent</th>
              <th className="rp-num">Opened</th>
              <th className="rp-num">Clicked</th>
              <th className="rp-num">Bounced</th>
            </tr>
          </thead>
          <tbody>
            {CAMPAIGNS.map((c) => (
              <tr key={c.name} className="rp-row">
                <td>
                  <span className="rp-cname">
                    {/* Status was a 110px column where almost every row
                        said "completed". It is now a dot, present only when
                        the row needs attention. */}
                    {c.state && <span className={`rp-state is-${c.state}`} aria-label={c.state} />}
                    <span className="rp-trunc">{c.name}</span>
                  </span>
                  <span className="rp-dim rp-when">{c.when}</span>
                </td>
                <td className="rp-num"><span className="rp-figure">{c.sent}</span></td>
                <td className="rp-num">
                  <span className="rp-figure is-accent">{c.open}</span>
                  <span className="rp-sub">{c.opens}</span>
                </td>
                <td className="rp-num">
                  <span className="rp-figure is-success">{c.click}</span>
                  <span className="rp-sub">{c.clicks}</span>
                </td>
                <td className="rp-num">
                  <span className="rp-figure is-danger">{c.bounce}</span>
                  <span className="rp-sub">{c.bounces}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Activity</h2>
          <span className="rp-count">Last 14 days</span>
        </div>
        {/* No legend: the bars carry the same two identities they carry in
            the band directly above, so a legend would relabel what the
            colour already says. */}
        <div className="rp-chart" role="img" aria-label="Opens and clicks per day over the last 14 days">
          {DAYS.map(([opens, clicks], i) => (
            <span className="rp-chart-col" key={`d${i}`} style={{ height: `${opens}%` }}>
              <span className="rp-chart-opens" />
              <span
                className="rp-chart-clicks"
                style={{ height: `${Math.round((clicks / opens) * 100)}%` }}
              />
            </span>
          ))}
        </div>
        <div className="rp-axis"><span>28 Aug</span><span>Today</span></div>
      </section>

      <section className="rp-card">
        <div className="rp-card-head">
          <h2>Top clicked links</h2>
        </div>
        <ul className="rp-links">
          {LINKS.map((l) => (
            <li key={l.url} className="rp-link">
              <a href={l.url} className="rp-link-url" onClick={(e) => e.preventDefault()}>
                <span className="rp-trunc">{l.url.replace(/^https?:\/\//, '')}</span>
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              <span className="rp-link-bar" aria-hidden="true">
                <span
                  className="rp-link-fill"
                  style={{ width: `${(l.count / LINKS[0].count) * 100}%` }}
                />
              </span>
              <span className="rp-link-count">{l.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
