// Theme definitions for the design sandbox.
//
// Each theme is a flat map of SEMANTIC role -> hex. Roles are named for what
// they do, never for what colour they are: the current app has `--blue`,
// `--green` and `--amber`, which is why it cannot be re-themed — you cannot
// repoint `--blue` at a non-blue accent without the name lying.
//
// The accent is kept separate from the base theme so light/dark and
// accent-choice are two independent axes: 2 grounds x N accents, rather than
// 2N hand-maintained themes.
//
// Values land here once a direction is chosen. The sandbox reads this file
// and nothing else, so swapping a palette is a data edit.

export const ROLES = [
  'bg', 'surface', 'surface-raised', 'surface-sunken',
  'text', 'text-muted', 'text-subtle',
  'border', 'border-strong',
  'accent', 'accent-hover', 'accent-contrast', 'accent-soft',
  'success', 'success-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
  'shadow', 'scrim', 'focus-ring',
];

// Placeholder ground tones — replaced by the chosen direction. These are the
// app's CURRENT colours, so the sandbox opens showing today's look as the
// baseline to compare against.
export const GROUNDS = {
  light: {
    label: 'Light',
    tokens: {
      bg: '#f5f7f9',
      surface: '#ffffff',
      'surface-raised': '#ffffff',
      'surface-sunken': '#f1f4f8',
      text: '#1f2937',
      'text-muted': '#687386',
      'text-subtle': '#8a94a6',
      border: '#dfe5ec',
      'border-strong': '#c8d2de',
      success: '#17875f',
      'success-soft': '#e4f2ec',
      warn: '#a96500',
      'warn-soft': '#fbf0dd',
      danger: '#9f1d1d',
      'danger-soft': '#fdecec',
      shadow: 'rgba(15, 23, 42, 0.08)',
      scrim: 'rgba(15, 23, 42, 0.45)',
    },
  },
  dark: {
    label: 'Dark',
    tokens: {
      bg: '#0f1319',
      surface: '#161b23',
      'surface-raised': '#1c222c',
      'surface-sunken': '#11161d',
      text: '#e7ebf1',
      'text-muted': '#96a1b1',
      'text-subtle': '#6f7b8b',
      border: '#28303c',
      'border-strong': '#3a4553',
      success: '#4cb98c',
      'success-soft': '#142a22',
      warn: '#d69b3f',
      'warn-soft': '#2b2214',
      danger: '#e0736f',
      'danger-soft': '#2d1818',
      shadow: 'rgba(0, 0, 0, 0.45)',
      scrim: 'rgba(0, 0, 0, 0.6)',
    },
  },
};

// Accent options. Each supplies its own values per ground, because an accent
// that reads well on white is usually too dark on a near-black surface.
export const ACCENTS = {
  current: {
    label: 'Current blue',
    light: { accent: '#24599a', 'accent-hover': '#1d4a83', 'accent-contrast': '#ffffff', 'accent-soft': '#eaf0f8', 'focus-ring': 'rgba(36, 89, 154, 0.32)' },
    dark: { accent: '#7ba6dc', 'accent-hover': '#95b8e6', 'accent-contrast': '#0f1319', 'accent-soft': '#1b2733', 'focus-ring': 'rgba(123, 166, 220, 0.4)' },
  },
};

export const DEFAULT_GROUND = 'light';
export const DEFAULT_ACCENT = 'current';

// Flatten a ground + accent pair into the CSS custom properties the sandbox
// writes onto <html>. Accent wins on conflict, which is what lets one ground
// serve every accent.
export function resolveTheme(groundKey, accentKey) {
  const ground = GROUNDS[groundKey] || GROUNDS[DEFAULT_GROUND];
  const accent = ACCENTS[accentKey] || ACCENTS[DEFAULT_ACCENT];
  return { ...ground.tokens, ...(accent[groundKey] || accent.light) };
}

export function applyTheme(groundKey, accentKey, root = document.documentElement) {
  const tokens = resolveTheme(groundKey, accentKey);
  Object.entries(tokens).forEach(([role, value]) => {
    root.style.setProperty(`--${role}`, value);
  });
  root.setAttribute('data-theme', groundKey);
  root.setAttribute('data-accent', accentKey);
  // Lets the browser paint form controls, scrollbars and the canvas behind
  // the page in the right mode.
  root.style.colorScheme = groundKey === 'dark' ? 'dark' : 'light';
}
