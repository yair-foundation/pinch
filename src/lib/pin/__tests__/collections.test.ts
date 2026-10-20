import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync, crc32 as nodeCrc } from 'node:zlib';

import { assetsOf, batchNotes, readExport } from '../import';
import {
  cleanReading,
  learnPrompt,
  learnRequestSchema,
  learnSchema,
  type CleanReading,
  type LearnResult,
  learnSystem,
  PREVIEW_RULES,
  previewReading,
} from '../learn';
import { FOUNDATION_SOURCES, foundationText, PRINCIPLES, SHORTHAND } from '../foundation';
import {
  answerRule,
  applyReading,
  type Batch,
  byTopic,
  type Collection,
  cleanTag,
  collectionSlug,
  confirmRule,
  imagesOf,
  knownNotes,
  mergeCollection,
  type NoteRef,
  newCollection,
  newNotes,
  noteFingerprint,
  noteKey,
  originOf,
  ownWords,
  picked,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesText,
  tagsOf,
  unlockRules,
  unreadNotes,
  upgradeCollection,
  waiting,
  withBatch,
  withRule,
} from '../learnings';
import { type Asset, type Mark, manifest } from '../model';
import { unzip } from '../unzip';
import { zip } from '../zip';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const text = (s: string) => new TextEncoder().encode(s);

let counter = 0;
const newId = () => `id${++counter}`;

