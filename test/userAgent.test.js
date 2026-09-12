// Every Chromium browser also claims to be Chrome, and Chrome also claims to
// be Safari. These assert the order of the checks, which is the only thing
// that makes the answer specific rather than "Chrome" for everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserAgent } from '../shared/userAgent.js';

const UA = {
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1',
  curl: 'curl/8.4.0',
};

test('Chromium browsers are not all reported as Chrome', () => {
  // Edge and Opera both contain "Chrome/..." in their UA. Testing Chrome
  // first would label all three the same.
  assert.equal(parseUserAgent(UA.edge).browser, 'Edge');
  assert.equal(parseUserAgent(UA.opera).browser, 'Opera');
  assert.equal(parseUserAgent(UA.chrome).browser, 'Chrome');
});

test('Chrome is not reported as Safari', () => {
  // Chrome's UA ends in "Safari/537.36".
  assert.equal(parseUserAgent(UA.chrome).browser, 'Chrome');
  assert.equal(parseUserAgent(UA.safari).browser, 'Safari');
});

test('platform comes through', () => {
  assert.equal(parseUserAgent(UA.chrome).platform, 'macOS');
  assert.equal(parseUserAgent(UA.edge).platform, 'Windows');
  assert.equal(parseUserAgent(UA.firefox).platform, 'Linux');
  assert.equal(parseUserAgent(UA.iphone).platform, 'iOS');
});

test('device class separates phone, tablet and desktop', () => {
  assert.equal(parseUserAgent(UA.iphone).device, 'mobile');
  assert.equal(parseUserAgent(UA.ipad).device, 'tablet');
  assert.equal(parseUserAgent(UA.chrome).device, 'desktop');
});

test('the label is the thing a human reads', () => {
  assert.equal(parseUserAgent(UA.chrome).label, 'Chrome 131 on macOS');
  assert.equal(parseUserAgent(UA.firefox).label, 'Firefox 133 on Linux');
});

test('scripts say so rather than posing as an unknown browser', () => {
  const parsed = parseUserAgent(UA.curl);
  assert.equal(parsed.device, 'script');
  assert.equal(parsed.label, 'curl');
});

test('empty input does not invent an answer', () => {
  assert.deepEqual(parseUserAgent(''), {
    browser: null, version: null, platform: null, device: null, label: null,
  });
  assert.equal(parseUserAgent(null).label, null);
});
