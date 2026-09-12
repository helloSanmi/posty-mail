import { useEffect, useState } from 'react';
import {
  DEFAULT_DIRECTION, DEFAULT_GROUND, DIRECTIONS, ROLES,
  accentKeysFor, applyTheme, groundKeysFor, resolveTheme,
} from './themes';
import { DESIGN_PAGES } from './pages';
import './sandbox.css';

// The review harness. Picks a direction, a ground, an accent and a page,
// renders it, and gets out of the way.
//
// It needs no login and no backend: every page here is fixture-driven,
// which is the point — redesigns can be reviewed and screenshotted without
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
  const [direction, setDirection] = useState(stored.direction || DEFAULT_DIRECTION);
  const [ground, setGround] = useState(stored.ground || DEFAULT_GROUND);
  const [accent, setAccent] = useState(stored.accent || accentKeysFor(DEFAULT_DIRECTION)[0]);
  const [page, setPage] = useState(stored.page || DESIGN_PAGES[0]?.key || 'tokens');

  const grounds = groundKeysFor(direction);
  const accents = accentKeysFor(direction);
  // Switching direction can strand the current ground or accent — "Today"
  // has no dark theme and no Harbour. Fall back rather than render nothing.
  const safeGround = grounds.includes(ground) ? ground : grounds[0];
  const safeAccent = accents.includes(accent) ? accent : accents[0];

  useEffect(() => {
    applyTheme(direction, safeGround, safeAccent);
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify({
        direction, ground: safeGround, accent: safeAccent, page,
      }));
    } catch { /* private mode — the sandbox just forgets between reloads */ }
  }, [direction, safeGround, safeAccent, page]);

  const active = DESIGN_PAGES.find((p) => p.key === page);
  const Active = active?.component;
  const tokens = resolveTheme(direction, safeGround, safeAccent);
  const meta = DIRECTIONS[direction];

  return (
    <div className="sb-root">
      <div className="sb-bar">
        <div className="sb-brand">Posty <span>design sandbox</span></div>

        <div className="sb-group">
          <span className="sb-label">Direction</span>
          <div className="sb-seg">
            {Object.entries(DIRECTIONS).map(([key, d]) => (
              <button
                key={key}
                type="button"
                aria-pressed={direction === key}
                title={d.note}
                onClick={() => setDirection(key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sb-group">
          <span className="sb-label">Ground</span>
          <div className="sb-seg">
            {['light', 'dark'].map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={safeGround === key}
                disabled={!grounds.includes(key)}
                title={grounds.includes(key) ? undefined : `${meta.label} has no ${key} theme`}
                onClick={() => setGround(key)}
              >
                {key === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>

        <div className="sb-group">
          <span className="sb-label">Accent</span>
          <div className="sb-swatches">
            {accents.map((key) => {
              const a = meta.accents[key];
              const swatch = (a[safeGround] || a.light).accent;
              return (
                <button
                  key={key}
                  type="button"
                  className="sb-swatch"
                  aria-pressed={safeAccent === key}
                  aria-label={a.label}
                  title={a.label}
                  style={{ '--swatch': swatch }}
                  onClick={() => setAccent(key)}
                />
              );
            })}
          </div>
        </div>

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

        <div className="sb-spacer" />
        <span className="sb-note">Not the live app · nothing ships until approved</span>
      </div>

      <div className="sb-stage">
        {Active ? <Active /> : <TokenSheet tokens={tokens} note={meta.note} />}
      </div>
    </div>
  );
}

// Shown until a page is registered, and useful afterwards as a check that
// every role resolves in every direction and ground.
function TokenSheet({ tokens, note }) {
  return (
    <>
      <div className="sb-empty">
        <strong>{note}</strong>
        <span>Switch Direction, Ground and Accent above to compare. Every role below is live.</span>
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
