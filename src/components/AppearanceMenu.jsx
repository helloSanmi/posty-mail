import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  ACCENTS, applyTheme, readTheme, setTheme,
} from '../theme';

// Theme and accent, in the topbar.
//
// This lived in Settings, which was wrong twice over. Everything else in
// Settings changes what the WORKSPACE does and is shared by everyone in it;
// this changes what one person sees on one device and is stored in their
// own localStorage. And it is a control you judge by looking — you pick a
// theme by seeing the page change, which means the page has to be in front
// of you, not replaced by a settings screen.
//
// Deliberately small: an icon that shows the current mode, and a panel with
// two rows. Both rows are native radiogroups, so arrow-key movement, the
// roving tab stop and the checked state come free and correct instead of
// being reimplemented on buttons.

const GROUNDS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [theme, setLocal] = useState(readTheme);
  const containerRef = useRef(null);

  // Re-apply what we read. Normally a no-op — the pre-paint script in
  // index.html got there first — but it keeps the control and the page in
  // agreement if that script ever does not run.
  useEffect(() => { applyTheme(theme); }, [theme]);

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

  const update = (patch) => setLocal(setTheme({ ...theme, ...patch }));
  const current = GROUNDS.find((g) => g.value === theme.ground) || GROUNDS[0];
  const Icon = current.icon;

  return (
    <div className="ap-menu" ref={containerRef}>
      <button
        type="button"
        className="sh-icon-btn"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Appearance: ${current.label}`}
        title="Appearance"
      >
        <Icon size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="ap-panel" role="dialog" aria-label="Appearance">
          <div className="ap-row">
            <span className="ap-label" id="ap-theme-label">Theme</span>
            <div className="ap-segment" role="radiogroup" aria-labelledby="ap-theme-label">
              {GROUNDS.map((ground) => {
                const GroundIcon = ground.icon;
                const isActive = theme.ground === ground.value;
                return (
                  <label
                    key={ground.value}
                    className={`ap-seg${isActive ? ' is-active' : ''}`}
                    title={ground.label}
                  >
                    <input
                      type="radio"
                      name="posty-ground"
                      value={ground.value}
                      checked={isActive}
                      onChange={() => update({ ground: ground.value })}
                      className="visually-hidden"
                    />
                    <GroundIcon size={14} aria-hidden="true" />
                    <span className="visually-hidden">{ground.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="ap-row">
            <span className="ap-label" id="ap-accent-label">Accent</span>
            <div className="ap-accents" role="radiogroup" aria-labelledby="ap-accent-label">
              {ACCENTS.map((accent) => {
                const isActive = theme.accent === accent.id;
                return (
                  <label
                    key={accent.id}
                    className={`ap-swatch${isActive ? ' is-active' : ''}`}
                    data-accent-preview={accent.id}
                    title={accent.label}
                  >
                    <input
                      type="radio"
                      name="posty-accent"
                      value={accent.id}
                      checked={isActive}
                      onChange={() => update({ accent: accent.id })}
                      className="visually-hidden"
                    />
                    <span className="ap-dot" aria-hidden="true" />
                    <span className="visually-hidden">{accent.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
