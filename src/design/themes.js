// Theme definitions for the design sandbox.
//
// THREE AXES: direction x ground x accent.
//
// A "direction" is a whole palette point of view. A "ground" is light or
// dark within it. An "accent" is the brand hue the operator picks. Modelling
// them separately means three accents cost three entries, not six themes.
//
// Roles are named for what they DO, never for what colour they are. The live
// app has --blue, --green and --amber, which is exactly why it cannot be
// re-themed: nothing can repoint --blue at a teal accent without the name
// lying. These 22 roles are what the 107 distinct hex literals in
// src/styles collapse into.
//
// ACCENT-CONTRAST COMES FROM THE GROUND, NOT THE ACCENT. Both candidate
// directions' own accent specs declared `contrastOn: #FFFFFF` for every
// accent in both themes. Measured, white on their dark accents lands at
// 1.77-2.34:1 — unreadable button labels. Taking the contrast colour from
// the ground instead (white on light fills, near-black ink on dark fills)
// measures 8.0-10.8:1. So accents deliberately do NOT carry their own
// contrast value; the ground owns it.

export const ROLES = [
  'bg', 'surface', 'surface-raised', 'surface-sunken',
  'text', 'text-muted', 'text-subtle',
  'border', 'border-strong',
  'accent', 'accent-hover', 'accent-contrast', 'accent-soft',
  'success', 'success-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
  'shadow', 'scrim', 'focus-ring',
];

