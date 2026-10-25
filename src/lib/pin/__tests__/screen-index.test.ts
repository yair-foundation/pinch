import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type BatchNote,
  type Collection,
  mergeCollection,
  newCollection,
  noteAbout,
  picked,
  printOf,
  type Rule,
  rulesOf,
  rulesPackage,
  rulesText,
  screenOf,
  screenTagsIn,
  withBest,
  withOpenBest,
} from '../learnings';
import { answer } from '../agent';
import { withChecks } from '../checks';
import { CHECKS_FILE, checksGuide } from '../package-checks';
import { reviewCells, reviewFile, reviewPages, reviewSpan } from '../review-sheets';
import {
  briefOf,
  briefsOf,
  KEEP_IN_PINCH,
  LIVE_RULES_WIN,
  MAX_BRIEF,
  OPEN_CALLS,
  outsideTarget,
  REVIEW_LINE,
  roleOf,
  screenGroup,
  screenIndex,
  screenNames,
  screenNamesOf,
  screenSets,
  seenOn,
  seenOnLine,
  sourceRoleOf,
  sourceSets,
  withBrief,
  withScreenRole,
  WORKING_LINES,
  withSourceRole,
} from '../screen-index';
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
      /\| Marketing Assets - Unified Inbox \| {2}\| 2 \| 3 \| 2 \| 1 \| 0 \| 2 \| Marketing Asset - Unified Inbox, marketing assets - unified inbox \|/,
    );
    assert.match(md, /\| Unified Inbox \| {2}\| 1 \| 1 \| 0 \| 1 \| 0 \| 1 \| {2}\|/);
    assert.match(
      md,
      /## Other product\n\n1 image, 1 note\.\n[\s\S]*\| \(no tag\) \| {2}\| 1 \| 1 \| 1 \| 0 \| 0 \| 1 \|/,
    );
    assert.match(md, /## Source not set[\s\S]*\| Linear \| {2}\| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \|/);
  });

  it('counts two screenshots with one file name as two', () => {
    const twin = library();
    twin.batches[0].notes.push(note('08.1', 'a.png', 'ours', 'Linear', 'x'));
    assert.match(screenIndex(twin, rulesOf(twin), '2026-10-22T09:00:00Z'), /6 images with notes/);
  });

  it('opens with a reading order, and says what the target style is', () => {
    assert.match(md, /## Reading order\n\n1\. Read `design-rules\.md`/);
    assert.match(md, /open the close-up behind it/);
    assert.match(md, /target style is the sum of everything their notes say works/);
    assert.match(md, /avoid what the screenshot does there and follow what the words ask for/);
    assert.doesNotMatch(md, /read the notes, or ask/);
  });

  it('puts a tag with no name last and escapes a pipe', () => {
    const odd = library();
    odd.batches[0].notes.push(
      note('06.1', 'f.png', 'ours', 'A | B', 'Fine.'),
      note('06.2', 'g.png', 'ours', undefined, 'Fine.'),
    );
    const out = screenIndex(odd, rulesOf(odd), '2026-10-22T09:00:00Z');
    assert.match(out, /\| A \\\| B \| {2}\| 1 \| 1 \|/);
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
      best: false,
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
    assert.match(
      index,
      /\*\*01-pinch-2026-10-21\*\*/,
      'each batch is headed by its folder, which is unique',
    );
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

describe('a rule with no notes in design-rules.md', () => {
  it('has no "From 0 notes" line', async () => {
    const c = library();
    c.rules.push({ ...rule('c', []), taste: 'dark' });
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    const md = new TextDecoder().decode(
      made.files.find((f) => f.name.endsWith('/design-rules.md'))?.data,
    );
    assert.match(md, /Rule c\.\n\nThe designer's own pick in Pinch's taste check\./);
    assert.doesNotMatch(md, /From 0 notes/);
    assert.match(md, /From 2 notes:/, 'a rule with notes still lists them');
  });
});

describe('taste settled in conversation goes back to Pinch (D117)', () => {
  it('is said in the rules text, design-rules.md and index.md', () => {
    const c = library();
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    const read = (end: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(end))?.data);
    for (const text of [rulesText(c, rulesOf(c)), read('/design-rules.md'), read('/index.md')])
      assert.ok(text.includes(KEEP_IN_PINCH));
    assert.match(read('/index.md'), /\n7\. When the author settles something about their taste/);
    assert.match(KEEP_IN_PINCH, /propose_rule/);
  });
});

describe('the rules as Pinch gives them now win over the agent’s notes (D118)', () => {
  it('is said in the rules text, design-rules.md and index.md', () => {
    const c = library();
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-24T09:00:00Z');
    const read = (end: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(end))?.data);
    for (const text of [rulesText(c, rulesOf(c)), read('/design-rules.md'), read('/index.md')])
      assert.ok(text.includes(LIVE_RULES_WIN));
    assert.match(LIVE_RULES_WIN, /get_design_rules/);
  });
});

describe('how the agent works over many pieces (D119)', () => {
  it('ends reports with the open calls, keeps a tracker and lanes, and checks earlier work again', () => {
    const c = library();
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-24T09:00:00Z');
    const read = (end: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(end))?.data);
    for (const text of [rulesText(c, rulesOf(c)), read('/design-rules.md'), read('/index.md')])
      assert.ok(text.includes(OPEN_CALLS));
    const index = read('/index.md');
    assert.match(index, /\n8\. When you report on your work/);
    assert.match(index, /## Working on many pieces\n\n- Keep one tracker/);
    for (const l of WORKING_LINES) assert.ok(index.includes(l));
    assert.match(read('/checks.md'), /\n8\. \*\*Check earlier work again when anything shared changes\.\*\*/);
  });

  it('reviews each render in two passes: what it shows, then the rules (D126)', async () => {
    const c = library();
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-25T09:00:00Z');
    const read = (end: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(end))?.data);
    assert.ok(read('/checks.md').includes(`A passing check is not a design review. ${REVIEW_LINE}`));
    assert.ok(read('/index.md').includes(REVIEW_LINE));
    const init = (await answer(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      async () => null,
    )) as { result: { instructions: string } };
    assert.ok(init.result.instructions.includes(REVIEW_LINE));
  });
});

