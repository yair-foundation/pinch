import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, pickOf, topicsText } from '../agent';
import { batchNotes, readExport } from '../import';
import {
  type BatchNote,
  type Collection,
  newCollection,
  noteAbout,
  noteFingerprint,
  picked,
  type Rule,
  rulesOf,
  rulesText,
  screenOf,
  screenTagsIn,
  withScreenTags,
} from '../learnings';
import { type Asset, cleanScreenTag, manifest, readme } from '../model';

const note = (ref: string, screenTag?: string): BatchNote => ({
  ref,
  image: `screen-${ref}.png`,
  source: 'competitor',
  topics: ['layout'],
  works: `Works ${ref}.`,
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  ...(screenTag ? { screenTag } : {}),
});

const rule = (id: string, notes: string[]): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['layout'],
  tags: [],
  evidence: notes.map((n) => ({ batchId: 'b1', note: n })),
  status: 'approved',
  createdAt: `2026-10-21T10:00:0${id.charCodeAt(0) - 97}Z`,
});

/** Three screenshots: Linear, Stripe (once as "stripe "), and one with no tag. */
function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-21T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-21',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-21/',
        images: 4,
        notes: [
          note('01.1', 'Linear'),
          note('02.1', 'Stripe'),
          note('03.1', 'stripe '),
          note('04.1'),
        ],
      },
    ],
    rules: [rule('a', ['01.1']), rule('b', ['01.1', '02.1', '03.1']), rule('c', ['04.1'])],
  };
}

