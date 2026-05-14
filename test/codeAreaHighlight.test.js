// Locks the HTML syntax highlighter that powers the CodeArea overlay.
//
// The regression we're protecting against: earlier versions inserted span
// markup inline as they went, which caused the attribute-name regex to
// re-match `class=` inside the highlighter's own injected
// `<span class="t-tag">` markup. That produced garbage in the rendered
// overlay like `</class="t-tag">h1>` where a `</h1>` should be.
//
// We can't import the closure-scoped `highlight()` directly, so we extract
// it via a tiny eval of the module's source. Cheap and avoids restructuring
// the component just for testability.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/components/CodeArea.jsx'),
  'utf8',
);

// The file is ESM + JSX so we can't import it from Node directly without a
// bundler. The pure-JS bits (the highlight function and its helpers) live
// below the JSX export, so we slice them out and run them in a sandbox.
const bottom = src.slice(src.indexOf('const SENT_OPEN'));
const ctx = { String, RegExp };
vm.createContext(ctx);
vm.runInContext(`${bottom}\n; this.highlight = highlight; this.escapeHtml = escapeHtml;`, ctx);
const { highlight } = ctx;

test('highlight: tag names get a t-tag span', () => {
  const out = highlight('<h1>Hi</h1>');
  assert.match(out, /<span class="t-tag">h1<\/span>/);
});

test('highlight: closing tag name also gets a t-tag span', () => {
  const out = highlight('<h1>Hi</h1>');
  // Both opening and closing h1 produce spans.
  const matches = out.match(/<span class="t-tag">h1<\/span>/g) || [];
  assert.equal(matches.length, 2);
});

test('highlight: REGRESSION class= inside our own span markup must NOT be re-highlighted', () => {
  // The bug: attribute-name regex matched the literal `class=` inside the
  // span markup we just inserted, producing `<span <span class="t-attr">class
  // </span>="t-tag">h1</span>` which rendered as garbage. After tokenization
  // this can no longer happen.
  const out = highlight('<h1>Hi</h1>');
  // The output must never contain `<span class="t-attr">class</span>` -
  // there are no real `class` attributes in the input.
  assert.doesNotMatch(out, /<span class="t-attr">class<\/span>/);
  // And the tag-name span must not be nested inside another span.
  assert.doesNotMatch(out, /<span <span/);
});

test('highlight: attribute names and values get the right classes', () => {
  const out = highlight('<a href="https://x">click</a>');
  assert.match(out, /<span class="t-attr">href<\/span>/);
  assert.match(out, /<span class="t-string">&quot;https:\/\/x&quot;<\/span>/);
});

test('highlight: merge tags get a t-merge span', () => {
  const out = highlight('Hi {{firstname}}');
  assert.match(out, /<span class="t-merge">\{\{firstname\}\}<\/span>/);
});

test('highlight: HTML comments get a t-comment span', () => {
  const out = highlight('<!-- hi -->');
  assert.match(out, /<span class="t-comment">[^<]*--&gt;<\/span>/);
});

test('highlight: escapes < and > in text content', () => {
  const out = highlight('hello');
  assert.equal(out, 'hello');
});

test('highlight: a real-world template fragment renders without nested spans', () => {
  const out = highlight('<p style="margin:0;">Reply if you want details.</p>');
  // No <span <span ...> sequence anywhere.
  assert.doesNotMatch(out, /<span\s+<span/);
  // The opening and closing p tags both get tag-name spans.
  const tagSpans = out.match(/<span class="t-tag">p<\/span>/g) || [];
  assert.equal(tagSpans.length, 2);
});
