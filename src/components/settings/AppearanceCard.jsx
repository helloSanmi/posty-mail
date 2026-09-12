import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl } from '../SegmentedControl';
import { ACCENTS, applyTheme, readTheme, setTheme } from '../../theme';

// The only control in Settings that is not an account setting. Theme and
// accent are per-person and per-device: they live in localStorage, they are
// not sent anywhere, and two people sharing a workspace do not share them.
// That is also why this section carries no permission — an Editor who finds
// the light theme painful has the same claim on dark mode as an Owner.
//
// Every change applies on the spot rather than behind a Save. There is
// nothing to validate, nothing to fail, and the preview IS the product:
// picking a colour scheme from a written label and then confirming it is a
// worse way to choose than simply seeing the page change.

const GROUNDS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function AppearanceCard() {
  const [theme, setLocal] = useState(readTheme);
  const update = (patch) => setLocal(setTheme({ ...theme, ...patch }));

  // Re-apply what we read. The pre-paint script in index.html normally has
  // this done before React starts, and re-applying the same values is a
  // no-op. It matters when that script did NOT run — and the failure it
  // prevents is a nasty one: the control would sit there reporting "Dark"
  // while the page renders light, which reads as the setting being broken.
  useEffect(() => { applyTheme(theme); }, [theme]);

  return (
    <section className="surface appearance-card">
      <div className="appearance-head">
        <h3>Appearance</h3>
        <p className="status-line">Saved on this device, for you only.</p>
      </div>

      <div className="appearance-row">
        <span className="appearance-label" id="appearance-theme-label">Theme</span>
        <SegmentedControl
          value={theme.ground}
          options={GROUNDS}
          onChange={(ground) => update({ ground })}
        />
      </div>

      <div className="appearance-row">
        <span className="appearance-label" id="appearance-accent-label">Accent</span>
        {/* Native radios rather than buttons with roles: arrow-key movement
            within the group, the roving tab stop, and the checked state all
            come free and correct, instead of being reimplemented. */}
        <div
          className="accent-picker"
          role="radiogroup"
          aria-labelledby="appearance-accent-label"
        >
          {ACCENTS.map((accent) => (
            <label
              key={accent.id}
              className={`accent-swatch${theme.accent === accent.id ? ' is-active' : ''}`}
              data-accent-preview={accent.id}
            >
              <input
                type="radio"
                name="posty-accent"
                value={accent.id}
                checked={theme.accent === accent.id}
                onChange={() => update({ accent: accent.id })}
                className="visually-hidden"
              />
              <span className="accent-swatch-dot" aria-hidden="true" />
              <span>{accent.label}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
