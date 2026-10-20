import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync, crc32 as nodeCrc } from 'node:zlib';

import { assetsOf, batchNotes, readExport } from '../import';
import { cleanLearnings, learnPrompt, learnRequestSchema, learnSystem } from '../learn';
import {
  type Batch,
  batchFileName,
  byTopic,
  type Collection,
  collectionManifest,
  collectionSlug,
  newCollection,
  originOf,
  readCollection,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesText,
  unwritten,
  withBatch,
  withLearning,
  withoutBatch,
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
  return withBatch(newCollection('Acme', 'c1', '2026-10-20T11:00:00Z'), batch, 'now', newId);
}

describe('collections and learnings', () => {
  it('adds an empty learning per note, scoped by whose design it is', () => {
    const c = collection();
    assert.equal(c.learnings.length, 3);
    assert.deepEqual(
      c.learnings.map((l) => [l.note, l.scope, l.text]),
      [
        ['01.1', 'personal', ''],
        ['01.2', 'personal', ''],
        ['02.1', 'project', ''],
      ],
    );
    assert.equal(unwritten(c).length, 3);
    // A note the AI found no rule in isn't asked about again.
    const drafted = withLearning(c, c.learnings[0].id, { drafted: '' }, 'x');
    assert.equal(unwritten(drafted).length, 2);
    assert.equal(withoutBatch(c, 'b1', 'later').learnings.length, 0);
  });

  it('groups by first topic, untagged last, and says whose words a learning is', () => {
    const c = collection();
    assert.deepEqual(
      byTopic(c.learnings).map((g) => [g.label, g.learnings.map((l) => l.note)]),
      [
        ['Visual', ['02.1']],
        ['Copy', ['01.1']],
        ['Not tagged', ['01.2']],
      ],
    );
    const [l] = c.learnings;
    assert.equal(originOf(l), 'author');
    assert.equal(originOf({ ...l, text: 'Rule.', drafted: 'Rule.' }), 'ai');
    assert.equal(originOf({ ...l, text: 'Better rule.', drafted: 'Rule.' }), 'ai-edited');
  });

  /** Two written rules and one left empty. */
  function written(): Collection {
    let c = collection();
    const [a, , d] = c.learnings;
    c = withLearning(c, a.id, { text: 'Lead with a short headline.' }, 'x');
    c = withLearning(c, d.id, { text: 'Align related controls.', drafted: 'Align controls.' }, 'x');
    return c;
  }

  it('exports every written rule, personal taste first, numbered', () => {
    const c = written();
    const rules = rulesOf(c);
    assert.deepEqual(
      rules.map((r) => [r.id, r.learning.note, r.evidence]),
      [
        ['R1', '01.1', 'evidence/r01.jpg'],
        ['R2', '02.1', 'evidence/r02.jpg'],
      ],
    );
    const md = rulesMarkdown(c, rules, '2026-10-20T12:00:00Z');
    assert.match(md, /^# Design rules: Acme$/m);
    assert.match(md, /2 rules\./);
    assert.match(md, /design rules the author keeps/);
    assert.ok(md.indexOf('## Personal taste') < md.indexOf('## This project'));
    assert.match(md, /^\*\*R1\.\*\* Lead with a short headline\.$/m);
    assert.match(md, /from note 01\.1 on Pricing\.png \(Competitor\), pinch-2026-10-20\./);
    assert.match(md, /^What works: Short headline\.$/m);
    assert.match(md, /Also about: Layout\./);
    const data = rulesManifest(c, rules, 'x');
    assert.equal(data.rules[1].origin, 'ai-edited');
    assert.equal(data.rules[0].note.source, 'competitor');
    assert.equal(collectionSlug('Acme Dashboard, v2'), 'acme-dashboard-v2');
  });

  it('picks the rules a task needs, by scope and topic', () => {
    const c = written();
    const notes = (pick: Parameters<typeof rulesOf>[1]) =>
      rulesOf(c, pick).map((r) => r.learning.note);
    assert.deepEqual(notes({ scopes: ['project'] }), ['02.1']);
    assert.deepEqual(notes({ topics: ['copy'] }), ['01.1']);
    assert.deepEqual(notes({ topics: ['layout'] }), ['02.1'], 'any of its topics counts');
    assert.deepEqual(notes({ topics: [null] }), [], 'the untagged rule is empty, so not a rule');
    assert.deepEqual(notes({ scopes: [], topics: ['copy'] }), []);
    // Numbering follows the pick, so a task's file reads R1, R2, …
    assert.equal(rulesOf(c, { scopes: ['project'] })[0].id, 'R1');
    const text = rulesText(c, rulesOf(c));
    assert.match(text, /^Design rules from Acme \(Pinch\), 2 rules\./);
    assert.match(text, /^R2\. Align related controls\. \(This project; Visual, Layout\)$/m);
    assert.match(
      text,
      /From a note on Home\.jpg \(Ours\): works: "Aligned\."; doesn't: "Too far\."/,
    );
    assert.doesNotMatch(text, /evidence/);
  });

  it('moves a collection to another browser with fresh ids', () => {
    const c = written();
    const json = JSON.parse(JSON.stringify(collectionManifest(c)));
    assert.equal(json.learnings[0].id, undefined);
    counter = 100;
    const { collection: back, batchIds } = readCollection(json, newId, 'now');
    assert.notEqual(back.id, c.id);
    assert.equal(back.name, 'Acme');
    assert.equal(batchIds.get('b1'), back.batches[0].id);
    assert.deepEqual(
      back.learnings.map((l) => [l.batchId === back.batches[0].id, l.note, l.text]),
      c.learnings.map((l) => [true, l.note, l.text]),
    );
    assert.equal(rulesOf(back).length, 2);
    assert.throws(
      () => readCollection({ tool: 'Pinch' }, newId, 'now'),
      /isn’t a Pinch collection/,
    );
    assert.equal(batchFileName('b1'), 'batches/b1.zip');
  });
});

describe('drafting learnings', () => {
  it('takes only note words, and sends them as data', () => {
    const ok = learnRequestSchema.safeParse({
      notes: [{ id: 'l1', works: 'Short headline.', topics: ['copy'], source: 'competitor' }],
    });
    assert.ok(ok.success);
    assert.equal(learnRequestSchema.safeParse({ notes: [] }).success, false);
    assert.equal(
      learnRequestSchema.safeParse({ notes: [{ id: 'l1', topics: ['nope'] }] }).success,
      false,
    );
    const prompt = learnPrompt(ok.success ? ok.data.notes : []);
    assert.match(prompt, /"whatWorks": "Short headline\."/);
    assert.match(prompt, /"whoseDesign": "Competitor"/);
    assert.match(prompt, /"about": \[\s*"copy"\s*\]/);
    assert.doesNotMatch(prompt, /whatDoesnt/);
    assert.match(learnSystem, /flow \(steps, navigation/);
  });

  it('keeps one tidy rule per note it was sent', () => {
    assert.deepEqual(
      cleanLearnings(
        {
          rules: [
            { id: 'l1', rule: '  Lead with\n a short headline. ' },
            { id: 'l1', rule: 'A second one.' },
            { id: 'zz', rule: 'Not asked for.' },
            { id: 'l2', rule: '' },
          ],
        },
        ['l1', 'l2'],
      ),
      { l1: 'Lead with a short headline.', l2: '' },
    );
  });
});