describe('the same screen tag for the agent (D108)', () => {
  it('picks and lists rules by a tag whatever its spelling', () => {
    const c = library();
    const [a, b] = c.rules;
    assert.ok(picked(a, { screen: ['marketing asset – unified inbox'] }, c));
    assert.ok(picked(b, { screen: ['MARKETING ASSETS - UNIFIED INBOX'] }, c));
    assert.ok(!picked(a, { screen: ['Unified Inbox'] }, c), 'a narrower set is its own');
    assert.deepEqual(screenOf(c, b), ['Marketing Assets - Unified Inbox', 'Unified Inbox']);
    assert.deepEqual(screenTagsIn(c, c.rules), [
      { value: 'Marketing Assets - Unified Inbox', n: 2 },
      { value: 'Unified Inbox', n: 1 },
    ]);
  });
});

describe('a best example (D108)', () => {
  const at = { batchId: 'b1', note: '01.1' };

  it('is marked and unmarked on a note that says what works, and only there', () => {
    const c = library();
    const marked = withBest(c, at, true, 'now');
    assert.equal(marked.batches[0].notes[0].best, true);
    assert.equal(marked.updatedAt, 'now');
    assert.equal(withBest(marked, at, true, 'later'), marked, 'already marked: unchanged');
    const unmarked = withBest(marked, at, false, 'later');
    assert.ok(!('best' in unmarked.batches[0].notes[0]));
    const onlyBad = { batchId: 'b1', note: '02.1' };
    assert.equal(withBest(c, onlyBad, true, 'now'), c, 'a note on what doesn’t work can’t be one');
    assert.equal(withBest(c, { batchId: 'b1', note: '99.9' }, true, 'now'), c);
  });

  it('survives a merge, whichever copy of the note is kept', () => {
    const into = library();
    const from = withBest({ ...library(), id: 'c2' }, at, true, 'now');
    from.batches = from.batches.map((b) => ({ ...b, id: 'b2' }));
    from.rules = [];
    const merged = mergeCollection(into, from, 'later');
    assert.equal(merged.batches.length, 1, 'the same notes are not kept twice');
    assert.equal(merged.batches[0].notes[0].best, true);
  });

  it('is said wherever the note is: the agent’s text, the rules, the index and the sheets', async () => {
    const c = withBest(library(), at, true, 'now');
    assert.equal(
      noteAbout(c.batches[0].notes[0]),
      " (Ours; tag Marketing Assets - Unified Inbox; the author's best example)",
    );
    const rules = rulesOf(c);
    assert.match(rulesText(c, rules), /weigh it above the others/);
    assert.match(rulesText(c, rules), /the author's best example\): works: "Clean\."/);

    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    const json = JSON.parse(read('rules.json'));
    assert.equal(json.rules[0].notes[0].best, true);
    assert.ok(!('best' in json.rules[0].notes[1]));
    assert.match(read('design-rules.md'), /best example" is one they hold up/);

    const index = read('index.md');
    assert.match(index, /\| Best \| Rules \|/);
    assert.match(
      index,
      /\| Marketing Assets - Unified Inbox \| {2}\| 2 \| 3 \| 2 \| 1 \| 1 \| 2 \|/,
    );
    assert.match(index, /6\. The author marked 1 note as a best example: the one they hold up/);
    assert.match(index, /7\. Turn the rules a rendered page can decide into checks/);
    assert.match(
      index,
      /## Best examples\n\n.*\n\n- `batches\/01-pinch-2026-10-21\/crops\/01\.1\.jpg`, note 01\.1 on a\.png \(Ours; Marketing Assets - Unified Inbox\): “Clean\.” \(R1\)/,
    );
    assert.equal(reviewCells(c.batches[0], rules, screenNames(c))[0].best, true);
  });

  it('leaves the index as it was when there is none', () => {
    const c = library();
    const index = screenIndex(c, rulesOf(c), '2026-10-22T09:00:00Z');
    assert.doesNotMatch(index, /Best examples|best examples/);
    assert.match(index, /\n6\. Turn the rules a rendered page can decide into checks/);
    assert.match(
      index,
      /On the author’s own product \(Ours\), a note on what doesn’t work also says what not to carry over/,
    );
  });
});

describe('render checks in the package (D108)', () => {
  it('gives the method and a worklist row for every rule, by its lasting key', () => {
    const c = library();
    const rules = rulesOf(c);
    const md = checksGuide(c, rules, '2026-10-22T09:00:00Z');
    assert.match(md, /^# Render checks: My rules/);
    assert.match(md, /2 rules, 0 of them held to a place/);
    assert.match(md, /Name it by the rule’s `key`/);
    assert.match(md, /\| R1 \| `a` \| Rule a\. \| {2}\| {2}\| {2}\|/);
    assert.match(md, /\| R2 \| `b` \| Rule b\. \|/);
  });

  it('is in the package, named in its README, and rules.json carries each key', () => {
    const c = library();
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    const names = made.files.map((f) => f.name);
    assert.ok(names.includes(`pinch-rules-my-rules-2026-10-22/${CHECKS_FILE}`));
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    assert.match(read('README.md'), /`checks\.md`: how to turn the rules/);
    assert.deepEqual(
      JSON.parse(read('rules.json')).rules.map((r: { id: string; key: string }) => [r.id, r.key]),
      [
        ['R1', 'a'],
        ['R2', 'b'],
      ],
    );
  });
});

describe('one spelling per set while typing (D110)', () => {
  it('names a typed tag by the spelling already in use, and lists each set once', () => {
    const known = screenNamesOf(['Marketing Assets - Unified Inbox', 'Co-pilot', 'Co-pilot']);
    assert.equal(known.name('marketing asset – unified inbox'), 'Marketing Assets - Unified Inbox');
    assert.equal(known.name('Copilot'), 'Co-pilot');
    assert.equal(known.name('Reports'), 'Reports', 'a new set keeps its own spelling');
    assert.deepEqual(screenNamesOf(['b', 'A', 'a', 'B ', 'b']).all(), ['b', 'A']);
  });
});

describe('a best example marked on an image (D110)', () => {
  it('goes out in notes.json, comes back on import, and reaches the reading', async () => {
    const { manifest, readme } = await import('../model');
    const { batchNotes, readExport, assetsOf } = await import('../import');
    const { learnPrompt, learnSystem } = await import('../learn');
    const asset = {
      id: 'a1',
      name: 'Inbox.png',
      type: 'image/png',
      width: 100,
      height: 100,
      note: '',
      marks: [
        {
          id: 'm1',
          shape: { kind: 'dot' as const, x: 0.5, y: 0.5 },
          label: '',
          good: 'Clean.',
          bad: '',
          origin: 'user' as const,
          best: true,
        },
        {
          id: 'm2',
          shape: { kind: 'dot' as const, x: 0.2, y: 0.2 },
          label: '',
          good: '',
          bad: 'Busy.',
          origin: 'user' as const,
          best: true,
        },
      ],
    };
    const data = manifest([asset], '2026-10-23T10:00:00Z');
    assert.equal(data.assets[0].notes[0].best, true);
    assert.ok(!('best' in data.assets[0].notes[1]), 'only a note that says what works');
    assert.match(
      readme([asset], '2026-10-23T10:00:00Z'),
      /The author's best example: the one to follow\./,
    );
    const files = new Map([['pinch-x/notes.json', new TextEncoder().encode(JSON.stringify(data))]]);
    const exp = readExport(files);
    assert.equal(batchNotes(exp)[0].best, true);
    assert.ok(!('best' in batchNotes(exp)[1]));
    files.set(
      'pinch-x/' + data.assets[0].image,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    );
    assert.equal(assetsOf(exp, files, () => 'id').assets[0].asset.marks[0].best, true);
    assert.match(
      learnPrompt({
        notes: [{ id: 'n1', works: 'Clean.', doesNotWork: '', topics: [], best: true }],
        rules: [],
      }),
      /"bestExample":true/,
    );
    assert.match(learnSystem, /bestExample is one the designer holds up/);
  });

  it('reaches the rules from the open images, and a note never marked there keeps its mark', () => {
    const c = withBest(library(), { batchId: 'b1', note: '01.1' }, true, 'now');
    const print = (ref: string) =>
      printOf(c.batches[0].notes.find((n) => n.ref === ref) as BatchNote);
    assert.equal(withOpenBest(c, new Map(), 'later'), c, 'nothing marked on the images');
    const unmarked = withOpenBest(c, new Map([[print('01.1'), false]]), 'later');
    assert.ok(!('best' in unmarked.batches[0].notes[0]));
    const marked = withOpenBest(c, new Map([[print('02.2'), true]]), 'later');
    assert.equal(marked.batches[0].notes.find((n) => n.ref === '02.2')?.best, true);
    assert.equal(marked.batches[0].notes[0].best, true, 'the other mark stays');
    const bad = withOpenBest(c, new Map([[print('02.1'), true]]), 'later');
    assert.equal(bad, c, 'a note that only says what doesn’t work can’t be one');
  });
});

describe('a role for each set of screenshots (D110)', () => {
  it('is given once for a set, whatever its spelling, and taken back', () => {
    const c = withScreenRole(library(), 'marketing asset – unified inbox', 'target', 'now');
    assert.equal(roleOf(c, 'Marketing Assets - Unified Inbox'), 'target');
    assert.equal(roleOf(c, 'Unified Inbox'), undefined);
    assert.equal(
      roleOf(
        withScreenRole(c, 'Marketing Assets - Unified Inbox', null, 'x'),
        'Marketing Asset - Unified Inbox',
      ),
      undefined,
    );
    assert.deepEqual(screenSets(c), [
      { name: 'Marketing Assets - Unified Inbox', notes: 3 },
      { name: 'Unified Inbox', notes: 1 },
      { name: 'Linear', notes: 1 },
    ]);
  });

  it('goes into the index, the rules, rules.json and the agent’s text', () => {
    let c = withScreenRole(library(), 'Marketing Assets - Unified Inbox', 'target', 'now');
    c = withScreenRole(c, 'Unified Inbox', 'today', 'now');
    const rules = rulesOf(c);
    const index = screenIndex(c, rules, '2026-10-22T09:00:00Z');
    assert.match(index, /\| Screen tag \| Role \| Images \|/);
    assert.match(index, /\| Marketing Assets - Unified Inbox \| Target style \| 2 \|/);
    assert.match(index, /\| Unified Inbox \| How it looks today \| 1 \|/);
    assert.match(index, /\| \(no tag\) \| {2}\| 1 \|/);
    assert.match(index, /Where the author gave a set a role \(the Role column, or a whole source in its heading\)/);
    assert.doesNotMatch(screenIndex(library(), rulesOf(library()), 'x'), /the Role column/);
    assert.match(
      rulesText(c, rules),
      /The author gave these screenshots a role \(a tag’s own role comes first\): “Marketing Assets - Unified Inbox” is the target style: the look to aim for; “Unified Inbox” is how the product looks today/,
    );
    const made = rulesPackage(c, new Map(), '2026-10-22T09:00:00Z');
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    assert.match(
      read('design-rules.md'),
      /Seen on: Ours \(Marketing Assets - Unified Inbox, target style; Unified Inbox, how it looks today\)\./,
    );
    assert.deepEqual(JSON.parse(read('rules.json')).screenRoles, [
      { tag: 'Marketing Assets - Unified Inbox', role: 'target' },
      { tag: 'Unified Inbox', role: 'today' },
    ]);
  });

  it('survives a merge, this one’s roles first', () => {
    const into = withScreenRole(library(), 'Unified Inbox', 'today', 'n');
    const from = withScreenRole(
      withScreenRole({ ...library(), id: 'c2' }, 'Unified Inbox', 'target', 'n'),
      'Linear',
      'principle',
      'n',
    );
    from.batches = from.batches.map((b) => ({ ...b, id: 'b2' }));
    const merged = mergeCollection(into, from, 'later');
    assert.equal(roleOf(merged, 'Unified Inbox'), 'today');
    assert.equal(roleOf(merged, 'Linear'), 'principle');
  });
});

describe('a role for every screenshot of a source (D111)', () => {
  it('is given to a source, and a tag’s own role comes first', () => {
    let c = withSourceRole(library(), 'other', 'target', 'now');
    assert.equal(sourceRoleOf(c, 'other'), 'target');
    assert.ok(outsideTarget(c));
    assert.ok(
      !outsideTarget(withSourceRole(library(), 'ours', 'target', 'now')),
      'our own product is not outside',
    );
    assert.deepEqual(sourceSets(c), [
      { source: 'ours', notes: 4 },
      { source: 'other', notes: 1 },
    ]);
    c = withSourceRole(c, 'other', null, 'later');
    assert.equal(sourceRoleOf(c, 'other'), undefined);
  });

  it('tells the agent outside products are the target style in look, never in product', () => {
    let c = withSourceRole(library(), 'other', 'target', 'now');
    c = withScreenRole(c, 'Unified Inbox', 'today', 'now');
    const rules = rulesOf(c);
    const index = screenIndex(c, rules, '2026-10-22T09:00:00Z');
    assert.match(index, /## Other product · Target style/);
    assert.match(
      index,
      /## Other product · Target style\n\n.*\n\n.*\n.*\n\| \(no tag\) \| Target style \| 1 \|/,
    );
    assert.match(
      index,
      /gives a principle, never a copy, unless the author made it the target style\. Screenshots of someone else’s product that the author made the target style show the look to aim for: match their quality and look, never their product, brand or content\./,
    );
    assert.doesNotMatch(
      index,
      /\(Competitor, Other product, Concept\) gives a principle, never a copy\./,
    );
    assert.match(
      rulesText(c, rules),
      /every Other product screenshot is the target style: the look to aim for; “Unified Inbox” is how the product looks today/,
    );
    assert.match(rulesText(c, rules), /never their product, brand or content/);
    const made = rulesPackage(c, new Map(), '2026-10-22T09:00:00Z');
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    assert.match(
      read('design-rules.md'),
      /\n- A rule drawn from someone else's product \(Competitor, Other product, Concept\) carries a principle, never a copy, unless the author made it the target style\. Screenshots of someone else’s product that the author made the target style/,
    );
    assert.match(
      read('design-rules.md'),
      /Seen on: Ours \(Marketing Assets - Unified Inbox\); Other product, target style\./,
    );
    assert.deepEqual(JSON.parse(read('rules.json')).screenRoles, [
      { source: 'other', role: 'target' },
      { tag: 'Unified Inbox', role: 'today' },
    ]);
    const plainIndex = screenIndex(library(), rulesOf(library()), 'x');
    assert.match(
      plainIndex,
      /\(Competitor, Other product, Concept\) gives a principle, never a copy\./,
    );
  });
});

describe('the guides follow the author’s roles, marks and checks (D114)', () => {
  const packaged = (c: Collection) => {
    const made = rulesPackage(c, new Map([['b1', new Map()]]), '2026-10-22T09:00:00Z');
    return (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
  };

  it('says “never copy” only where no outside product is the target style', () => {
    const plain = packaged(library());
    assert.match(
      plain('design-rules.md'),
      /- A rule drawn from someone else's product \(Competitor, Other product, Concept\) carries a principle; never copy that design\./,
    );
    assert.match(plain('checks.md'), /A rule drawn from someone else’s product is a principle: check the principle/);

    const read = packaged(withSourceRole(library(), 'other', 'target', 'now'));
    const rules = read('design-rules.md');
    assert.doesNotMatch(rules, /never copy that design/);
    assert.equal(rules.split('match their quality and look').length - 1, 1, 'said once');
    assert.doesNotMatch(read('checks.md'), /is a principle: check the principle/);
    assert.match(
      read('checks.md'),
      /that the author made the target style may hold its look \(sizes, spacing, colours\), never its product, brand or content/,
    );
  });

  it('speaks of best examples only when the author marked one', () => {
    const c = library();
    const plain = packaged(c);
    assert.doesNotMatch(plain('design-rules.md'), /best example/);
    assert.doesNotMatch(plain('checks.md'), /best examples/);
    assert.doesNotMatch(rulesText(c, rulesOf(c)), /best example/);

    const marked = withBest(c, { batchId: 'b1', note: '01.1' }, true, 'now');
    const read = packaged(marked);
    assert.match(read('design-rules.md'), /best example" is one they hold up/);
    assert.match(read('checks.md'), /marked as their best examples are the strongest evidence/);
    assert.match(rulesText(marked, rulesOf(marked)), /weigh it above the others/);
  });

  it('sends the agent to the ready checks first, when there are any', () => {
    const c = withChecks(
      library(),
      [{ kind: 'bannedFonts', value: ['Nunito'], rules: ['a'], why: 'Named.' }],
      'basis',
      'now',
    );
    const index = screenIndex(c, rulesOf(c), '2026-10-22T09:00:00Z');
    assert.match(
      index,
      /\n6\. Run the checks Pinch worked out from the rules on every render: `checks\.json`, with `check-render\.js`/,
    );
    assert.match(index, /Then turn the other rules a rendered page can decide into checks/);
  });
});

describe('a brief for each product or feature (D121)', () => {
  const INBOX = 'One place for every guest message.  It should feel calm and quick.';

  it('is written once for a set, whatever its spelling, kept short, and taken away when emptied', () => {
    const c = withBrief(library(), 'marketing asset – unified inbox', `  ${INBOX} `, 'now');
    assert.equal(briefOf(c, 'Marketing Assets - Unified Inbox'), INBOX);
    assert.equal(briefOf(c, 'Unified Inbox'), '');
    assert.equal(withBrief(c, 'x', 'a'.repeat(MAX_BRIEF + 50), 'n').briefs?.x.length, MAX_BRIEF);
    assert.deepEqual(withBrief(c, 'Marketing Assets - Unified Inbox', '   ', 'n').briefs, {});
  });

  it('lists the briefs by set, every one or the ones asked for', () => {
    let c = withBrief(library(), 'Unified Inbox', 'Triage first.', 'n');
    c = withBrief(c, 'Marketing Assets - Unified Inbox', INBOX, 'n');
    c = withBrief(c, 'Gone', 'No notes carry this tag.', 'n');
    assert.deepEqual(briefsOf(c), [
      {
        tag: 'Marketing Assets - Unified Inbox',
        brief: 'One place for every guest message. It should feel calm and quick.',
      },
      { tag: 'Unified Inbox', brief: 'Triage first.' },
    ]);
    // One product under two sets, its target style and its screens today: both briefs (D130).
    assert.deepEqual(
      briefsOf(c, ['unified inbox']).map((b) => b.tag),
      ['Marketing Assets - Unified Inbox', 'Unified Inbox'],
    );
    assert.deepEqual(
      briefsOf(c, ['Linear']).map((b) => b.tag),
      [],
    );
  });

  it('goes to the agent before the rules, the ones for the screen tags it asked for', () => {
    const c = withBrief(
      withBrief(library(), 'Unified Inbox', 'Triage first.', 'n'),
      'Linear',
      'Fast above all.',
      'n',
    );
    const all = rulesText(c, rulesOf(c));
    assert.match(all, /The author’s brief for each product or feature, what it is for and how it should feel\./);
    assert.match(all, /- “Unified Inbox”: Triage first\.\n- “Linear”: Fast above all\.\n\nR1\./);
    const one = rulesText(c, rulesOf(c), ['Linear']);
    assert.match(one, /“Linear”: Fast above all\./);
    assert.doesNotMatch(one, /Unified Inbox”: Triage/);
    assert.doesNotMatch(rulesText(library(), rulesOf(library())), /brief/);
  });

  it('goes into design-rules.md and rules.json', () => {
    const c = withBrief(library(), 'Unified Inbox', 'Triage first.', 'n');
    const made = rulesPackage(c, new Map(), '2026-10-24T09:00:00Z');
    const read = (name: string) =>
      new TextDecoder().decode(made.files.find((f) => f.name.endsWith(`/${name}`))?.data);
    assert.match(read('design-rules.md'), /## Briefs\n\n.*\n\n- \*\*Unified Inbox\*\*: Triage first\./);
    assert.deepEqual(JSON.parse(read('rules.json')).briefs, [
      { tag: 'Unified Inbox', brief: 'Triage first.' },
    ]);
    const bare = rulesPackage(library(), new Map(), '2026-10-24T09:00:00Z');
    const json = bare.files.find((f) => f.name.endsWith('/rules.json'))?.data;
    assert.equal('briefs' in JSON.parse(new TextDecoder().decode(json)), false);
  });

  it('survives a merge, this one’s briefs first', () => {
    const into = withBrief(library(), 'Unified Inbox', 'Ours.', 'n');
    const from = withBrief(
      withBrief({ ...library(), id: 'c2' }, 'Unified Inbox', 'Theirs.', 'n'),
      'Linear',
      'Fast.',
      'n',
    );
    from.batches = from.batches.map((b) => ({ ...b, id: 'b2' }));
    const merged = mergeCollection(into, from, 'later');
    assert.equal(briefOf(merged, 'Unified Inbox'), 'Ours.');
    assert.equal(briefOf(merged, 'Linear'), 'Fast.');
  });
});
