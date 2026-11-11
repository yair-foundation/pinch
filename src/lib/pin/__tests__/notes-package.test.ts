import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Batch, type BatchNote, type Collection, newCollection } from '../learnings';
import type { Take } from '../narration';
import {
  CHECK_FILE,
  hasSaved,
  NOTES_FILE,
  notesPackage,
  notesPackageRoot,
  savedPackage,
  takeFile,
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
    assert.match(
      made.text,
      /Where this project has a design system, use its values, tokens and components as they are/,
    );
    assert.match(made.text, /copy `pinch-check\.md` from this folder there/);
    const check = made.files.find((f) => f.name === notesPackageRoot(STAMP) + CHECK_FILE);
    const agent = new TextDecoder().decode(check?.data);
    assert.match(agent, /^---\nname: pinch-check\n/);
    assert.match(agent, /\nmodel: haiku\n---\n/);
    assert.match(agent, /\*\*\/pinch-notes-\*\/notes\.md/);
    assert.match(agent, /Don't add taste of your own\./);
    // How far a note carries (D186): the same job on the same kind of screen, and no further.
    assert.match(agent, /plainly does the same job on the same kind of screen/);
    assert.match(agent, /A note that only approves a screen \("this is okay"\) asks for nothing/);
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

describe('the take beside the package', () => {
  it('is the take as the browser kept it, named by when it was recorded (D183)', () => {
    const take: Take = {
      id: 'aaaa-bbbb',
      version: 1,
      recordedAt: '2026-11-08T11:57:03.250Z',
      durationMs: 1200,
      mimeType: 'audio/webm',
      screens: [{ id: 'one', name: 'one.png', width: 1000, height: 800 }],
      shown: [{ t: 0, screen: 0 }],
      pointer: [
        [100, 0, 0.5, 0.5],
        [900, 0, null, null],
      ],
      words: [{ text: 'Nice.', start: 200, end: 600 }],
    };
    const file = takeFile(take);
    assert.equal(file.name, 'pinch-take-2026-11-08-11-57-03.json');
    assert.deepEqual(JSON.parse(new TextDecoder().decode(file.data)), take);
  });
});

describe('a note about the whole screen, and what was said (D188)', () => {
  const root = notesPackageRoot(STAMP);
  const take = (words: Take['words']): Take => ({
    id: 'aaaa-bbbb',
    version: 1,
    recordedAt: '2026-11-11T07:35:48.000Z',
    durationMs: 30_000,
    mimeType: 'audio/webm',
    screens: [
      { id: 'one', name: 'one.png', width: 1000, height: 1000 },
      { id: 'two', name: 'two.png', width: 1000, height: 1000 },
    ],
    shown: [
      { t: 0, screen: 0 },
      { t: 10_000, screen: 1 },
    ],
    pointer: [],
    words,
  });
  const packed = (notes: BatchNote[], takes: Take[] = []) => {
    const b = batch('a', notes);
    const c = { ...newCollection('take', 'c1', STAMP), batches: [b] };
    const made = notesPackage(c, new Map([['a', exportOf(b)]]), STAMP, true, takes);
    const file = (name: string) => made.files.find((f) => f.name === root + name);
    return {
      ...made,
      names: made.files.map((f) => f.name.slice(root.length)).sort(),
      text: new TextDecoder().decode(file(NOTES_FILE)?.data),
      transcript: file('transcript.md') && new TextDecoder().decode(file('transcript.md')?.data),
    };
  };

  it('gives it no close-up, and no marked copy when every note on the screen is one', () => {
    const made = packed([
      note('01.1', { whole: true, where: 'Where: the whole screen. Colours: #f7f5f2.' }),
    ]);
    assert.deepEqual(made.names, ['images/01.png', 'notes.md', 'pinch-check.md']);
    assert.equal(made.missing, 0);
    assert.equal(made.notes, 1);
    assert.match(made.text, /\n- 1\. Great big title\.\n {2}Where: the whole screen\./);
    assert.doesNotMatch(made.text, /Marked copy/);
    assert.match(made.text, /A note about the whole screen has no mark and no close-up\./);
  });

  it('keeps the marked copy and the close-up of a note that points, beside one that does not', () => {
    const made = packed([
      note('01.1', { whole: true, where: 'Where: the whole screen. Colours: #f7f5f2.' }),
      note('01.2', { where: 'Where: top left. Colours: #ffffff.' }),
    ]);
    assert.deepEqual(made.names, [
      'crops/01.2.jpg',
      'images/01.png',
      'marked/01.jpg',
      'notes.md',
      'pinch-check.md',
    ]);
    assert.match(made.text, /\n- 1\. Great big title\.\n/);
    assert.match(made.text, /\n- 2\. \(`crops\/01\.2\.jpg`\) Great big title\.\n/);
  });

  it('puts what was said beside the notes, and what to ask about ahead of them', () => {
    const words = [
      { text: 'Remove', start: 1000, end: 1250 },
      { text: 'this.', start: 1300, end: 1550 },
      { text: 'Great', start: 11_000, end: 11_250 },
      { text: 'big', start: 11_300, end: 11_550 },
      { text: 'title.', start: 11_600, end: 11_850 },
    ];
    const made = packed([note('01.1')], [take(words)]);
    assert.ok(made.names.includes('transcript.md'));
    assert.match(made.transcript ?? '', /\n## two\.png\n\n- 0:11 Great big title\.\n/);
    const unsure = made.text.indexOf('## Not sure');
    assert.ok(unsure > 0 && unsure < made.text.indexOf('## Vimeo Web.png'));
    assert.match(
      made.text,
      /\n- `one\.png` at 0:01: "Remove this\." Taken as a command: this screenshot left the batch, so it has no notes\.\n/,
    );
    assert.match(made.text, /Everything I said is in `transcript\.md`\./);
  });

  it('says how to read a take that is a work order, after the line about taste (D189)', () => {
    const { text } = packed([note('01.1')]);
    const taste = text.indexOf('it is everything you know about my taste.');
    const work = text.indexOf('A note that asks for something to be changed or removed');
    const system = text.indexOf('Where this project has a design system');
    assert.ok(taste > 0 && taste < work && work < system);
    assert.match(text, /If my first notes say how to read the rest, .* follow that for every screen\./);
  });

  it('says how many screens nothing was said over, ahead of the notes (D189)', () => {
    const words = [
      { text: 'Great', start: 11_000, end: 11_250 },
      { text: 'big', start: 11_300, end: 11_550 },
      { text: 'title.', start: 11_600, end: 11_850 },
    ];
    const made = packed([note('01.1')], [take(words)]);
    const line =
      'I said nothing over 1 of the 2 screens I was shown. They are listed at the end of `transcript.md`.';
    assert.ok(made.text.includes(`\n\n${line}\n`));
    assert.ok(made.text.indexOf(line) < made.text.indexOf('## Vimeo Web.png'));
    assert.match(made.transcript ?? '', /\n## Nothing said\n\nI said nothing over this screen\.\n\n- one\.png\n/);
    assert.doesNotMatch(packed([note('01.1')]).text, /I said nothing over/);
  });

  it('has no list to ask about when every remark was taken as a note, and no transcript without a take', () => {
    const words = [
      { text: 'Great', start: 1000, end: 1250 },
      { text: 'big', start: 1300, end: 1550 },
      { text: 'title.', start: 1600, end: 1850 },
    ];
    const made = packed([note('01.1')], [take(words)]);
    assert.doesNotMatch(made.text, /Not sure/);
    assert.ok(made.names.includes('transcript.md'));
    assert.ok(!packed([note('01.1')]).names.includes('transcript.md'));
  });
});
