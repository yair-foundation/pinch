import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bytesCodec, jsonCodec, keyStore } from '../local-store';

describe('local store', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pinch-store-'));
    process.env.PINCH_LOCAL_DATA = dir;
  });
  afterEach(() => {
    delete process.env.PINCH_LOCAL_DATA;
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps documents in files, so a new store reads them back', () => {
    keyStore('documents', jsonCodec).set('pinch-users/u1/collections/c1.json', { rules: [1] });
    const again = keyStore('documents', jsonCodec);
    assert.deepEqual(again.get('pinch-users/u1/collections/c1.json'), { rules: [1] });
    assert.deepEqual(again.keys(), ['pinch-users/u1/collections/c1.json']);
  });

  it('keeps bytes, lists entries and deletes', () => {
    const store = keyStore('batches', bytesCodec);
    store.set('pinch-users/u1/batches/b1.zip', new Uint8Array([1, 2, 3]));
    assert.deepEqual(
      store.entries().map(([k, v]) => [k, [...v]]),
      [['pinch-users/u1/batches/b1.zip', [1, 2, 3]]],
    );
    store.delete('pinch-users/u1/batches/b1.zip');
    assert.equal(store.get('pinch-users/u1/batches/b1.zip'), undefined);
    assert.deepEqual(store.keys(), []);
  });

  it('refuses a key that would leave its folder', () => {
    assert.throws(() => keyStore('documents', jsonCodec).set('../escape.json', {}));
  });

  it('is memory without a folder, and never a folder on Vercel', () => {
    delete process.env.PINCH_LOCAL_DATA;
    const store = keyStore('documents', jsonCodec);
    store.set('a.json', 1);
    assert.equal(store.get('a.json'), 1);
    process.env.PINCH_LOCAL_DATA = dir;
    process.env.VERCEL = '1';
    try {
      assert.equal(keyStore('documents', jsonCodec).get('a.json'), undefined);
      assert.deepEqual(keyStore('documents', jsonCodec).keys(), []);
    } finally {
      delete process.env.VERCEL;
    }
  });
});
