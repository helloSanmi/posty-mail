// Invariants for the colour sweep.
//
// The sweep replaces ~384 hardcoded colours across four stylesheets with
// semantic tokens. Its dangerous failure mode is invisible: a literal
// mapped to a role that happens to resolve to the same colour in the light
// theme and to a wrong one in dark. #fff alone appears 30 times split three
// ways — as a raised surface, as a label on an accent fill, and as text on
// a dark chip — and all three are #ffffff today.
//
// A browser fixture (test/ui/fixture.html) catches the rendered half of
// that: it computes WCAG ratios across both grounds and all three accents.
// It cannot run here, because jsdom does not resolve var() — any colour
// assertion in this file would be vacuous and would pass straight through
// a broken sweep.
//
// So these tests assert what CAN be checked from the text of the
// stylesheets: that swept files stay swept, that the legacy aliases shrink
// monotonically, and that the two category errors behind the #fff split
// cannot be committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function css(name) {
  return readFileSync(
    fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)),
    'utf8',
  );
}

// Stylesheets whose literals have been replaced. Add a file here in the
// same commit that sweeps it — that is what makes the sweep's progress a
// fact rather than a claim.
const SWEPT = ['base.css', 'templates.css', 'layout.css'];

// Literals that must NOT be tokenised, as exact strings. Kept exact rather
// than as a pattern so adding any other literal still fails: an allowlist
// that accepts a shape rather than a value stops being a gate.
const ALLOWED = {
  'templates.css': [
    // .logo-delete — a control floating over an uploaded logo, which is
    // customer content on a canvas that never themes. A themed token would
    // go dark over a light logo and vanish.
    'rgba(',
  ],
};

// Comments carry hex values as documentation (the old value, a rationale).
// Strip them before asserting, or the sweep can never be described.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g;

test('swept stylesheets contain no colour literals', () => {
  SWEPT.forEach((name) => {
    const allowed = ALLOWED[name] || [];
    const found = (stripComments(css(name)).match(LITERAL) || [])
      .filter((lit) => !allowed.includes(lit));
    assert.deepEqual(
      found,
      [],
      `${name} still has ${found.length} literal(s): ${found.join(', ')}. `
        + 'Every colour in a swept file comes from tokens.css, unless it is '
        + 'in the ALLOWED list with a reason.',
    );
  });
});

test('swept stylesheets no longer use the legacy aliases', () => {
  // --line, --muted, --blue, --green and --amber are named for colours
  // rather than jobs, which is why the app could not be re-themed. They
  // survive only to keep unswept files working; a swept file using one
  // means the sweep missed a line.
  const legacy = /var\(\s*--(line|muted|blue|green|amber)\s*\)/g;
  SWEPT.forEach((name) => {
    const found = stripComments(css(name)).match(legacy) || [];
    assert.deepEqual(found, [], `${name} still references ${found.join(', ')}`);
  });
});

test('accent-contrast is never used as a background or border', () => {
  // The #fff category error, mechanically. accent-contrast is the colour
  // of a LABEL sitting on an accent fill — in dark it is near-black ink.
  // Painting a surface with it produces a black card under light text.
  const bad = /(background(-color)?|border(-[a-z]+)?-?color?)\s*:[^;]*var\(\s*--accent-contrast\s*\)/g;
  ['base.css', 'layout.css', 'pages.css', 'templates.css'].forEach((name) => {
    const found = stripComments(css(name)).match(bad) || [];
    assert.deepEqual(found, [], `${name}: ${found.join(' | ')}`);
  });
});

test('surface roles are never used as a text colour', () => {
  // The same error in the other direction: a surface token on `color`
  // gives white-on-white in light and dark-on-dark in dark.
  const bad = /(^|[;{\s])color\s*:\s*var\(\s*--(surface|surface-raised|surface-sunken|bg)\s*\)/gm;
  ['base.css', 'layout.css', 'pages.css', 'templates.css'].forEach((name) => {
    const found = stripComments(css(name)).match(bad) || [];
    assert.deepEqual(found, [], `${name}: ${found.join(' | ')}`);
  });
});

test('tokens.css defines every role the sweep maps onto', () => {
  const source = css('tokens.css');
  const required = [
    'bg', 'surface', 'surface-raised', 'surface-sunken', 'surface-hover',
    'text', 'text-muted', 'text-subtle',
    'border', 'border-strong',
    'accent', 'accent-hover', 'accent-contrast', 'accent-soft',
    'success', 'success-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
    'accent-border', 'success-border', 'warn-border', 'danger-border',
    'inverse-surface', 'inverse-text', 'email-canvas', 'email-page',
    'shadow', 'scrim', 'scrim-soft', 'focus-ring',
  ];
  const missing = required.filter((role) => !source.includes(`--${role}:`));
  assert.deepEqual(missing, [], `tokens.css is missing: ${missing.join(', ')}`);
});

test('every role is defined in the dark ground as well as the light one', () => {
  // A role defined only at :root silently keeps its light value in dark —
  // the failure is a single wrong-coloured element, which is exactly the
  // kind of thing that ships.
  const source = css('tokens.css');
  const darkBlock = source.match(/html\[data-theme='dark'\]\s*\{[\s\S]*?\n\}/);
  assert.ok(darkBlock, 'no dark theme block found');

  // Accent roles come from the accent layer, and email-canvas is
  // deliberately identical in both grounds — it backs customer-authored
  // email HTML, which assumes a white page regardless of our theme.
  const fromAccentLayer = ['accent', 'accent-hover', 'accent-soft', 'focus-ring'];
  const lightOnly = ['email-canvas', 'email-page'];

  const lightBlock = source.match(/:root,\s*\nhtml\[data-theme='light'\]\s*\{[\s\S]*?\n\}/);
  assert.ok(lightBlock, 'no light theme block found');

  const roles = [...lightBlock[0].matchAll(/--([a-z-]+):/g)].map((m) => m[1]);
  const missing = roles.filter((r) => (
    !fromAccentLayer.includes(r)
    && !lightOnly.includes(r)
    && !darkBlock[0].includes(`--${r}:`)
  ));
  assert.deepEqual(missing, [], `defined in light but not dark: ${missing.join(', ')}`);
});
