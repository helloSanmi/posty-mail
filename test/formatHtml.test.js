// Locks the HTML pretty-printer. Each test names the structural rule it's
// verifying so a regression points at the right behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHtml } from '../src/utils/formatHtml.js';

test('formatHtml: blank input returns blank', () => {
  assert.equal(formatHtml(''), '');
  assert.equal(formatHtml('   '), '   ');
  assert.equal(formatHtml(null), '');
});

test('formatHtml: each block tag lands on its own line', () => {
  const out = formatHtml('<div><p>hi</p><p>there</p></div>');
  assert.deepEqual(out.split('\n'), [
    '<div>',
    '  <p>hi</p>',
    '  <p>there</p>',
    '</div>',
  ]);
});

test('formatHtml: indents nested blocks by two spaces per level', () => {
  const out = formatHtml('<table><tr><td>cell</td></tr></table>');
  assert.deepEqual(out.split('\n'), [
    '<table>',
    '  <tr>',
    '    <td>cell</td>',
    '  </tr>',
    '</table>',
  ]);
});

test('formatHtml: inline content (text + <a>) stays on the parent line', () => {
  const out = formatHtml('<p>Hi <a href="x">there</a> friend.</p>');
  assert.deepEqual(out.split('\n'), ['<p>Hi <a href="x">there</a> friend.</p>']);
});

test('formatHtml: void tags do not indent following content', () => {
  const out = formatHtml('<div><img src="x.png"><p>hi</p></div>');
  assert.deepEqual(out.split('\n'), [
    '<div>',
    '  <img src="x.png">',
    '  <p>hi</p>',
    '</div>',
  ]);
});

test('formatHtml: handles attributes containing > inside quotes', () => {
  // No fancy assertion. just that we don't crash and produce sensible output.
  const result = formatHtml('<a href="https://x?a=1&b=2">click</a>');
  assert.match(result, /<a href="https:\/\/x\?a=1&b=2">click<\/a>/);
});

test('formatHtml: is idempotent — format(format(x)) === format(x)', () => {
  const raw = '<table><tr><td><p>Hi</p></td></tr></table>';
  const once = formatHtml(raw);
  const twice = formatHtml(once);
  assert.equal(once, twice);
});

test('formatHtml: collapses pre-existing whitespace between tags', () => {
  const messy = '<div>  \n  <p>hi</p>\n\n  </div>';
  const out = formatHtml(messy);
  assert.deepEqual(out.split('\n'), [
    '<div>',
    '  <p>hi</p>',
    '</div>',
  ]);
});

test('formatHtml: keeps inline tags inline inside their parent block', () => {
  const out = formatHtml('<p>Hello <strong>world</strong></p>');
  assert.deepEqual(out.split('\n'), ['<p>Hello <strong>world</strong></p>']);
});
