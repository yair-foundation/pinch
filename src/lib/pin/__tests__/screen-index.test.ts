import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type BatchNote,
  type Collection,
  newCollection,
  type Rule,
  rulesOf,
  rulesPackage,
} from '../learnings';
import { reviewCells, reviewFile, reviewPages, reviewSpan } from '../review-sheets';
import { screenGroup, screenIndex, screenNames, seenOn, seenOnLine } from '../screen-index';
import { unzip } from '../unzip';
import { zip } from '../zip';

const note = (
  ref: string,
  image: string,
  source: BatchNote['source'],
  screenTag: string | undefined,
  works: string,
  doesNotWork = '',
): BatchNote => ({
  ref,
  image,
  source,
  topics: ['visual'],
  works,
  doesNotWork,
  crop: `crops/${ref}.jpg`,
  ...(screenTag ? { screenTag } : {}),
});

const rule = (id: string, notes: string[]): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: notes.map((n) => ({ batchId: 'b1', note: n })),
  status: 'approved',
  createdAt: `2026-10-21T10:00:0${id.charCodeAt(0) - 97}Z`,
});

/** One product spelled three ways, the real product's screens, an outside product, and a note with no source. */
function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-21T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-21',
        addedAt: '2026-10-21T10:00:00Z',
        exportedAt: '2026-10-21T10:00:00Z',
        root: 'pinch-2026-10-21/',
        images: 5,
        notes: [
          note('01.1', 'a.png', 'ours', 'Marketing Assets - Unified Inbox', 'Clean.'),
          note('02.1', 'b.png', 'ours', 'Marketing Asset - Unified Inbox', '', 'Noisy.'),
          note('02.2', 'b.png', 'ours', ' marketing assets - unified inbox', 'Calm.'),
          note('03.1', 'c.png', 'ours', 'Unified Inbox', '', 'Grey.'),
          note('04.1', 'd.png', 'other', undefined, 'Roomy.'),
          note('05.1', 'e.png', null, 'Linear', 'Fast.'),
        ],
      },
    ],
    rules: [rule('a', ['01.1', '04.1']), rule('b', ['02.1', '02.2', '03.1'])],
  };
}

describe('the same screen tag, spelled differently (D105)', () => {
  it('is one set whatever its case, spacing, punctuation or plural', () => {
    assert.equal(
      screenGroup('Marketing Assets - Unified Inbox'),
      screenGroup('marketing  asset – unified inbox'),
    );
    assert.equal(screenGroup('Price Optimiser'), screenGroup('PriceOptimiser'));
    assert.equal(screenGroup('Co-pilot'), screenGroup('Copilot'));
    assert.equal(screenGroup('Reservations'), screenGroup('Reservation'));
  });

  it('keeps different sets apart, and tags with no letters as typed', () => {
    assert.notEqual(
      screenGroup('Marketing Assets'),
      screenGroup('Marketing Assets - Unified Inbox'),
    );
    assert.notEqual(screenGroup('Unified Inbox'), screenGroup('Marketing Assets - Unified Inbox'));
    assert.notEqual(screenGroup('???'), screenGroup('!!!'));
    assert.notEqual(screenGroup('דוחות'), screenGroup('הזמנות'));
  });

  it('is named by the spelling used most, the others listed', () => {
    const names = screenNames(library());
    assert.equal(names.name('marketing asset - unified inbox'), 'Marketing Assets - Unified Inbox');
    assert.deepEqual(names.others('marketing asset - unified inbox'), [
      'Marketing Asset - Unified Inbox',
      'marketing assets - unified inbox',
    ]);
    const major = library();
    major.batches[0].notes.push(
      note('07.1', 'h.png', 'ours', 'Marketing Asset - Unified Inbox', 'x'),
    );
    assert.equal(
      screenNames(major).name('Marketing Assets - Unified Inbox'),
      'Marketing Asset - Unified Inbox',
      'the spelling used most wins',
    );
    assert.equal(names.name('Never seen'), 'Never seen', 'a tag nobody used is left as it is');
  });
});

describe('where a rule was seen', () => {
  const c = library();
  const names = screenNames(c);
  const notesOf = (r: Rule) =>
    r.evidence.flatMap((e) =>
      c.batches[0].notes
        .filter((n) => n.ref === e.note)
        .map((n) => ({ batch: c.batches[0], note: n })),
    );

  it('rolls the sources and tags of its notes up, each once, sources in the usual order', () => {
    const seen = seenOn(notesOf(c.rules[0]), names);
    assert.deepEqual(seen, [
      { source: 'ours', tags: ['Marketing Assets - Unified Inbox'] },
      { source: 'other', tags: [] },
    ]);
    assert.equal(seenOnLine(seen), 'Ours (Marketing Assets - Unified Inbox); Other product');
    assert.deepEqual(seenOn(notesOf(c.rules[1]), names), [
      { source: 'ours', tags: ['Marketing Assets - Unified Inbox', 'Unified Inbox'] },
    ]);
  });

  it('says so for a note with no source', () => {
    const lone = c.batches[0].notes
      .filter((n) => n.ref === '05.1')
      .map((n) => ({ batch: c.batches[0], note: n }));
    assert.equal(seenOnLine(seenOn(lone, names)), 'Source not set (Linear)');
  });
});

