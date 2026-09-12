import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  ACCENTS, applyTheme, readTheme, setTheme,
} from '../theme';

// Theme and accent, in the topbar, on the surface.
//
// This lived in Settings, which was wrong twice over: everything else there
// changes what the WORKSPACE does and is shared by everyone in it, while
// this changes what one person sees on one device. And it is a control you
// judge by LOOKING — you pick a theme by watching the page change, so it
// has to sit on the page you are judging.
//
// It was then briefly behind an icon, which kept the second half of that
// problem: a control you choose by eye should not require a click to see
// its options when there is room to show all six. Six small controls fit
// the topbar, so all six are on it.
//
// Both groups are native radiogroups, so arrow-key movement, the roving tab
// stop and the checked state come free and correct instead of being
// reimplemented on buttons.

const GROUNDS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceControls() {
  const [theme, setLocal] = useState(readTheme);

  // Re-apply what we read. Normally a no-op — the pre-paint script in
  // index.html got there first — but it keeps the control and the page in
  // agreement if that script ever does not run.
  useEffect(() => { applyTheme(theme); }, [theme]);


  const update = (patch) => setLocal(setTheme({ ...theme, ...patch }));

  return (
    <div className="ap-controls">
      <div className="ap-segment" role="radiogroup" aria-label="Theme">
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

      <div className="ap-accents" role="radiogroup" aria-label="Accent colour">
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
  );
}
