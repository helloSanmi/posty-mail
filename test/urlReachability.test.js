import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnreachableImageUrls, isUnreachableUrl } from '../backend/lib/urlReachability.js';

test('isUnreachableUrl flags localhost variants', () => {
  assert.equal(isUnreachableUrl('http://localhost:4010/x.png'), true);
  assert.equal(isUnreachableUrl('http://LOCALHOST/x.png'), true);
  assert.equal(isUnreachableUrl('http://127.0.0.1/x.png'), true);
  assert.equal(isUnreachableUrl('http://[::1]/x.png'), true);
});

test('isUnreachableUrl flags RFC1918 private ranges', () => {
  assert.equal(isUnreachableUrl('http://10.0.0.5/x.png'), true);
  assert.equal(isUnreachableUrl('http://192.168.1.50/x.png'), true);
  assert.equal(isUnreachableUrl('http://172.16.0.1/x.png'), true);
  assert.equal(isUnreachableUrl('http://172.31.255.255/x.png'), true);
});

test('isUnreachableUrl does NOT flag 172 addresses outside 16-31', () => {
  assert.equal(isUnreachableUrl('http://172.15.0.1/x.png'), false);
  assert.equal(isUnreachableUrl('http://172.32.0.1/x.png'), false);
});

test('isUnreachableUrl flags .local mDNS hosts', () => {
  assert.equal(isUnreachableUrl('http://my-mac.local/x.png'), true);
});

test('isUnreachableUrl passes public URLs', () => {
  assert.equal(isUnreachableUrl('https://cdn.example.com/x.png'), false);
  assert.equal(isUnreachableUrl('https://images.unsplash.com/x.png'), false);
});

test('isUnreachableUrl is safe with empty / malformed input', () => {
  assert.equal(isUnreachableUrl(''), false);
  assert.equal(isUnreachableUrl(null), false);
  assert.equal(isUnreachableUrl('not a url'), false);
  assert.equal(isUnreachableUrl('/relative/path.png'), false);
});

test('findUnreachableImageUrls extracts <img src> values', () => {
  const html = `
    <p>hi</p>
    <img src="http://localhost:4010/uploads/logos/logo.png" alt="logo">
    <img src="https://cdn.example.com/banner.png">
    <img src='http://192.168.1.5/private.png'>
  `;
  const result = findUnreachableImageUrls(html);
  assert.deepEqual(result.sort(), [
    'http://192.168.1.5/private.png',
    'http://localhost:4010/uploads/logos/logo.png',
  ]);
});

test('findUnreachableImageUrls includes a flagged logoUrl arg', () => {
  const result = findUnreachableImageUrls('<p>no images</p>', 'http://localhost:4010/logo.png');
  assert.deepEqual(result, ['http://localhost:4010/logo.png']);
});

test('findUnreachableImageUrls dedupes when logoUrl also appears in html', () => {
  const url = 'http://localhost:4010/logo.png';
  const result = findUnreachableImageUrls(`<img src="${url}">`, url);
  assert.deepEqual(result, [url]);
});
