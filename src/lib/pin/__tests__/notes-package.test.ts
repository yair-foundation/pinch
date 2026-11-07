import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Batch, type BatchNote, type Collection, newCollection } from '../learnings';
import {
  CHECK_FILE,
  hasSaved,
  NOTES_FILE,
  notesPackage,
  notesPackageRoot,
  savedPackage,
} from '../notes-package';

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
  it('puts a take at the top of the package, in a folder named to the minute', () => {
    const b = batch('a', [note('01.1')]);
    const c = { ...newCollection('My rules', 'c1', STAMP), batches: [b] };
    const made = notesPackage(c, new Map([['a', exportOf(b)]]), STAMP, true);
    const root = notesPackageRoot(STAMP);
    assert.equal(root, 'pinch-notes-2026-11-05-10-00/');
    assert.deepEqual(made.files.map((f) => f.name.slice(root.length)).sort(), [
      'crops/01.1.jpg',
      'images/01.png',
      'marked/01.jpg',
      'notes.md',
      'pinch-check.md',
    ]);
    const text = new TextDecoder().decode(made.files[0].data);
    assert.match(text, /Screenshot: `images\/01\.png`/);
    assert.match(text, /\(`crops\/01\.1\.jpg`\)/);
  });

  it('holds the notes and what they point at, and nothing else', () => {
    const made = pack([batch('a', [note('01.1'), note('01.2')])]);
    assert.deepEqual(made.names.sort(), [
      'batches/01-pinch-a/crops/01.1.jpg',
      'batches/01-pinch-a/crops/01.2.jpg',
      'batches/01-pinch-a/images/01.png',
      'batches/01-pinch-a/marked/01.jpg',
      'notes.md',
      'pinch-check.md',
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

  it('asks the agent to check its screen against the notes, with the check beside them', () => {
    const made = pack([batch('a', [note('01.1')])]);
    assert.match(made.text, /run the pinch-check agent on the drawing, then fix what it finds/);
    assert.match(made.text, /copy `pinch-check\.md` from this folder there/);
    const check = made.files.find((f) => f.name === notesPackageRoot(STAMP) + CHECK_FILE);
    const agent = new TextDecoder().decode(check?.data);
    assert.match(agent, /^---\nname: pinch-check\n/);
    assert.match(agent, /\nmodel: haiku\n---\n/);
    assert.match(agent, /\*\*\/pinch-notes-\*\/notes\.md/);
    assert.match(agent, /Don't add taste of your own\./);
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

  it('gives a note in the order it was said, where it knows that', () => {
    const spoken = 'Too harsh here. No dividers though.';
    const { text } = pack([
      batch('a', [note('01.1', { works: 'No dividers though.', doesNotWork: 'Too harsh here.', spoken })]),
    ]);
    assert.match(text, /\) Too harsh here\. No dividers though\.\n/);
  });

  it('says a mark in words under its note, and what the close-ups show', () => {
    const where = 'Where: top left, on "Choose a plan". Colours: #ffffff, #020202.';
    const { text } = pack([batch('a', [note('01.1', { where })])]);
    assert.match(text, /Great big title\.\n {2}Where: top left, on "Choose a plan"\. Colours: #ffffff, #020202\.\n/);
    assert.match(text, /Each close-up shows one spot, bright, with the rest dimmed\./);
    assert.match(text, /A mark's colour means nothing\./);
    const older = pack([batch('a', [note('01.1')])]).text;
    assert.doesNotMatch(older, /Where:|dimmed/);
    assert.match(older, /each close-up shows one spot\. A mark's colour means nothing\./);
  });

  it('keeps the words of a batch whose files are gone, and counts the close-ups', () => {
    const b = batch('a', [note('01.1')]);
    const c = { ...newCollection('My rules', 'c1', STAMP), batches: [b] };
    const made = notesPackage(c, new Map([['a', null]]), STAMP);
    assert.deepEqual(
      made.files.map((f) => f.name.slice(notesPackageRoot(STAMP).length)),
      [NOTES_FILE, CHECK_FILE],
    );
    assert.equal(made.missing, 1);
    const text = new TextDecoder().decode(made.files[0].data);
    assert.match(text, /## Vimeo Web\.png\n\n- 1\. Great big title\./);
  });
});

describe('what someone who saved notes takes away', () => {
  const rule = (c: Collection): Collection => ({
    ...c,
    rules: [
      {
        id: 'r1',
        text: 'Use one big title.',
        context: '',
        topics: [],
        tags: [],
        evidence: [],
        status: 'approved',
        createdAt: STAMP,
      },
    ],
  });
  const saved = (batches: Batch[]) => ({ ...newCollection('My rules', 'c1', STAMP), batches });
  const filesOf = (batches: Batch[]) => new Map(batches.map((b) => [b.id, exportOf(b)]));

  it('puts the rules beside the notes folder, where an agent reading it will not find them', () => {
    const batches = [batch('a', [note('01.1')])];
    const made = savedPackage(rule(saved(batches)), filesOf(batches), STAMP);
    assert.equal(made.notes, 1);
    assert.equal(made.rules, 1);
    const names = made.files.map((f) => f.name);
    assert.ok(names.includes('pinch-rules-2026-11-05-10-00.md'));
    assert.ok(names.includes(`${notesPackageRoot(STAMP)}${NOTES_FILE}`));
    const rules = made.files.find((f) => f.name.startsWith('pinch-rules-'));
    assert.match(new TextDecoder().decode(rules?.data), /Use one big title\./);
    const notes = made.files.find((f) => f.name.endsWith(NOTES_FILE));
    assert.doesNotMatch(new TextDecoder().decode(notes?.data), /Use one big title/);
  });

  it('gives no rules file without rules, and no notes folder without notes', () => {
    const batches = [batch('a', [note('01.1')])];
    const onlyNotes = savedPackage(saved(batches), filesOf(batches), STAMP);
    assert.ok(onlyNotes.files.every((f) => f.name.startsWith(notesPackageRoot(STAMP))));
    const onlyRules = savedPackage(rule(saved([])), new Map(), STAMP);
    assert.deepEqual(
      onlyRules.files.map((f) => f.name),
      ['pinch-rules-2026-11-05-10-00.md'],
    );
  });

  it('counts as saved only what would be in the zip', () => {
    assert.equal(hasSaved(saved([])), false);
    assert.equal(hasSaved(saved([batch('a', [])])), false);
    assert.equal(hasSaved(saved([batch('a', [note('01.1')])])), true);
    assert.equal(hasSaved(rule(saved([]))), true);
  });
});
