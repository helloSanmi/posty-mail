import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType } from '../backend/lib/imageType.js';

test('detects PNG by magic bytes', () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageType(buf), 'image/png');
});

test('detects JPEG by magic bytes', () => {
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectImageType(buf), 'image/jpeg');
});

test('detects GIF by magic bytes', () => {
  const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectImageType(buf), 'image/gif');
});

test('detects WEBP by RIFF + WEBP marker', () => {
  const buf = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0,
    0x57, 0x45, 0x42, 0x50,
  ]);
  assert.equal(detectImageType(buf), 'image/webp');
});

test('rejects HTML pretending to be an image', () => {
  const buf = Buffer.from('<html>nope</html>');
  assert.equal(detectImageType(buf), null);
});

test('rejects buffers shorter than 12 bytes', () => {
  assert.equal(detectImageType(Buffer.from([0x89, 0x50])), null);
});

test('rejects non-Buffer input', () => {
  assert.equal(detectImageType('not a buffer'), null);
  assert.equal(detectImageType(null), null);
});
