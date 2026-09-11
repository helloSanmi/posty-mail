// Guards the fix for a CSS bug that had no business being as damaging as it
// was, and which is easy to reintroduce because the broken version looks
// more correct.
//
// animations.css used `animation-fill-mode: both` on the card entrance. The
// forwards half of `both` keeps the final keyframe applied after the
// animation ends, and that keyframe carries `transform: translateY(0)` —
// which computes to matrix(1,0,0,1,0,0), a transform, not `none`. Per the
// CSS Transforms spec, any transform other than `none` makes the element a
// containing block for its `position: fixed` descendants.
//
// So every `.surface` on screen silently captured the fixed positioning of
// anything inside it:
//   - the Groups rail rendered its "New group" dialog as a 258x46 strip
//     inside the rail instead of a centred, full-viewport overlay;
//   - the contacts table, role editor and template editor did the same to
//     their dialogs;
//   - the template editor's fullscreen HTML editor expanded to fill its
//     300px control panel rather than the viewport.
//
// `backwards` keeps what the stagger needs (the element holds the `from`
// frame during its animation-delay, so a delayed card does not flash in
// early) and drops only the forwards fill, after which the element reverts
// to its own styles — opacity 1 and no transform, exactly what the `to`
// frame was painting. Identical visually, minus the containing block.
//
// Dialogs are also portaled to <body> now (components/Modal.jsx), so they
// are safe even if a transform is deliberately introduced later. This test
// covers the other fixed-position overlays, which are not portaled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  fileURLToPath(new URL('../src/styles/animations.css', import.meta.url)),
  'utf8',
);

// Every `animation:` shorthand declaration in the file, with comments
// stripped first so the explanation above a rule cannot satisfy a match.
function animationDeclarations(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim());
}

const TRANSFORMING = ['posty-slide-up', 'posty-scale-in'];

test('no animation keeps a forwards fill', () => {
  const offenders = animationDeclarations(css)
    .filter((decl) => /\b(both|forwards)\b/.test(decl));
  assert.deepEqual(
    offenders,
    [],
    'A forwards fill leaves the last keyframe applied. Where that keyframe '
      + 'sets a transform it makes the element a containing block for fixed '
      + 'descendants, which is what broke every dialog rendered inside a card. '
      + 'Use `backwards`.',
  );
});

test('the transform-carrying animations are the ones that mattered', () => {
  // If these keyframes stop animating transform the rule above is merely
  // tidy rather than load-bearing, and this test should be revisited.
  TRANSFORMING.forEach((name) => {
    const block = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{[\\s\\S]*?\\n\\}`));
    assert.ok(block, `${name} keyframes not found`);
    assert.match(block[0], /transform:/, `${name} no longer animates transform`);
  });
});

test('entrance animations still use a backwards fill for the stagger', () => {
  // Losing `backwards` would make staggered cards visible at full opacity
  // during their delay, then animate in — a flash, which is the thing the
  // original `both` was reaching for.
  const decls = animationDeclarations(css)
    .filter((decl) => TRANSFORMING.some((name) => decl.includes(name)));
  assert.ok(decls.length > 0, 'expected transform-based entrance animations');
  decls.forEach((decl) => {
    assert.match(decl, /\bbackwards\b/, `missing backwards fill: ${decl}`);
  });
});
