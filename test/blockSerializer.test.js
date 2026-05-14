// Locks the block → HTML serializer. The contract: given a blocks array,
// produce email-safe HTML wrapped in a 600px-wide table layout. Each test
// names the block type / property it's checking.

import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeBlocks } from '../src/utils/blockSerializer.js';

test('serializeBlocks: empty array yields an empty container', () => {
  const html = serializeBlocks([]);
  assert.match(html, /<table[^>]*max-width:600px/);
});

test('serializeBlocks: non-array input returns empty string', () => {
  assert.equal(serializeBlocks(null), '');
  assert.equal(serializeBlocks(undefined), '');
});

test('serializeBlocks: heading uses the matching h-tag and size', () => {
  const html = serializeBlocks([{ type: 'heading', props: { level: 1, text: 'Hello' } }]);
  assert.match(html, /<h1[^>]*font-size:28px/);
  assert.match(html, />Hello<\/h1>/);
});

test('serializeBlocks: heading with bad level falls back to h2', () => {
  const html = serializeBlocks([{ type: 'heading', props: { level: 99, text: 'X' } }]);
  assert.match(html, /<h2/);
  assert.doesNotMatch(html, /<h99/);
});

test('serializeBlocks: paragraph escapes HTML to prevent injection', () => {
  const html = serializeBlocks([{ type: 'paragraph', props: { text: '<script>alert(1)</script>' } }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('serializeBlocks: paragraph converts double-newline into separate <p>', () => {
  const html = serializeBlocks([{ type: 'paragraph', props: { text: 'one\n\ntwo' } }]);
  const matches = html.match(/<p[^>]*>/g) || [];
  assert.equal(matches.length, 2);
});

test('serializeBlocks: paragraph keeps single-newlines as <br>', () => {
  const html = serializeBlocks([{ type: 'paragraph', props: { text: 'line1\nline2' } }]);
  assert.match(html, /line1<br>line2/);
});

test('serializeBlocks: image without src produces nothing', () => {
  const html = serializeBlocks([{ type: 'image', props: { src: '' } }]);
  // No <img> tag added; container stays empty.
  assert.doesNotMatch(html, /<img/);
});

test('serializeBlocks: image wraps in <a> when href is set', () => {
  const html = serializeBlocks([{ type: 'image', props: { src: 'https://x/y.png', href: 'https://x' } }]);
  assert.match(html, /<a[^>]+href="https:\/\/x"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('serializeBlocks: image attrs are escaped', () => {
  const html = serializeBlocks([{ type: 'image', props: { src: 'x"y', alt: 'a"b' } }]);
  assert.doesNotMatch(html, /src="x"y/);
  assert.match(html, /src="x&quot;y"/);
});

test('serializeBlocks: button renders with custom bg & color', () => {
  const html = serializeBlocks([{ type: 'button', props: { label: 'Buy', href: 'https://x', bg: '#ff0000' } }]);
  assert.match(html, /background:#ff0000/);
  assert.match(html, />Buy<\/a>/);
});

test('serializeBlocks: divider produces an hr', () => {
  const html = serializeBlocks([{ type: 'divider' }]);
  assert.match(html, /<hr/);
});

test('serializeBlocks: spacer clamps the height to a reasonable range', () => {
  const tiny = serializeBlocks([{ type: 'spacer', props: { height: 1 } }]);
  const huge = serializeBlocks([{ type: 'spacer', props: { height: 9999 } }]);
  // Tiny clamps up to >= 4; huge clamps down to <= 120.
  assert.match(tiny, /height:4px/);
  assert.match(huge, /height:120px/);
});

test('serializeBlocks: unknown block type is silently dropped', () => {
  const html = serializeBlocks([
    { type: 'paragraph', props: { text: 'keep' } },
    { type: 'definitely-not-a-block' },
  ]);
  assert.match(html, />keep/);
});
