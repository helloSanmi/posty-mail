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
const SWEPT = ['base.css', 'templates.css', 'layout.css', 'pages.css', 'animations.css'];

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
  'pages.css': [
    // One Dark syntax highlighting: per-token meaning, not UI semantics.
    '#1e1f24', '#2c2e36', '#d6dae3', '#5b6172', '#e06c75', '#d19a66',
    '#98c379', '#5c6370', '#61afef',
    // Chart data-series identities. A --chart-1..n scale is the right fix.
    '#2563eb', '#15803d', '#93c5fd', '#86efac', '#cbd5e1',
    // The dark-mode preview toggle depicts darkness rather than carrying a
    // role; themed, it would invert and stop meaning "dark mode is on".
    '#15151a', '#fff',
    // Editor selection, and a control floating over customer email HTML.
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

test('the legacy colour-named aliases are gone for good', () => {
  // --line, --muted, --blue, --green and --amber were named for colours
  // rather than jobs, which is why the app could not be re-themed at all.
  // They existed only as a migration bridge and are now deleted; this
  // asserts nothing reintroduces one, in any stylesheet.
  const legacy = /var\(\s*--(line|muted|blue|green|amber)\s*\)/g;
  ['tokens.css', 'base.css', 'layout.css', 'pages.css', 'templates.css', 'animations.css']
    .forEach((name) => {
      const found = stripComments(css(name)).match(legacy) || [];
      assert.deepEqual(found, [], `${name} reintroduced ${found.join(', ')}`);
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

test('tinted borders are derived from their own family, at one percentage', () => {
  // These four cannot be hand-picked values again. They were, and both
  // failure modes showed up under measurement:
  //
  //   - drift from the fill. The *-soft tokens are more saturated than the
  //     panel backgrounds they replaced, because soft also backs the pills,
  //     where the family colour must clear 4.5:1 as text. Every border lost
  //     about 10% against its own fill; success reached 1.09:1.
  //   - drift from the ACCENT. --accent-border was one ground-level value
  //     while --accent-soft varies per accent, so the pair held only for
  //     the accent it happened to be picked against. On iris it was 1.19:1.
  //
  // Deriving each border from its own family's soft and strong tokens makes
  // both impossible, and a fourth accent correct for free. The ratio is
  // checked in the browser (jsdom cannot resolve color-mix); what is
  // checkable here is that the derivation is intact and uniform.
  const source = css('tokens.css');
  const families = ['accent', 'success', 'warn', 'danger'];
  const percentages = new Set();

  families.forEach((fam) => {
    const rule = new RegExp(
      `--${fam}-border:\\s*color-mix\\(in srgb, var\\(--${fam}\\) (\\d+)%, var\\(--${fam}-soft\\)\\)`,
    );
    const match = source.match(rule);
    assert.ok(
      match,
      `--${fam}-border must be derived as color-mix of --${fam} into `
        + `--${fam}-soft, not written as a literal.`,
    );
    percentages.add(match[1]);
  });

  assert.equal(
    percentages.size,
    1,
    `all four tinted borders must use the same percentage, got: ${[...percentages].join(', ')}`,
  );

  // Each family defines its border exactly once — a per-ground or
  // per-accent override would reintroduce exactly the drift this prevents.
  families.forEach((fam) => {
    const count = (source.match(new RegExp(`--${fam}-border:`, 'g')) || []).length;
    assert.equal(count, 1, `--${fam}-border is defined ${count} times; it must be defined once`);
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
