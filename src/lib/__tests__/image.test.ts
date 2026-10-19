import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sniffImage } from '../image';

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