/** A zip with deflated entries, as the system's "Compress" writes one. */
function deflatedZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const body = deflateRawSync(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(nodeCrc(e.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(nodeCrc(e.data), 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(e.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

const joined = (parts: Uint8Array[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));

describe('unzip', () => {
  it('reads back what the export writes', async () => {
    const files = await unzip(
      joined(
        zip([
          { name: 'pinch-x/README.md', data: text('# Notes\n') },
          { name: 'pinch-x/images/01-a.png', data: PNG },
        ]),
      ),
    );
    assert.deepEqual([...files.keys()], ['pinch-x/README.md', 'pinch-x/images/01-a.png']);
    assert.deepEqual(files.get('pinch-x/images/01-a.png'), PNG);
  });

  it('inflates a folder zipped again, and skips folders and macOS copies', async () => {
    const files = await unzip(
      deflatedZip([
        { name: 'pinch-x/', data: new Uint8Array() },
        { name: 'pinch-x/notes.json', data: text('{"a":1}') },
        { name: '__MACOSX/pinch-x/._notes.json', data: text('junk') },
      ]),
    );
    assert.deepEqual([...files.keys()], ['pinch-x/notes.json']);
    assert.equal(new TextDecoder().decode(files.get('pinch-x/notes.json')), '{"a":1}');
  });

  it('says when a file is not a zip', async () => {
    await assert.rejects(unzip(text('hello, not a zip at all, just words')), /isn’t a zip/);
  });
});

const mark = (over: Partial<Mark> = {}): Mark => ({
  id: 'm1',
  shape: { kind: 'dot', x: 0.25, y: 0.5 },
  label: '',
  good: '',
  bad: '',
  origin: 'user',
  ...over,
});

const assets: Asset[] = [
  {
    id: 'a1',
    name: 'Pricing.png',
    type: 'image/png',
    width: 1600,
    height: 1000,
    note: 'Calm overall',
    source: { kind: 'competitor' },
    marks: [
      mark({ good: 'Short headline.', topics: ['copy'], accepted: { good: 'Short headline.' } }),
      mark({ id: 'm2', shape: { kind: 'area', x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, bad: 'Cramped.' }),
      mark({ id: 'm3' }),
    ],
  },
  {
    id: 'a2',
    name: 'Home.jpg',
    type: 'image/jpeg',
    width: 800,
    height: 600,
    note: '',
    source: { kind: 'ours' },
    marks: [
      mark({
        id: 'm4',
        shape: { kind: 'arrow', x: 0.1, y: 0.2, x2: 0.8, y2: 0.2 },
        good: 'Aligned.',
        bad: 'Too far.',
        topics: ['layout', 'visual'],
      }),
    ],
  },
  { id: 'a3', name: 'Empty.png', type: 'image/png', width: 10, height: 10, note: '', marks: [] },
];

/** The files of an export of `assets`, as the app writes them. */
function exportFiles(root = 'pinch-2026-10-20/') {
  const data = manifest(assets, '2026-10-20T10:00:00.000Z');
  const files = new Map<string, Uint8Array>([
    [`${root}notes.json`, text(JSON.stringify(data))],
    [`${root}README.md`, text('# Design notes')],
  ]);
  files.set(root + data.assets[0].image, PNG);
  files.set(root + data.assets[1].image, JPEG);
  return files;
}

describe('reading an export', () => {
  it('finds notes.json and its folder', () => {
    const exp = readExport(exportFiles());
    assert.equal(exp.root, 'pinch-2026-10-20/');
    assert.equal(exp.assets.length, 2);
    assert.equal(readExport(exportFiles('')).root, '');
  });

  it('turns images and notes back into assets with new ids', () => {
    counter = 0;
    const { assets: back, missing } = assetsOf(readExport(exportFiles()), exportFiles(), newId);
    assert.equal(missing, 0);
    const [a, b] = back.map((x) => x.asset);
    assert.equal(a.name, 'Pricing.png');
    assert.equal(a.type, 'image/png');
    assert.equal(a.note, 'Calm overall');
    assert.deepEqual(a.source, { kind: 'competitor' });
    assert.equal(a.marks.length, 2, 'the empty note was never exported');
    assert.deepEqual(a.marks[0].topics, ['copy']);
    assert.deepEqual(a.marks[0].accepted, { good: 'Short headline.' });
    assert.deepEqual(a.marks[1].shape, { kind: 'area', x: 0.1, y: 0.1, w: 0.2, h: 0.3 });
    assert.equal(b.type, 'image/jpeg');
    assert.deepEqual(b.marks[0].shape, { kind: 'arrow', x: 0.1, y: 0.2, x2: 0.8, y2: 0.2 });
    assert.deepEqual(b.marks[0].topics, ['visual', 'layout']);
    assert.notEqual(a.id, 'a1');
    assert.equal(back[0].image.type, 'image/png');
  });

  it('counts an image whose file is missing, and refuses what is not an export', () => {
    const files = exportFiles();
    files.delete([...files.keys()].find((k) => k.endsWith('.jpg')) as string);
    assert.equal(assetsOf(readExport(files), files, newId).missing, 1);
    assert.throws(() => readExport(new Map([['a/README.md', text('#')]])), /no notes\.json/);
    assert.throws(
      () => readExport(new Map([['notes.json', text('{"tool":"Other"}')]])),
      /isn’t one this version/,
    );
    assert.throws(() => readExport(new Map([['notes.json', text('{')]])), /can’t be read/);
  });

  it('keeps each note with its number and close-up for a collection', () => {
    const notes = batchNotes(readExport(exportFiles()));
    assert.deepEqual(
      notes.map((n) => [n.ref, n.image, n.source, n.crop]),
      [
        ['01.1', 'Pricing.png', 'competitor', 'crops/01-pricing-note-1.jpg'],
        ['01.2', 'Pricing.png', 'competitor', 'crops/01-pricing-note-2.jpg'],
        ['02.1', 'Home.jpg', 'ours', 'crops/02-home-note-1.jpg'],
      ],
    );
    assert.deepEqual(notes[2].topics, ['visual', 'layout']);
  });
});

function collection(): Collection {
  counter = 0;
  const batch: Batch = {
    id: 'b1',
    name: 'pinch-2026-10-20',
    addedAt: '2026-10-20T11:00:00Z',
    exportedAt: '2026-10-20T10:00:00Z',
    root: 'pinch-2026-10-20/',
    images: 2,
    notes: batchNotes(readExport(exportFiles())),
  };
  return withBatch(newCollection('Acme', 'c1', '2026-10-20T11:00:00Z'), batch, 'now');
}

/** The ids the AI sees for the three notes of `collection()`. */
const sent = () =>
  new Map<string, NoteRef>([
    ['n1', { batchId: 'b1', note: '01.1' }],
    ['n2', { batchId: 'b1', note: '01.2' }],
    ['n3', { batchId: 'b1', note: '02.1' }],
  ]);

/** Two rules read from the notes: one drawing on notes across both images, one on a single note. */
function read(): Collection {
  return applyReading(
    collection(),
    {
      strengthen: [],
      propose: [
        {
          rule: 'Lead with a short headline that states the price.',
          context: 'on pricing cards',
          topics: ['copy', 'visual'],
          notes: ['n1', 'n3', 'n1', 'zz'],
        },
        {
          rule: 'Align related controls.',
          context: '',
          topics: ['layout'],
          notes: ['n3'],
        },
      ],
    },
    sent(),
    '2026-10-20T12:00:00Z',
    newId,
  );
}

describe('the taste library', () => {
  it('keeps a batch whose notes wait to be read, and adds only notes it hasn’t seen', () => {
    const c = collection();
    assert.equal(c.rules.length, 0);
    assert.deepEqual(
      unreadNotes(c).map((x) => x.note.ref),
      ['01.1', '01.2', '02.1'],
    );
    const notes = batchNotes(readExport(exportFiles()));
    assert.equal(newNotes(c, notes).length, 0, 'the same notes again are nothing new');
    const reworded = notes.map((n, i) => (i === 0 ? { ...n, works: 'A shorter headline.' } : n));
    assert.deepEqual(
      newNotes(c, reworded).map((n) => n.ref),
      ['01.1'],
    );
    assert.ok(knownNotes(c).has(noteFingerprint('Pricing.png', 'Short headline.', '')));
  });

  it('reads notes into rules: one rule on notes across images, one note in two rules', () => {
    const c = read();
    assert.deepEqual(
      c.rules.map((r) => [r.text, r.context, r.status, r.evidence.map((e) => e.note)]),
      [
        [
          'Lead with a short headline that states the price.',
          'on pricing cards',
          'approved',
          ['01.1', '02.1'],
        ],
        ['Align related controls.', '', 'approved', ['02.1']],
      ],
    );
    assert.deepEqual(c.rules[0].topics, ['visual', 'copy'], 'topics in their order');
    assert.equal(imagesOf(c, c.rules[0]), 2);
    assert.equal(originOf(c.rules[0]), 'ai');
    assert.equal(unreadNotes(c).length, 0, 'every note it was given counts as read');
  });

  it('strengthens a rule, flags a conflict, and keeps a new note once', () => {
    let c = read();
    const [first, second] = c.rules;
    c = withRule(c, first.id, { status: 'approved' }, 'x');
    c = withBatch(
      c,
      { ...c.batches[0], id: 'b2', notes: c.batches[0].notes.map((n) => ({ ...n })) },
      'x',
    );
    c = applyReading(
      c,
      {
        strengthen: [
          { rule: first.id, notes: ['m1', 'm1'] },
          { rule: 'gone', notes: ['m2'] },
        ],
        propose: [
          {
            rule: 'Keep controls loose in onboarding.',
            context: 'in onboarding',
            topics: ['layout'],
            notes: ['m2'],
            conflictsWith: second.id,
            conflict: 'One wants controls together, the other apart.',
          },
          { rule: '', context: '', topics: [], notes: ['m3'] },
        ],
      },
      new Map([
        ['m1', { batchId: 'b2', note: '01.1' }],
        ['m2', { batchId: 'b2', note: '01.2' }],
        ['m3', { batchId: 'b2', note: '02.1' }],
      ]),
      'later',
      newId,
    );
    const strong = c.rules.find((r) => r.id === first.id);
    assert.deepEqual(strong?.evidence.map(noteKey), ['b1/01.1', 'b1/02.1', 'b2/01.1']);
    assert.equal(strong?.fresh, 1, 'a rule says it has a new note');
    assert.equal(c.rules.length, 3, 'a proposal with no words is dropped');
    assert.deepEqual(c.rules[2].conflict, {
      ruleId: second.id,
      why: 'One wants controls together, the other apart.',
    });
    assert.equal(unreadNotes(c).length, 0);
  });

  it('keeps a preview’s hidden rules without their words, and reads them again once bought', () => {
    let c = applyReading(
      collection(),
      {
        strengthen: [],
        propose: [
          { rule: 'Shown.', context: '', topics: ['copy'], notes: ['n1'] },
          { rule: '', context: '', topics: ['layout'], notes: ['n2', 'n3'], locked: true },
        ],
      },
      sent(),
      'x',
      newId,
    );
    assert.deepEqual(
      c.rules.map((r) => [r.text, Boolean(r.locked)]),
      [
        ['Shown.', false],
        ['', true],
      ],
    );
    assert.deepEqual(
      rulesOf(c).map((r) => r.rule.text),
      ['Shown.'],
      'a hidden rule never exports',
    );
    c = unlockRules(c, 'bought');
    assert.equal(c.rules.length, 1);
    assert.deepEqual(
      unreadNotes(c).map((x) => x.note.ref),
      ['01.2', '02.1'],
    );
  });

  it('brings a collection of learnings, from before, up to date', () => {
    const old = {
      ...collection(),
      rules: undefined,
      read: undefined,
      learnings: [
        {
          id: 'l1',
          batchId: 'b1',
          note: '01.1',
          text: 'Lead with a short headline.',
          drafted: 'Lead.',
          topics: ['copy'],
        },
        { id: 'l2', batchId: 'b1', note: '01.2', text: '', drafted: '', topics: [] },
        { id: 'l3', batchId: 'b1', note: '02.1', text: '', topics: ['visual'] },
      ],
    } as unknown as Collection;
    const c = upgradeCollection(old, newId);
    assert.equal(c.learnings, undefined);
    assert.equal(
      upgradeCollection({ ...read(), rules: [{ ...read().rules[0], status: 'proposed' }] }, newId)
        .rules[0].status,
      'approved',
      'a rule proposed before D88 is guidance now',
    );
    assert.deepEqual(
      c.rules.map((r) => [r.text, r.status, r.evidence.map(noteKey), originOf(r)]),
      [['Lead with a short headline.', 'approved', ['b1/01.1'], 'ai-edited']],
    );
    assert.deepEqual(
      unreadNotes(c).map((x) => x.note.ref),
      ['02.1'],
      'a note the AI found nothing in stays read; one never drafted waits',
    );
  });

  it('keeps a question or a reading from agents until the author answers or confirms it', () => {
    const asking = applyReading(
      collection(),
      {
        strengthen: [],
        propose: [
          {
            rule: 'Keep headings short.',
            context: '',
            topics: ['copy'],
            notes: ['n1'],
            basis: 'interpreted',
            question: {
              ask: 'What do you like about this heading?',
              options: [
                { answer: 'Its short wording', rule: 'Keep headings short.' },
                { answer: 'Its size', rule: 'Make headings clearly larger than body text.' },
              ],
            },
          },
          {
            rule: 'Keep screens quiet: few elements competing for attention.',
            context: '',
            topics: ['visual'],
            notes: ['n2'],
            basis: 'interpreted',
            reading: '“quiet” as few elements competing for attention',
            principles: ['focus', 'colour'],
          },
        ],
      },
      sent(),
      'now',
      newId,
    );
    const [q, quiet] = asking.rules;
    assert.equal(q.basis, 'interpreted');
    assert.equal(q.question?.options.length, 2);
    assert.equal(waiting(q), true, 'a question waits for its answer');
    assert.equal(waiting(quiet), true, 'a reading waits for the author to confirm it');
    assert.equal(rulesOf(asking).length, 0, 'no agent gets a rule waiting for its author');

    const confirmed = confirmRule(asking, quiet.id, 'later');
    const yes = confirmed.rules[1];
    assert.equal(waiting(yes), false);
    assert.equal(yes.text, 'Keep screens quiet: few elements competing for attention.');
    assert.equal(originOf(yes), 'ai', 'confirmed, not rewritten');
    assert.deepEqual(
      rulesOf(confirmed).map((r) => r.rule.text),
      ['Keep screens quiet: few elements competing for attention.'],
      'confirmed, the agent gets it',
    );
    const md = rulesMarkdown(confirmed, rulesOf(confirmed), 'x');
    assert.match(md, /^Explained by: One focal point, Colour carries meaning\.$/m);
    assert.match(md, /the author's notes are what make it their preference/);
    assert.doesNotMatch(md, /Pinch's reading/);
    assert.match(rulesText(confirmed, rulesOf(confirmed)), /^ {3}Explained by: One focal point/m);
    assert.deepEqual(rulesManifest(confirmed, rulesOf(confirmed), 'x').rules[0].principles, [
      'focus',
      'colour',
    ]);

    const answered = answerRule(confirmed, q.id, 1, 'later');
    const a = answered.rules[0];
    assert.equal(a.text, 'Make headings clearly larger than body text.');
    assert.equal(a.basis, 'stated');
    assert.equal(a.question, undefined);
    assert.equal(originOf(a), 'ai', 'picked, not rewritten');
    assert.equal(rulesOf(answered).length, 2, 'answered, the agent gets it');
    assert.equal(answerRule(asking, q.id, 5, 'later'), asking, 'no such answer, no change');

    assert.deepEqual(
      asking.rules.filter((r) => picked(r, { principles: ['colour'] })).map((r) => r.id),
      [quiet.id],
      'browse by the principle that explains a rule',
    );
    assert.equal(asking.rules.filter((r) => picked(r, { principles: ['type'] })).length, 0);
    const removed = withRule(confirmed, quiet.id, { status: 'dismissed' }, 'later');
    assert.equal(rulesOf(removed).length, 0, 'a removed rule leaves exports');
    const rewritten = withRule(asking, quiet.id, ownWords({ text: 'Keep it calm.' }), 'later');
    assert.equal(rewritten.rules[1].basis, 'stated');
    assert.equal(rewritten.rules[1].reading, undefined);
    assert.equal(waiting(rewritten.rules[1]), false, 'rewritten, it is the author’s own');
    assert.deepEqual(
      rewritten.rules[1].principles,
      ['focus', 'colour'],
      'still explained, still browsed',
    );
  });

  it('slices by topic and by the author’s own tags', () => {
    let c = read();
    c = withRule(c, c.rules[1].id, { tags: ['Acme'] }, 'x');
    const [a, b] = c.rules;
    assert.equal(picked(a, { topics: ['copy'] }), true);
    assert.equal(picked(b, { topics: ['copy'] }), false);
    assert.equal(picked(b, { tags: ['Acme'] }), true);
    assert.equal(picked(a, { tags: [null] }), true, 'null takes the rules without a tag');
    assert.equal(picked(b, { tags: [null] }), false);
    assert.deepEqual(tagsOf(c.rules), ['Acme']);
    assert.equal(cleanTag('  Client   X  '), 'Client X');
    assert.deepEqual(
      byTopic(c.rules).map((g) => [g.label, g.rules.length]),
      [
        ['Visual', 1],
        ['Layout', 1],
      ],
    );
  });

  /** The two rules approved, the second edited and tagged. */
  function approved(): Collection {
    let c = read();
    const [a, b] = c.rules;
    c = withRule(c, a.id, { status: 'approved' }, 'x');
    c = withRule(
      c,
      b.id,
      { status: 'approved', text: 'Align related controls on one edge.', tags: ['Acme'] },
      'x',
    );
    return c;
  }

  it('exports rules as soon as they are written, numbered, each with every note it draws on', () => {
    const old = withRule(read(), read().rules[0].id, { status: 'dismissed' }, 'x');
    assert.equal(rulesOf(old).length, 1, 'a rule dismissed before D88 stays out');
    const c = approved();
    const rules = rulesOf(c);
    assert.deepEqual(
      rules.map((r) => [r.id, r.notes.map((n) => n.file)]),
      [
        ['R1', ['evidence/r01-1.jpg', 'evidence/r01-2.jpg']],
        ['R2', ['evidence/r02-1.jpg']],
      ],
    );
    const md = rulesMarkdown(c, rules, '2026-10-20T12:00:00Z');
    assert.match(md, /^# Design rules: Acme$/m);
    assert.match(md, /2 rules\./);
    assert.match(md, /^\*\*R1\.\*\* Lead with a short headline that states the price\.$/m);
    assert.match(md, /^Where: on pricing cards\.$/m);
    assert.match(md, /^From 2 notes:$/m);
    assert.match(
      md,
      /^- `evidence\/r01-1\.jpg`, note 01\.1 on Pricing\.png \(Competitor\): works: "Short headline\."$/m,
    );
    assert.match(md, /Tags: Acme\./);
    const data = rulesManifest(c, rules, 'x');
    assert.equal(data.version, 2);
    assert.equal(data.rules[0].where, 'on pricing cards');
    assert.equal(data.rules[1].origin, 'ai-edited');
    assert.equal(data.rules[0].notes[1].source, 'ours');
    assert.equal(collectionSlug('Acme Dashboard, v2'), 'acme-dashboard-v2');
  });

  it('picks the rules a task needs, and copies them as text', () => {
    const c = approved();
    assert.deepEqual(
      rulesOf(c, { tags: ['Acme'] }).map((r) => [r.id, r.rule.text]),
      [['R1', 'Align related controls on one edge.']],
      'numbering follows the pick',
    );
    assert.equal(rulesOf(c, { topics: ['copy'] }).length, 1);
    const text = rulesText(c, rulesOf(c));
    assert.match(text, /^Design rules from Acme \(Pinch\), 2 rules\./);
    assert.match(
      text,
      /^R1\. Lead with a short headline that states the price\. \(where: on pricing cards\) \[Visual, Copy\]$/m,
    );
    assert.match(
      text,
      /^ {3}- note 02\.1 on Home\.jpg \(Ours\): works: "Aligned\."; doesn't: "Too far\."$/m,
    );
    assert.doesNotMatch(text, /evidence/);
  });

  it('merges another collection into the one kept, never holding a note or a rule twice', () => {
    const c = approved();
    const [note1, note2, note3] = c.batches[0].notes;
    const other: Collection = {
      ...newCollection('Other', 'c2', 'x'),
      batches: [
        { ...c.batches[0], id: 'b2', notes: [note1, { ...note2, works: 'Room to breathe.' }] },
        { ...c.batches[0], id: 'b3', notes: [note3] },
      ],
      rules: [
        { ...c.rules[0], id: 'o1', evidence: [{ batchId: 'b2', note: '01.1' }] },
        {
          ...c.rules[1],
          id: 'o2',
          text: 'Give each section room to breathe.',
          evidence: [{ batchId: 'b2', note: '01.2' }],
        },
      ],
      read: ['b2/01.1', 'b2/01.2'],
    };
    const merged = mergeCollection(c, other, 'later');
    assert.equal(merged.id, c.id);
    assert.equal(merged.name, 'Acme');
    assert.deepEqual(
      merged.batches.map((b) => [b.id, b.notes.map((n) => n.ref)]),
      [
        ['b1', ['01.1', '01.2', '02.1']],
        ['b2', ['01.2']],
      ],
      'only the reworded note is new; a batch of known notes goes',
    );
    assert.equal(merged.rules.length, 3, 'the same rule, worded the same, shows once');
    assert.deepEqual(merged.rules[0].evidence.map(noteKey), ['b1/01.1', 'b1/02.1']);
    assert.deepEqual(merged.rules[2].evidence.map(noteKey), ['b2/01.2']);
    assert.ok(merged.read.includes('b1/01.1') && merged.read.includes('b2/01.2'));
    assert.equal(merged.updatedAt, 'later');
  });
});

const stated = {
  basis: 'stated' as const,
  reading: '',
  question: '',
  options: [],
  principles: [] as string[],
};

describe('reading notes into rules', () => {
  const request = () =>
    learnRequestSchema.parse({
      notes: [{ id: 'n1', works: 'Short headline.', topics: ['copy'], source: 'competitor' }],
      rules: [
        {
          id: 'r1',
          text: 'Separate content with spacing.',
          context: '',
          topics: ['layout'],
          status: 'approved',
        },
      ],
      shown: 1,
    });

  it('takes only words, and sends the library and the notes as data', () => {
    assert.equal(learnRequestSchema.safeParse({ notes: [] }).success, false);
    assert.equal(
      learnRequestSchema.safeParse({ notes: [{ id: 'n1', topics: ['nope'] }] }).success,
      false,
    );
    assert.deepEqual(learnRequestSchema.parse({ notes: [{ id: 'n1' }] }).rules, []);
    const prompt = learnPrompt(request());
    assert.match(prompt, /"whatWorks": "Short headline\."/);
    assert.match(prompt, /"whoseDesign": "Competitor"/);
    assert.match(prompt, /"rule": "Separate content with spacing\."/);
    assert.match(prompt, /"status": "approved"/);
    assert.doesNotMatch(prompt, /whatDoesnt/);
    assert.match(learnSchema.shape.propose.description ?? '', /New rules/);
    assert.match(learnSystem, /One judgment, one rule/);
    assert.match(learnSystem, /dense tables/);
    assert.match(learnSystem, /conflictsWith/);
    assert.match(learnSystem, /flow \(steps, navigation/);
  });

  it('keeps the answer to what it was sent', () => {
    const clean = cleanReading(
      {
        strengthen: [
          { rule: 'r1', notes: ['n1', 'n1', 'zz'] },
          { rule: 'r9', notes: ['n1'] },
        ],
        propose: [
          {
            rule: '  Lead with\n a short headline. ',
            context: ' on pricing cards ',
            topics: ['copy', 'visual', 'layout', 'flow'],
            notes: ['n1', 'zz'],
            conflictsWith: 'r1',
            conflict: 'r1 wants spacing; n1 wants density.',
            ...stated,
          },
          {
            rule: 'No notes.',
            context: '',
            topics: [],
            notes: ['zz'],
            conflictsWith: '',
            conflict: '',
            ...stated,
          },
          {
            rule: 'Unknown conflict.',
            context: '',
            topics: [],
            notes: ['n1'],
            conflictsWith: 'r7',
            conflict: 'x',
            ...stated,
            reading: 'A reading of a stated rule goes.',
          },
        ],
      },
      ['n1'],
      ['r1'],
    );
    assert.deepEqual(clean.strengthen, [{ rule: 'r1', notes: ['n1'] }]);
    assert.deepEqual(clean.propose, [
      {
        rule: 'Lead with a short headline.',
        context: 'on pricing cards',
        topics: ['visual', 'layout', 'copy'],
        notes: ['n1'],
        conflictsWith: 'r1',
        conflict: 'The other rule wants spacing; a note wants density.',
        basis: 'stated',
      },
      { rule: 'Unknown conflict.', context: '', topics: [], notes: ['n1'], basis: 'stated' },
    ]);
  });

  it('keeps Pinch’s reading of vague words, and a question only with answers to pick', () => {
    const vague = (extra: Partial<LearnResult['propose'][number]>) => ({
      rule: 'Keep screens quiet.',
      context: '',
      topics: [],
      notes: ['n1'],
      conflictsWith: '',
      conflict: '',
      ...stated,
      ...extra,
    });
    const clean = cleanReading(
      {
        strengthen: [],
        propose: [
          vague({
            basis: 'interpreted',
            reading: ' “quiet” as n1   says, few elements ',
            principles: ['focus', 'made-up', 'focus', 'colour', 'grouping', 'density'],
          }),
          vague({
            rule: 'Make headings large.',
            basis: 'stated',
            question: ' What do you like about this heading? ',
            options: [
              { answer: 'Its short wording', rule: 'Keep headings short.' },
              { answer: 'its short wording', rule: 'A twin.' },
              { answer: '', rule: 'No answer.' },
              { answer: 'Its size', rule: 'Make headings large.' },
              { answer: 'Its weight', rule: 'Set headings bold.' },
              { answer: 'Its colour', rule: 'Colour headings.' },
              { answer: 'Its place', rule: 'Place headings left.' },
            ],
          }),
          vague({
            question: 'Only one answer?',
            options: [{ answer: 'Yes', rule: 'One.' }],
          }),
        ],
      },
      ['n1'],
      [],
    );
    assert.deepEqual(clean.propose[0], {
      rule: 'Keep screens quiet.',
      context: '',
      topics: [],
      notes: ['n1'],
      basis: 'interpreted',
      reading: '“quiet” as a note says, few elements',
      principles: ['focus', 'colour', 'grouping'],
    });
    assert.equal(clean.propose[1].rule, 'Keep headings short.', 'the rule waits as its first answer');
    assert.equal(clean.propose[1].basis, 'interpreted');
    assert.deepEqual(clean.propose[1].question, {
      ask: 'What do you like about this heading?',
      options: [
        { answer: 'Its short wording', rule: 'Keep headings short.' },
        { answer: 'Its size', rule: 'Make headings large.' },
        { answer: 'Its weight', rule: 'Set headings bold.' },
        { answer: 'Its colour', rule: 'Colour headings.' },
      ],
    });
    assert.equal(clean.propose[2].question, undefined, 'one answer is no question');
    assert.equal(clean.propose[2].basis, 'stated');
  });

  it('shows a visitor the first rules and hides the rest’s words', () => {
    const r = {
      strengthen: [{ rule: 'r1', notes: ['n1'] }],
      propose: [1, 2, 3].map((i) => ({
        rule: `Rule ${i}.`,
        context: 'here',
        topics: ['copy' as const],
        notes: ['n1'],
        basis: 'stated' as const,
      })),
    };
    const preview = previewReading(r, PREVIEW_RULES - 1);
    assert.deepEqual(
      preview.propose.map((p) => [p.rule, 'locked' in p]),
      [
        ['Rule 1.', false],
        ['', true],
        ['', true],
      ],
    );
    assert.equal(JSON.stringify(preview).includes('Rule 2'), false, 'hidden words never go out');
    assert.equal(
      previewReading(r, 0).propose.every((p) => 'locked' in p),
      true,
    );
  });

  it('shows a visitor the surest rules first, and nothing of a hidden one’s question', () => {
    const asks: CleanReading['propose'][number] = {
      rule: 'Keep headings short.',
      context: '',
      topics: ['copy'],
      notes: ['n1', 'n2', 'n3'],
      basis: 'interpreted',
      reading: 'Its secret reading.',
      question: { ask: 'Secret question?', options: [{ answer: 'Secret', rule: 'Secret rule.' }] },
    };
    const one = { rule: 'From one note.', context: '', topics: [], notes: ['n1'], basis: 'stated' as const };
    const two = { ...one, rule: 'From two notes.', notes: ['n1', 'n2'] };
    const read = { ...one, rule: 'Read from three notes.', notes: ['n1', 'n2', 'n3'], basis: 'interpreted' as const };
    const preview = previewReading({ strengthen: [], propose: [asks, one, two, read] }, 2);
    assert.deepEqual(
      preview.propose.map((p) => p.rule),
      ['', 'From one note.', 'From two notes.', ''],
      'the notes’ own words first, then readings, then questions; more notes first',
    );
    assert.deepEqual(
      previewReading({ strengthen: [], propose: [asks, read] }, 1).propose.map((p) => p.rule),
      ['', 'Read from three notes.'],
    );
    assert.equal(JSON.stringify(preview).includes('Secret'), false);
  });
});

describe('the expert foundation', () => {
  it('reads with the foundation, and never gives a rule a figure of its own', () => {
    assert.match(learnSystem, /The design foundation/);
    assert.match(learnSystem, /only the designer's notes establish what they prefer/);
    assert.match(learnSystem, /“quiet”, “calm”, “breathes”: focus, colour, grouping/);
    assert.match(learnSystem, /density, Density follows the job: .* Gives way: none in itself/);
    assert.match(learnSystem, /When to ask/);
    assert.ok(SHORTHAND.length > 5 && PRINCIPLES.length > 10);
    assert.doesNotMatch(foundationText, /\d/, 'no sizes, ratios or counts to borrow');
    assert.doesNotMatch(foundationText, /[→←↔⇄]/);
  });

  it('says for every principle where it applies, where it gives way and what justifies it', () => {
    const ids = new Set(PRINCIPLES.map((p) => p.id));
    assert.equal(ids.size, PRINCIPLES.length, 'ids are unique');
    for (const p of PRINCIPLES) {
      for (const field of ['name', 'holds', 'when', 'except', 'evidence'] as const)
        assert.ok(p[field].trim(), `${p.id} has ${field}`);
      assert.ok(p.sources.length, `${p.id} names its sources`);
      for (const s of p.sources) assert.ok(FOUNDATION_SOURCES[s].licence, `${s} has a licence`);
    }
    for (const s of SHORTHAND) for (const id of s.principles) assert.ok(ids.has(id), id);
    const areas = PRINCIPLES.map((p) => p.area);
    assert.equal(new Set(areas).size, areas.length, 'each principle browses under its own name');
    for (const a of ['Typography', 'Hierarchy', 'Spacing', 'Tone and words'])
      assert.ok(areas.includes(a), a);
  });

  it('tells the reader which library rules are its readings and which wait on a question', () => {
    const prompt = learnPrompt(
      learnRequestSchema.parse({
        notes: [{ id: 'n1', works: 'Quiet.' }],
        rules: [
          {
            id: 'r1',
            text: 'Keep headings short.',
            context: '',
            topics: [],
            status: 'approved',
            basis: 'interpreted',
            question: 'What do you like about this heading?',
          },
        ],
      }),
    );
    assert.match(prompt, /"basis": "interpreted"/);
    assert.match(prompt, /"openQuestion": "What do you like about this heading\?"/);
  });
});
