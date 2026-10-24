import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type BatchNote, type Collection, newCollection, type Rule } from '../learnings';
import {
  filterReferences,
  markedOf,
  referenceReach,
  referencesOf,
  withoutReference,
  withReferenceTag,
  zipWithout,
} from '../library';

const note = (ref: string, more: Partial<BatchNote> = {}): BatchNote => ({
  ref,
  image: `${ref.split('.')[0]}.png`,
  source: 'ours',
  topics: ['visual'],
  works: 'x',
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  ...more,
});

const rule = (id: string, notes: [string, string][], more: Partial<Rule> = {}): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: notes.map(([batchId, n]) => ({ batchId, note: n })),
  status: 'approved',
  createdAt: '2026-10-24T10:00:00Z',
  ...more,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-24T10:00:00Z'),
    batches: [
      {
        id: 'old',
        name: 'old',
        addedAt: '2026-10-20T10:00:00Z',
        exportedAt: 'x',
        root: 'old/',
        images: 1,
        notes: [note('01.1', { screenTag: 'Inbox', source: 'competitor' })],
      },
      {
        id: 'new',
        name: 'new',
        addedAt: '2026-10-24T10:00:00Z',
        exportedAt: 'x',
        root: 'new/',
        images: 2,
        notes: [
          note('01.1', { screenTag: 'Agent Hub', best: true }),
          note('01.2'),
          note('02.1'),
        ],
      },
    ],
    rules: [
      rule('hub', [['new', '01.1'], ['new', '01.2']]),
      rule('mixed', [['new', '01.1'], ['old', '01.1']], { conflict: { ruleId: 'hub', why: 'x' } }),
      rule('inbox', [['old', '01.1']]),
    ],
    read: ['new/01.1', 'new/01.2'],
  };
}

describe('the library of references (D124)', () => {
  it('is one image per batch, newest batch first, with its notes, tag, source and rules', () => {
    const refs = referencesOf(library());
    assert.deepEqual(
      refs.map((r) => r.key),
      ['new/01', 'new/02', 'old/01'],
    );
    const hub = refs[0];
    assert.equal(hub.tag, 'Agent Hub');
    assert.equal(hub.notes.length, 2);
    assert.equal(hub.rules, 2);
    assert.equal(hub.unread, 0);
    assert.equal(hub.best, true);
    assert.equal(refs[1].unread, 1);
    assert.equal(refs[2].source, 'competitor');
  });

  it('filters by product, by no product, and by source', () => {
    const refs = referencesOf(library());
    assert.deepEqual(
      filterReferences(refs, { tag: 'agent  hub' }).map((r) => r.key),
      ['new/01'],
    );
    assert.deepEqual(
      filterReferences(refs, { tag: '' }).map((r) => r.key),
      ['new/02'],
    );
    assert.deepEqual(
      filterReferences(refs, { source: 'competitor' }).map((r) => r.key),
      ['old/01'],
    );
  });

  it('retags every note of a reference, or takes the tag off', () => {
    const tagged = withReferenceTag(library(), 'new', '01', '  Co-pilot ', 'n');
    assert.deepEqual(
      tagged.batches[1].notes.map((n) => n.screenTag),
      ['Co-pilot', 'Co-pilot', undefined],
    );
    const off = withReferenceTag(tagged, 'new', '01', '', 'n');
    assert.equal(
      off.batches[1].notes.some((n) => 'screenTag' in n && n.ref.startsWith('01')),
      false,
    );
  });

  it('removes a reference with its notes and the rules from them alone', () => {
    const c = library();
    assert.deepEqual(referenceReach(c, 'new', '01'), { notes: 2, rules: 1, fewer: 1, last: false });
    const after = withoutReference(c, 'new', '01', 'n');
    assert.deepEqual(
      after.batches[1].notes.map((n) => n.ref),
      ['02.1'],
    );
    assert.equal(after.batches[1].images, 1);
    assert.deepEqual(after.read, []);
    assert.deepEqual(
      after.rules.map((r) => r.id),
      ['mixed', 'inbox'],
    );
    const mixed = after.rules[0];
    assert.deepEqual(mixed.evidence, [{ batchId: 'old', note: '01.1' }]);
    assert.equal(mixed.conflict, undefined, 'its pull on a rule now gone goes too');
  });

  it('takes the batch with its last reference', () => {
    const c = library();
    assert.equal(referenceReach(c, 'old', '01').last, true);
    const after = withoutReference(c, 'old', '01', 'n');
    assert.deepEqual(
      after.batches.map((b) => b.id),
      ['new'],
    );
    assert.equal(
      after.rules.some((r) => r.id === 'inbox'),
      false,
    );
  });
});

describe('a reference’s files in its batch zip (D124)', () => {
  const manifest = {
    tool: 'Pinch',
    assets: [
      { number: '01', marked: 'marked/01-hub.jpg', image: 'images/01-hub.png', width: 1600, height: 1000 },
      { number: '02', marked: 'marked/02-inbox.jpg', image: 'images/02-inbox.png' },
    ],
  };
  const bytes = (s: string) => new TextEncoder().encode(s);
  const files = new Map([
    ['new/notes.json', bytes(JSON.stringify(manifest))],
    ['new/README.md', bytes('readme')],
    ['new/contact-sheet.jpg', bytes('sheet')],
    ['new/images/01-hub.png', bytes('a')],
    ['new/marked/01-hub.jpg', bytes('b')],
    ['new/crops/01-hub-note-1.jpg', bytes('c')],
    ['new/crops/01-hub-note-2.jpg', bytes('d')],
    ['new/images/02-inbox.png', bytes('e')],
    ['new/marked/02-inbox.jpg', bytes('f')],
    ['new/crops/02-inbox-note-1.jpg', bytes('g')],
  ]);

  it('finds its marked copy and size', () => {
    assert.deepEqual(markedOf(manifest, 'new/', '01'), {
      path: 'new/marked/01-hub.jpg',
      width: 1600,
      height: 1000,
    });
    assert.deepEqual(markedOf(manifest, 'new/', '02'), { path: 'new/marked/02-inbox.jpg', width: undefined, height: undefined });
    assert.equal(markedOf(manifest, 'new/', '09'), null);
  });

  it('leaves the rest of the zip, without its files, its entry or the contact sheet', () => {
    const out = zipWithout(files, 'new/', '01');
    assert.deepEqual(
      out.map((e) => e.name),
      [
        'new/notes.json',
        'new/README.md',
        'new/images/02-inbox.png',
        'new/marked/02-inbox.jpg',
        'new/crops/02-inbox-note-1.jpg',
      ],
    );
    const kept = JSON.parse(new TextDecoder().decode(out[0].data));
    assert.deepEqual(
      kept.assets.map((a: { number: string }) => a.number),
      ['02'],
    );
  });
});
