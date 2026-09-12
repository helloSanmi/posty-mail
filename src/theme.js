// Theme state: a ground (light / dark / system) and an accent.
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
export const ACCENTS = [
  { id: 'harbour', label: 'Harbour' },
  { id: 'verdigris', label: 'Verdigris' },
  { id: 'iris', label: 'Iris' },
];

export const DEFAULT_GROUND = 'system';
export const DEFAULT_ACCENT = 'harbour';

const STORAGE_GROUND = 'posty.theme';
const STORAGE_ACCENT = 'posty.accent';

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
  return {
    ground: read(STORAGE_GROUND, GROUNDS, DEFAULT_GROUND),
    accent: read(STORAGE_ACCENT, ACCENTS.map((a) => a.id), DEFAULT_ACCENT),
  };
}

export function applyTheme({ ground, accent }, root = document.documentElement) {
  // 'system' removes the attribute rather than writing a value, which is
  // what lets the prefers-color-scheme block in tokens.css take over. An
  // explicit choice writes the attribute and therefore beats the OS.
  if (ground === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', ground);
  root.setAttribute('data-accent', accent);
}

export function saveTheme({ ground, accent }) {
  try {
    window.localStorage.setItem(STORAGE_GROUND, ground);
    window.localStorage.setItem(STORAGE_ACCENT, accent);
  } catch { /* nothing to do — the choice just will not persist */ }
}

export function setTheme(next) {
  applyTheme(next);
  saveTheme(next);
  return next;
}