describe('the index', () => {
  const c = library();
  const md = screenIndex(c, rulesOf(c), '2026-10-22T09:00:00Z');

  it('counts images, notes, praise, critique and rules for each source and tag', () => {
    assert.match(md, /5 images with notes, 6 notes, 2 rules/);
    assert.match(md, /## Ours\n\n3 images, 4 notes\./);
    assert.match(
      md,
      /\| Marketing Assets - Unified Inbox \| 2 \| 3 \| 2 \| 1 \| 2 \| Marketing Asset - Unified Inbox, marketing assets - unified inbox \|/,
    );
    assert.match(md, /\| Unified Inbox \| 1 \| 1 \| 0 \| 1 \| 1 \| {2}\|/);
    assert.match(
      md,
      /## Other product\n\n1 image, 1 note\.\n[\s\S]*\| \(no tag\) \| 1 \| 1 \| 1 \| 0 \| 1 \|/,
    );
    assert.match(md, /## Source not set[\s\S]*\| Linear \| 1 \| 1 \| 1 \| 0 \| 0 \|/);
  });

  it('counts two screenshots with one file name as two', () => {
    const twin = library();
    twin.batches[0].notes.push(note('08.1', 'a.png', 'ours', 'Linear', 'x'));
    assert.match(screenIndex(twin, rulesOf(twin), '2026-10-22T09:00:00Z'), /6 images with notes/);
  });

  it('opens with a reading order, and says what Pinch does not know', () => {
    assert.match(md, /## Reading order\n\n1\. Read `design-rules\.md`/);
    assert.match(md, /open the close-up behind it/);
    assert.match(md, /doesn’t record which sets are the target style/);
  });

  it('puts a tag with no name last and escapes a pipe', () => {
    const odd = library();
    odd.batches[0].notes.push(
      note('06.1', 'f.png', 'ours', 'A | B', 'Fine.'),
      note('06.2', 'g.png', 'ours', undefined, 'Fine.'),
    );
    const out = screenIndex(odd, rulesOf(odd), '2026-10-22T09:00:00Z');
    assert.match(out, /\| A \\\| B \| 1 \| 1 \|/);
    const ours = out.slice(out.indexOf('## Ours'), out.indexOf('## Other product'));
    assert.ok(ours.indexOf('(no tag)') > ours.indexOf('| Unified Inbox |'), 'no tag comes last');
  });
});

describe('the package with its index (D105)', () => {
  it('holds index.md, and each rule says where it was seen, in the text and the data', async () => {
    const c = library();
    const made = rulesPackage(c, new Map(), '2026-10-22T09:00:00Z');
    const root = 'pinch-rules-my-rules-2026-10-22/';
    const back = await unzip(
      new Uint8Array(await new Blob(zip(made.files) as BlobPart[]).arrayBuffer()),
    );
    const read = (name: string) => new TextDecoder().decode(back.get(root + name));
    assert.match(read('README.md'), /`index\.md`: where to start/);
    assert.match(read('index.md'), /^# Index: My rules/);
    assert.match(
      read('design-rules.md'),
      /Seen on: Ours \(Marketing Assets - Unified Inbox\); Other product\./,
    );
    assert.match(read('design-rules.md'), /`index\.md` sorts all the notes/);
    const json = JSON.parse(read('rules.json'));
    assert.equal(json.version, 4);
    assert.deepEqual(json.rules[0].seenOn, [
      { source: 'ours', tags: ['Marketing Assets - Unified Inbox'] },
      { source: 'other', tags: [] },
    ]);
  });
});

describe('the review sheets (D106)', () => {
  const c = library();
  const rules = rulesOf(c);
  const cells = reviewCells(c.batches[0], rules, screenNames(c));

  it('plans a cell for every note, with its words, its design and its rules', () => {
    assert.equal(cells.length, 6);
    assert.deepEqual(cells[0], {
      ref: '01.1',
      verdict: 'good',
      about: 'Ours; Marketing Assets - Unified Inbox',
      works: 'Clean.',
      doesNot: '',
      rules: ['R1'],
      crop: 'crops/01.1.jpg',
    });
    assert.equal(cells[1].verdict, 'bad');
    assert.deepEqual(cells[1].rules, ['R2']);
    assert.equal(cells[5].about, 'Linear', 'a note with no source still says its tag');
    assert.deepEqual(cells[5].rules, [], 'a note no rule draws on');
  });

  it('splits into sheets of nine, named in order', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...cells[0], ref: `${i + 1}.1` }));
    assert.deepEqual(
      reviewPages(many).map((p) => p.length),
      [9, 9, 2],
    );
    assert.equal(reviewFile(0), 'review-01.jpg');
    assert.equal(reviewFile(11), 'review-12.jpg');
    assert.equal(reviewSpan(reviewPages(many)[0]), '1.1 to 9.1');
    assert.equal(reviewSpan([cells[0]]), '01.1');
  });

  it('goes into the package and is listed in the index, only for a batch that has them', async () => {
    const sheet = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
    const made = rulesPackage(
      c,
      new Map([['b1', new Map()]]),
      '2026-10-22T09:00:00Z',
      new Map([['b1', [sheet]]]),
    );
    const root = 'pinch-rules-my-rules-2026-10-22/';
    const names = made.files.map((f) => f.name);
    assert.ok(names.includes(`${root}batches/01-pinch-2026-10-21/review-01.jpg`));
    const index = new TextDecoder().decode(
      made.files.find((f) => f.name === `${root}index.md`)?.data,
    );
    assert.match(index, /## Review sheets/);
    assert.match(index, /`batches\/01-pinch-2026-10-21\/review-01\.jpg`: notes 01\.1 to 05\.1/);
    assert.match(index, /open a batch’s review sheets/);

    const none = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    assert.ok(!none.files.some((f) => f.name.includes('review-')));
    const bare = new TextDecoder().decode(
      none.files.find((f) => f.name === `${root}index.md`)?.data,
    );
    assert.doesNotMatch(bare, /Review sheets/);
  });
});