describe('a screenshot’s tag (D100)', () => {
  it('is tidied: one line, 40 characters at most', () => {
    assert.equal(cleanScreenTag('  Linear  app '), 'Linear app');
    assert.equal(cleanScreenTag('x'.repeat(50)), 'x'.repeat(40));
    assert.equal(cleanScreenTag(undefined), '');
  });

  it('goes out with the export and comes back on every note of the screenshot', () => {
    const asset: Asset = {
      id: 'a1',
      name: 'Linear onboarding.png',
      type: 'image/png',
      width: 1000,
      height: 800,
      note: '',
      screenTag: ' Linear ',
      marks: [
        {
          id: 'm1',
          shape: { kind: 'dot', x: 0.5, y: 0.5 },
          label: '',
          good: 'Calm.',
          bad: '',
          origin: 'user',
        },
        {
          id: 'm2',
          shape: { kind: 'dot', x: 0.2, y: 0.2 },
          label: '',
          good: '',
          bad: 'Busy.',
          origin: 'user',
        },
      ],
    };
    const data = manifest([asset], '2026-10-21T10:00:00Z');
    assert.equal(data.assets[0].tag, 'Linear');
    const guide = readme([asset], '2026-10-21T10:00:00Z');
    assert.match(guide, /\nTag: Linear\n/);
    assert.match(guide, /Tag is the author's own tag for an image/, 'the README says what it is');
    const exp = readExport(
      new Map([['pinch-2026-10-21/notes.json', new TextEncoder().encode(JSON.stringify(data))]]),
    );
    const notes = batchNotes(exp);
    assert.equal(notes.length, 2);
    for (const n of notes) assert.equal(n.screenTag, 'Linear');

    const plain = manifest([{ ...asset, screenTag: ' ' }], '2026-10-21T10:00:00Z');
    assert.equal('tag' in plain.assets[0], false, 'no empty tag');
  });

  it('a rule carries its notes’ screenshots’ tags, each once, whatever the case', () => {
    const c = library();
    assert.deepEqual(screenOf(c, c.rules[1]), ['Linear', 'Stripe']);
    assert.deepEqual(screenOf(c, c.rules[2]), []);
    assert.deepEqual(screenTagsIn(c, c.rules), [
      { value: 'Linear', n: 2 },
      { value: 'Stripe', n: 1 },
    ]);
  });

  it('narrows the rules to any of the tags asked for', () => {
    const c = library();
    const ids = (pick: Parameters<typeof picked>[1]) =>
      c.rules.filter((r) => picked(r, pick, c)).map((r) => r.id);
    assert.deepEqual(ids({}), ['a', 'b', 'c']);
    assert.deepEqual(ids({ screen: ['linear'] }), ['a', 'b']);
    assert.deepEqual(ids({ screen: [' STRIPE'] }), ['b']);
    assert.deepEqual(ids({ screen: ['Stripe', 'Linear'] }), ['a', 'b']);
    assert.deepEqual(ids({ screen: ['Figma'] }), []);
    assert.deepEqual(ids({ screen: [] }), ['a', 'b', 'c'], 'an empty list asks nothing');
    assert.equal(picked(c.rules[0], { screen: ['Linear'] }), false, 'needs the collection');
    assert.deepEqual(
      rulesOf(c, { screen: ['Stripe'] }).map((r) => r.rule.id),
      ['b'],
    );
  });

  it('is named where a note names its source', () => {
    const c = library();
    const text = rulesText(c, rulesOf(c));
    assert.match(text, /note 01\.1 on screen-01\.1\.png \(Competitor; tag Linear\):/);
    assert.match(text, /note 04\.1 on screen-04\.1\.png \(Competitor\):/);
    assert.equal(noteAbout({ source: null, screenTag: 'Linear' }), ' (tag Linear)');
    assert.equal(noteAbout({ source: null }), '');
  });

  it('typed after a note was kept, still reaches it; nothing changes when it matches', () => {
    const c = library();
    const print = (n: BatchNote) => noteFingerprint(n.image, n.works, n.doesNotWork);
    const [linear, stripe, , plain] = c.batches[0].notes;
    assert.equal(withScreenTags(c, new Map([[print(linear), 'Linear']]), 'now'), c);
    const next = withScreenTags(
      c,
      new Map([
        [print(plain), ' Figma '],
        [print(stripe), undefined],
        ['someone else’s note', 'Notion'],
      ]),
      'now',
    );
    assert.notEqual(next, c);
    assert.equal(next.updatedAt, 'now');
    const [a, b, , d] = next.batches[0].notes;
    assert.deepEqual(a, linear, 'a note not open stays');
    assert.equal('screenTag' in b, false, 'cleared');
    assert.equal(d.screenTag, 'Figma');
  });
});

describe('screen tags over MCP (D100)', () => {
  const call = (name: string, args: unknown = {}) =>
    answer(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      async () => library(),
    ) as Promise<{ result: { content: { text: string }[] } }>;

  it('reads a call’s screen tags, one or several', () => {
    assert.deepEqual(pickOf({ screenTags: ['Linear', ' ', 3] }), { screen: ['Linear'] });
    assert.deepEqual(pickOf({ screenTags: 'Stripe' }), { screen: ['Stripe'] });
    assert.deepEqual(pickOf({ screenTags: 5 }), {});
  });

  it('keeps get_design_rules to a tag when asked, and lists the tags there are', async () => {
    const some = (await call('get_design_rules', { screenTags: ['stripe'] })).result.content[0]
      .text;
    assert.match(some, /^R2\. Rule b\./m, 'numbered as among all rules');
    assert.doesNotMatch(some, /Rule a\.|Rule c\./);
    const all = (await call('get_design_rules')).result.content[0].text;
    assert.match(all, /Rule a\.[\s\S]*Rule b\.[\s\S]*Rule c\./);
    assert.match(topicsText(library()), /\(screenTags\):\n- Linear: 2\n- Stripe: 1$/);
  });

  it('names each note’s tag in get_rule_evidence too', async () => {
    const r = (await answer(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_rule_evidence', arguments: { rule: 'R2' } },
      },
      async () => library(),
      async () => new Map(),
    )) as { result: { content: { type: string; text?: string }[] } };
    const lines = r.result.content.flatMap((c) => (c.text ? [c.text.split('\n')[0]] : []));
    assert.ok(
      lines.includes('Note 01.1 on screen-01.1.png (Competitor; tag Linear): works: "Works 01.1."'),
    );
    assert.ok(
      lines.includes('Note 02.1 on screen-02.1.png (Competitor; tag Stripe): works: "Works 02.1."'),
    );
  });
});
