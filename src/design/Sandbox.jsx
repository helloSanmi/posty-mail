import { useEffect, useState } from 'react';
import {
  ACCENTS, DEFAULT_ACCENT, DEFAULT_GROUND, GROUNDS, ROLES, applyTheme, resolveTheme,
} from './themes';
import { DESIGN_PAGES } from './pages';
import './sandbox.css';

// The review harness. Picks a page and a theme, renders the page, and gets
// out of the way.
//
// It needs no login and no backend: every page here is driven by fixtures,
// which is the point — redesigns can be reviewed (and screenshotted) without
// standing up the API or handing anyone credentials.

const STORAGE = 'posty.design.sandbox';

function readStored() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE) || '{}');
  } catch {
    return {};
  }
}

export function Sandbox() {
  const stored = readStored();
  const [page, setPage] = useState(stored.page || DESIGN_PAGES[0]?.key || 'tokens');
  const [ground, setGround] = useState(stored.ground || DEFAULT_GROUND);
  const [accent, setAccent] = useState(stored.accent || DEFAULT_ACCENT);

  useEffect(() => {
    applyTheme(ground, accent);
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify({ page, ground, accent }));
    } catch { /* private mode — the sandbox just forgets between reloads */ }
  }, [ground, accent, page]);

  const active = DESIGN_PAGES.find((p) => p.key === page);
  const Active = active?.component;
  const tokens = resolveTheme(ground, accent);

  return (
    <div className="sb-root">
      <div className="sb-bar">
        <div className="sb-brand">Posty <span>design sandbox</span></div>

        {DESIGN_PAGES.length > 0 && (
          <div className="sb-group">
            <span className="sb-label">Page</span>
            <div className="sb-seg">
              {DESIGN_PAGES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={page === p.key}
                  onClick={() => setPage(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sb-group">
          <span className="sb-label">Ground</span>
          <div className="sb-seg">
            {Object.entries(GROUNDS).map(([key, g]) => (
              <button
                key={key}
                type="button"
                aria-pressed={ground === key}
                onClick={() => setGround(key)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sb-group">
          <span className="sb-label">Accent</span>
          <div className="sb-swatches">
            {Object.entries(ACCENTS).map(([key, a]) => (
              <button
                key={key}
                type="button"
                className="sb-swatch"
                aria-pressed={accent === key}
                aria-label={a.label}
                title={a.label}
                style={{ '--swatch': (a[ground] || a.light).accent }}
                onClick={() => setAccent(key)}
              />
            ))}
          </div>
        </div>

        <div className="sb-spacer" />
        <span className="sb-note">Not the live app · nothing here ships until approved</span>
      </div>

      <div className="sb-stage">
        {Active ? <Active /> : <TokenSheet tokens={tokens} />}
      </div>
    </div>
  );
}

// Shown until the first page lands, and available afterwards as a check that
// every role resolves in both grounds.
function TokenSheet({ tokens }) {
  return (
    <>
      <div className="sb-empty">
        <strong>No redesigned pages yet.</strong>
        <span>
          Approved designs appear in the Page switcher above. Drop them in
          {' '}<code>src/design/pages/</code> and register them in{' '}
          <code>src/design/pages.js</code>.
        </span>
      </div>
      <div className="sb-tokens">
        {ROLES.map((role) => (
          <div key={role} className="sb-token">
            <span className="sb-token-chip" style={{ '--chip': tokens[role] || 'transparent' }} />
            <span className="sb-token-text">
              <span className="sb-token-name">{role}</span>
              <span className="sb-token-value">{tokens[role] || 'unset'}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
