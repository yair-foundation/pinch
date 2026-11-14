import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { unzip } from '../unzip';
import { zip } from '../zip';
import { imagesInZip, isPinchExport } from '../zip-images';

const bytes = (s: string) => new TextEncoder().encode(s);
const entries = (names: string[]) => new Map(names.map((n) => [n, bytes(`data of ${n}`)]));

describe('a zip of screenshots', () => {
  it('takes the images and PDFs, in name order with numbers as numbers', () => {
    const found = imagesInZip(
      entries([
        'deck/slide 10.png',
        'deck/slide 2.PNG',
        'deck/slide 1.jpg',
        'deck/notes.txt',
        'cover.webp',
        'handout.pdf',
      ]),
    );
    assert.deepEqual(
      found.map((f) => [f.path, f.type]),
      [
        ['cover.webp', 'image/webp'],
        ['deck/slide 1.jpg', 'image/jpeg'],
        ['deck/slide 2.PNG', 'image/png'],
        ['deck/slide 10.png', 'image/png'],
        ['handout.pdf', 'application/pdf'],
      ],
    );
    assert.equal(found[1].name, 'slide 1.jpg');
  });

  it('leaves out what macOS hides in a zip, and empty entries', () => {
    const files = entries(['shots/._a.png', 'shots/.DS_Store', '.thumbs/b.png', 'shots/a.png']);
    files.set('shots/empty.png', new Uint8Array(0));
    assert.deepEqual(
      imagesInZip(files).map((f) => f.path),
      ['shots/a.png'],
    );
  });

  it('tells a Pinch export from a zip of screenshots', () => {
    assert.equal(isPinchExport(entries(['pinch-2026/notes.json', 'pinch-2026/a.png'])), true);
    assert.equal(isPinchExport(entries(['notes.json'])), true);
    assert.equal(isPinchExport(entries(['a.png', 'my-notes.json.png'])), false);
  });

  it('reads the images back out of a real zip', async () => {
    const made = zip([
      { name: 'b.png', data: bytes('png b') },
      { name: 'a.jpg', data: bytes('jpg a') },
    ]);
    const whole = new Uint8Array(await new Blob(made as BlobPart[]).arrayBuffer());
    const found = imagesInZip(await unzip(whole));
    assert.deepEqual(
      found.map((f) => [f.name, new TextDecoder().decode(f.bytes)]),
      [
        ['a.jpg', 'jpg a'],
        ['b.png', 'png b'],
      ],
    );
  });
});
