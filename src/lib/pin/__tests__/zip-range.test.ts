import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { unzip } from '../unzip';
import { zip } from '../zip';
import { readZipEntries } from '../zip-range';

const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('reading some entries of a zip by ranges', () => {
  const big = new Uint8Array(2_000_000).map((_, i) => i % 251);
  const bytes = join(
    zip([
      { name: 'pinch/images/01-a.png', data: big },
      { name: 'pinch/notes.json', data: new TextEncoder().encode('{"tool":"Pinch"}') },
      { name: 'pinch/crops/01-a-note-1.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
    ]),
  );

  it('gets the wanted entries, as the whole reader does, and reads little of the zip', async () => {
    let read = 0;
    const range = async (s: number, e: number) => {
      read += e - s;
      return bytes.subarray(s, e);
    };
    const got = await readZipEntries(range, bytes.length, [
      'pinch/notes.json',
      'pinch/crops/01-a-note-1.jpg',
      'pinch/crops/missing.jpg',
    ]);
    const whole = await unzip(bytes);
    assert.deepEqual([...got.keys()].sort(), ['pinch/crops/01-a-note-1.jpg', 'pinch/notes.json']);
    assert.deepEqual(got.get('pinch/notes.json'), whole.get('pinch/notes.json'));
    assert.deepEqual(got.get('pinch/crops/01-a-note-1.jpg'), new Uint8Array([1, 2, 3, 4, 5]));
    assert.ok(read < 140_000, `read ${read} of ${bytes.length} bytes`);
  });

  it('reads nothing for no names, and refuses what isn’t a zip', async () => {
    assert.equal((await readZipEntries(async () => new Uint8Array(), 0, [])).size, 0);
    const junk = new Uint8Array(100);
    await assert.rejects(
      readZipEntries(async (s, e) => junk.subarray(s, e), junk.length, ['a']),
      /isn’t a zip/,
    );
  });
});
