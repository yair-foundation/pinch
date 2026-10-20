import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { jpegSize, sniffImage } from '../image';

describe('sniffImage', () => {
  it('knows the four image types by their first bytes, and nothing else', () => {
    assert.equal(
      sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
      'image/png',
    );
    assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(
      sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
      'image/webp',
    );
    assert.equal(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif');
    assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), undefined);
    assert.equal(sniffImage(new TextEncoder().encode('<html>')), undefined);
    assert.equal(sniffImage(new Uint8Array([])), undefined);
  });
});

/** A JPEG's headers only: SOI, an APP0 segment, then a baseline frame header of the size given. */
const jpegHead = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);

describe('jpegSize', () => {
  it('reads the size from the frame header, past other segments', () => {
    assert.deepEqual(jpegSize(jpegHead(1200, 734)), { width: 1200, height: 734 });
    assert.deepEqual(jpegSize(jpegHead(3, 2)), { width: 3, height: 2 });
  });

  it('says nothing for what isn’t a JPEG or ends before its frame header', () => {
    assert.equal(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(jpegSize(jpegHead(10, 10).subarray(0, 24)), null);
    assert.equal(jpegSize(new Uint8Array([])), null);
  });
});