export const DIRECTIONS = {
  // Today's palette, as a baseline to compare against. Light only, because
  // the live app genuinely has no dark mode — showing an invented one here
  // would misrepresent what exists.
  current: {
    label: 'Today',
    note: 'The live app as it is now. Light only — there is no dark theme today.',
    grounds: {
      light: {
        bg: '#f5f7f9',
        surface: '#ffffff',
        'surface-raised': '#ffffff',
        'surface-sunken': '#f1f4f8',
        text: '#1f2937',
        'text-muted': '#687386',
        'text-subtle': '#8a94a6',
        border: '#dfe5ec',
        'border-strong': '#c8d2de',
        'accent-contrast': '#ffffff',
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
    accents: {
      blue: {
        label: 'Blue',
        light: { accent: '#24599a', 'accent-hover': '#1d4a83', 'accent-soft': '#eaf0f8', 'focus-ring': 'rgba(36, 89, 154, 0.32)' },
      },
    },
  },

  // Near-silent chrome; the colour is spent on data. Cards are not pure
  // white, which is what lets chart and status colour read as the brightest
  // thing on screen.
  slate: {
    label: 'Signal on Slate',
    note: 'Quiet chrome, colour spent on data. Each metric owns a fixed hue the operator learns once.',
    grounds: {
      light: {
        bg: '#E9EDF4',
        surface: '#F7F9FC',
        'surface-raised': '#FFFFFF',
        'surface-sunken': '#DDE4EE',
        text: '#14202F',
        'text-muted': '#4C5B6E',
        'text-subtle': '#58657A',
        border: '#D3DBE6',
        'border-strong': '#6F7E93',
        'accent-contrast': '#FFFFFF',
        success: '#0E7049',
        'success-soft': '#D8F0E3',
        warn: '#8A5A05',
        'warn-soft': '#FAEACB',
        danger: '#B02418',
        'danger-soft': '#FBE2DE',
        shadow: 'rgba(14, 27, 45, 0.12)',
        scrim: 'rgba(11, 23, 38, 0.72)',
      },
      dark: {
        bg: '#0E1620',
        surface: '#16202C',
        'surface-raised': '#1E2A38',
        'surface-sunken': '#090F17',
        text: '#E6EDF5',
        'text-muted': '#9FAEC0',
        'text-subtle': '#8796AB',
        border: '#263344',
        'border-strong': '#617790',
        'accent-contrast': '#071320',
        success: '#45C489',
        'success-soft': '#10301F',
        warn: '#E2A83C',
        'warn-soft': '#332409',
        danger: '#F27A6B',
        'danger-soft': '#3A1613',
        shadow: 'rgba(0, 6, 13, 0.55)',
        scrim: 'rgba(4, 9, 15, 0.84)',
      },
    },
    accents: {
      harbour: {
        label: 'Harbour',
        light: { accent: '#15608F', 'accent-hover': '#114F76', 'accent-soft': '#E1EDF6', 'focus-ring': '#1E7CB8' },
        dark: { accent: '#6FB4E6', 'accent-hover': '#93C9EF', 'accent-soft': '#123048', 'focus-ring': '#93C9EF' },
      },
      verdigris: {
        label: 'Verdigris',
        light: { accent: '#0F6675', 'accent-hover': '#0B525E', 'accent-soft': '#DCEEF1', 'focus-ring': '#0F6675' },
        dark: { accent: '#45BFD1', 'accent-hover': '#74D2E0', 'accent-soft': '#0C3138', 'focus-ring': '#74D2E0' },
      },
      iris: {
        label: 'Iris',
        light: { accent: '#4A50AE', 'accent-hover': '#3C4193', 'accent-soft': '#E7E8F8', 'focus-ring': '#4A50AE' },
        dark: { accent: '#9BA4F2', 'accent-hover': '#B6BCF7', 'accent-soft': '#1E2350', 'focus-ring': '#B6BCF7' },
      },
    },
  },

  // Ink-and-paper spine. The accent runs structurally through the sidebar
  // and rails, so changing it visibly rebrands the product.
  ink: {
    label: 'Postmark Ink',
    note: 'Accent runs structurally through the chrome, so switching it rebrands the product.',
    grounds: {
      light: {
        bg: '#E4EAF3',
        surface: '#F7F9FC',
        'surface-raised': '#FFFFFF',
        'surface-sunken': '#D8E1EE',
        text: '#131C2C',
        'text-muted': '#3F4D64',
        'text-subtle': '#54637B',
        border: '#C4D0E1',
        'border-strong': '#6A7B98',
        'accent-contrast': '#FFFFFF',
        success: '#146F4E',
        'success-soft': '#C9EBD9',
        warn: '#855405',
        'warn-soft': '#F5DFB4',
        danger: '#AB2318',
        'danger-soft': '#F7D8D3',
        shadow: 'rgba(22, 35, 58, 0.14)',
        scrim: 'rgba(11, 18, 32, 0.66)',
      },
      dark: {
        bg: '#0D1621',
        surface: '#15202E',
        'surface-raised': '#1C2937',
        'surface-sunken': '#080E16',
        text: '#E7EDF6',
        'text-muted': '#A7B5C8',
        'text-subtle': '#8797AE',
        border: '#29374A',
        'border-strong': '#64768F',
        'accent-contrast': '#0A1016',
        success: '#48CE8E',
        'success-soft': '#0F3A2B',
        warn: '#E3AA43',
        'warn-soft': '#3B2C0C',
        danger: '#F4796C',
        'danger-soft': '#4A231E',
        shadow: 'rgba(0, 4, 10, 0.8)',
        scrim: 'rgba(3, 7, 16, 0.88)',
      },
    },
    accents: {
      teal: {
        label: 'Ink Teal',
        light: { accent: '#0A6A6E', 'accent-hover': '#075457', 'accent-soft': '#C6E8E7', 'focus-ring': '#12325C' },
        dark: { accent: '#4ED6D0', 'accent-hover': '#7BE3DE', 'accent-soft': '#103A3E', 'focus-ring': '#C7DAF7' },
      },
      cobalt: {
        label: 'Cobalt',
        light: { accent: '#2A46B0', 'accent-hover': '#21388F', 'accent-soft': '#D9E0FA', 'focus-ring': '#2A46B0' },
        dark: { accent: '#8FAAFF', 'accent-hover': '#AFC3FF', 'accent-soft': '#1E2D59', 'focus-ring': '#AFC3FF' },
      },
      plum: {
        label: 'Plum',
        light: { accent: '#98235E', 'accent-hover': '#7C1B4C', 'accent-soft': '#F6D6E6', 'focus-ring': '#98235E' },
        dark: { accent: '#F58FC2', 'accent-hover': '#F9B0D5', 'accent-soft': '#521B3E', 'focus-ring': '#F9B0D5' },
      },
    },
  },
};

export const DEFAULT_DIRECTION = 'slate';
export const DEFAULT_GROUND = 'light';

export function accentKeysFor(directionKey) {
  return Object.keys(DIRECTIONS[directionKey]?.accents || {});
}

export function groundKeysFor(directionKey) {
  return Object.keys(DIRECTIONS[directionKey]?.grounds || {});
}

// Flatten direction + ground + accent into the custom properties written on
// <html>. The accent layers over the ground, but never supplies
// accent-contrast — see the note at the top of this file.
export function resolveTheme(directionKey, groundKey, accentKey) {
  const direction = DIRECTIONS[directionKey] || DIRECTIONS[DEFAULT_DIRECTION];
  const ground = direction.grounds[groundKey] || direction.grounds[groundKeysFor(directionKey)[0]];
  const accent = direction.accents[accentKey] || direction.accents[accentKeysFor(directionKey)[0]];
  const accentTokens = (accent && (accent[groundKey] || accent.light)) || {};
  return { ...ground, ...accentTokens };
}

export function applyTheme(directionKey, groundKey, accentKey, root = document.documentElement) {
  const tokens = resolveTheme(directionKey, groundKey, accentKey);
  ROLES.forEach((role) => root.style.removeProperty(`--${role}`));
  Object.entries(tokens).forEach(([role, value]) => root.style.setProperty(`--${role}`, value));
  root.setAttribute('data-theme', groundKey);
  root.setAttribute('data-direction', directionKey);
  root.setAttribute('data-accent', accentKey);
  // Lets the browser paint form controls, scrollbars and the overscroll
  // canvas in the right mode.
  root.style.colorScheme = groundKey === 'dark' ? 'dark' : 'light';
}
