import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Batch, type BatchNote, newCollection } from '../learnings';
import { NOTES_FILE, notesPackage, notesPackageRoot } from '../notes-package';

const bytes = (s: string) => new TextEncoder().encode(s);
const STAMP = '2026-11-05T10:00:00Z';

const note = (ref: string, more: Partial<BatchNote> = {}): BatchNote => ({
  ref,
  image: 'Vimeo Web.png',
  source: null,
  topics: [],
  works: 'Great big title.',
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  ...more,
});

const batch = (id: string, notes: BatchNote[]): Batch => ({
  id,
  name: `pinch-${id}`,
  addedAt: STAMP,
  exportedAt: STAMP,
  root: `${id}/`,
  images: 1,
  notes,
});

/** A batch's export as it is read back, with the files that stay out of the package. */
function exportOf(b: Batch) {
  const manifest = {
    assets: [...new Set(b.notes.map((n) => n.ref.split('.')[0]))].map((number) => ({
      number,
      image: `images/${number}.png`,
      marked: `marked/${number}.jpg`,
    })),
  };
  return new Map<string, Uint8Array>([
    [`${b.root}notes.json`, bytes(JSON.stringify(manifest))],
    [`${b.root}README.md`, bytes('How to use this')],
    [`${b.root}AGENTS.md`, bytes('Read the README')],
    [`${b.root}contact-sheet.jpg`, bytes('sheet')],
    ...manifest.assets.flatMap((a): [string, Uint8Array][] => [
      [`${b.root}${a.image}`, bytes('image')],
      [`${b.root}${a.marked}`, bytes('marked')],
    ]),
    ...b.notes.map((n): [string, Uint8Array] => [`${b.root}${n.crop}`, bytes('crop')]),
  ]);
}

function pack(batches: Batch[]) {
  const c = { ...newCollection('My rules', 'c1', STAMP), batches };
  const made = notesPackage(c, new Map(batches.map((b) => [b.id, exportOf(b)])), STAMP);
  const root = notesPackageRoot(STAMP);
  const notes = made.files.find((f) => f.name === root + NOTES_FILE);
  return {
    ...made,
    names: made.files.map((f) => f.name.slice(root.length)),
    text: new TextDecoder().decode(notes?.data),
  };
}

describe('the notes package', () => {
  it('holds the notes and what they point at, and nothing else', () => {
    const made = pack([batch('a', [note('01.1'), note('01.2')])]);
    assert.deepEqual(made.names.sort(), [
      'batches/01-pinch-a/crops/01.1.jpg',
      'batches/01-pinch-a/crops/01.2.jpg',
      'batches/01-pinch-a/images/01.png',
      'batches/01-pinch-a/marked/01.jpg',
      'notes.md',
    ]);
    assert.equal(made.notes, 2);
    assert.equal(made.missing, 0);
  });

  it('tells the agent to read it all and open the images, and carries no labels', () => {
    const { text } = pack([batch('a', [note('01.1', { doesNotWork: 'Too dense.', works: '' })])]);
    assert.match(text, /read all of this first and open the images/);
    assert.doesNotMatch(text, /doesn't|works|rule/i);
    assert.match(
      text,
      /## Vimeo Web\.png\n\nScreenshot: `batches\/01-pinch-a\/images\/01\.png`\nMarked copy: `batches\/01-pinch-a\/marked\/01\.jpg`\n\n- 1\. \(`batches\/01-pinch-a\/crops\/01\.1\.jpg`\) Too dense\./,
    );
  });

  it('keeps both sides of a note in the words it was said, on one line', () => {
    const { text } = pack([
      batch('a', [note('01.1', { works: 'No dividers.\nLike this.', doesNotWork: 'Too harsh.' })]),
    ]);
    assert.match(text, /\) No dividers\. Like this\. Too harsh\.\n/);
  });

  it('groups notes by screenshot, and keeps batches apart', () => {
    const made = pack([
      batch('a', [note('01.1'), note('02.1', { image: 'Fey.png' })]),
      batch('b', [note('01.1', { image: 'Tines.png' })]),
    ]);
    assert.deepEqual(
      made.text.split('\n').filter((l) => l.startsWith('## ')),
      ['## Vimeo Web.png', '## Fey.png', '## Tines.png'],
    );
    assert.ok(made.names.includes('batches/02-pinch-b/crops/01.1.jpg'));
    assert.equal(new Set(made.names).size, made.names.length);
  });

  it('says what the author said of a screenshot and a note', () => {
    const { text } = pack([
      batch('a', [note('01.1', { source: 'ours', screenTag: 'Pricing', best: true })]),
    ]);
    assert.match(text, /My own work\.\nTag: Pricing\n/);
    assert.match(text, /My best example: Great big title\./);
    const plain = pack([batch('a', [note('01.1', { source: 'competitor' })])]).text;
    assert.doesNotMatch(plain, /My own work|Tag:|My best example/);
  });

  it('keeps the words of a batch whose files are gone, and counts the close-ups', () => {
    const b = batch('a', [note('01.1')]);
    const c = { ...newCollection('My rules', 'c1', STAMP), batches: [b] };
    const made = notesPackage(c, new Map([['a', null]]), STAMP);
    assert.equal(made.files.length, 1);
    assert.equal(made.missing, 1);
    const text = new TextDecoder().decode(made.files[0].data);
    assert.match(text, /## Vimeo Web\.png\n\n- 1\. Great big title\./);
  });
});
