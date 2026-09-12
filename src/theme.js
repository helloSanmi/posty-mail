// Theme state: the ground — light, dark, or follow the system.
//
// The values live as ATTRIBUTES on <html>, not as inline custom properties,
// so tokens.css does the work and the theme survives with JavaScript
// disabled. This module only reads and writes the attributes plus
// localStorage; it owns no colours.
//
// The matching pre-paint script in index.html applies the stored choice
// before first paint. Without it the page renders light, then flips — which
// is worse on a dark theme than having no dark theme at all.

export const GROUNDS = ['system', 'light', 'dark'];
// The app has ONE accent. There is no picker any more: a palette chooser
// asks the reader to decide something the product should decide, and the
// colours it offered were doing nothing. The other hues from that palette
// are used in the app instead, where they carry meaning.
export const ACCENT = 'harbour';

export const DEFAULT_GROUND = 'system';


const STORAGE_GROUND = 'posty.theme';

function read(key, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    // Private mode, or storage blocked. The default is a correct answer.
    return fallback;
  }
}

export function readTheme() {
  return { ground: read(STORAGE_GROUND, GROUNDS, DEFAULT_GROUND) };
}

export function applyTheme({ ground }, root = document.documentElement) {
  // Transitions are suppressed across the swap. Two reasons, one cosmetic
  // and one a genuine bug:
  //
  //   - cosmetic: without it the entire interface cross-fades, every
  //     surface and every label easing between two themes at once.
  //   - the bug: an element that transitions a colour coming from a custom
  //     property does not re-resolve that property when only the property
  //     changes. It keeps painting its OLD colour indefinitely — measured
  //     on the admin tab strip, which stayed at the light theme's
  //     --text-muted (2.4:1 on a dark card) while a freshly created element
  //     with the same class painted correctly. Suppressing the transition
  //     for the frame of the swap makes the change a plain recalculation,
  //     which resolves correctly.
  root.setAttribute('data-theme-switching', '');

  // 'system' removes the attribute rather than writing a value, which is
  // what lets the prefers-color-scheme block in tokens.css take over. An
  // explicit choice writes the attribute and therefore beats the OS.
  if (ground === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', ground);

  // Flush the suppressed state before releasing it, then release after the
  // paint so transitions are live again for ordinary hovers.
  void root.offsetHeight;
  const release = () => root.removeAttribute('data-theme-switching');
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(release));
  } else {
    release();
  }
}

export function saveTheme({ ground }) {
  try {
    window.localStorage.setItem(STORAGE_GROUND, ground);
  } catch { /* nothing to do — the choice just will not persist */ }
}

export function setTheme(next) {
  applyTheme(next);
  saveTheme(next);
  return next;
}
