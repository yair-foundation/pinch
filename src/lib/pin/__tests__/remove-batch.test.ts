import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type Batch,
  type BatchNote,
  batchLabel,
  batchReach,
  type Collection,
  newCollection,
  type Rule,
  rulesOf,
  unreadNotes,
  withoutBatch,
} from '../learnings';

const note = (ref: string, works: string): BatchNote => ({
  ref,
  image: `${ref}.png`,
  source: 'ours',
  topics: ['visual'],
  works,
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
});

const batch = (id: string, name: string, refs: string[]): Batch => ({
  id,
  name,
  addedAt: '2026-10-20T10:00:00Z',
  exportedAt: '2026-10-20T10:00:00Z',
  root: `${name}/`,
  images: refs.length,
  notes: refs.map((r) => note(r, `Note ${r}.`)),
});

const rule = (id: string, evidence: [string, string][], more: Partial<Rule> = {}): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: evidence.map(([batchId, n]) => ({ batchId, note: n })),
  status: 'approved',
  createdAt: '2026-10-21T10:00:00Z',
  ...more,
});

/** A test batch, a real one, and rules drawing on one, the other or both. */
function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-20T10:00:00Z'),
    batches: [
      batch('junk', 'pinch-2026-10-20', ['01.1', '01.2']),
      batch('real', 'pinch-2026-10-20', ['01.1', '02.1']),
    ],
    rules: [
      rule('only-junk', [['junk', '01.1']]),
      rule('both', [
        ['junk', '01.2'],
        ['real', '01.1'],
      ]),
      rule('only-real', [['real', '02.1']], {
        conflict: { ruleId: 'only-junk', why: 'They pull apart.' },
      }),
      rule('set-against-real', [['real', '01.1']], {
        conflict: { ruleId: 'only-real', why: 'Both hold.', settled: true },
      }),
      rule('taste', [['junk', '01.1']], { taste: 'q1:a' }),
      rule('dismissed', [['junk', '01.2']], { status: 'dismissed' }),
    ],
    read: ['junk/01.1', 'junk/01.2', 'real/01.1'],
  };
}

describe('removing a batch of notes (D115)', () => {
  it('names each batch as its folder in the package does, so two of one name differ', () => {
    const c = library();
    assert.deepEqual(
      c.batches.map((b, i) => batchLabel(i, b)),
      ['01-pinch-2026-10-20', '02-pinch-2026-10-20'],
    );
  });

  it('says what it takes with it', () => {
    // "both" and the taste pick lose a note; the dismissed rule isn't counted.
    assert.deepEqual(batchReach(library(), 'junk'), { notes: 2, images: 2, rules: 1, fewer: 2 });
    assert.deepEqual(batchReach(library(), 'real'), { notes: 2, images: 2, rules: 2, fewer: 1 });
  });

  it('takes its notes out of every rule, and the rules that came from them alone', () => {
    const c = withoutBatch(library(), 'junk', 'now');
    assert.equal(c.updatedAt, 'now');
    assert.deepEqual(
      c.batches.map((b) => b.id),
      ['real'],
    );
    assert.deepEqual(
      c.rules.map((r) => r.id),
      ['both', 'only-real', 'set-against-real', 'taste'],
      'deleted, not dismissed: the notes were removed, not the rule',
    );
    const by = new Map(c.rules.map((r) => [r.id, r]));
    assert.deepEqual(by.get('both')?.evidence, [{ batchId: 'real', note: '01.1' }]);
    assert.ok(!by.get('only-real')?.conflict, 'the rule it pulled against is gone');
    assert.deepEqual(by.get('set-against-real')?.conflict, {
      ruleId: 'only-real',
      why: 'Both hold.',
      settled: true,
    });
    assert.deepEqual(by.get('taste')?.evidence, [], 'a taste pick stays, with no notes again');
    assert.deepEqual(c.read, ['real/01.1']);
    assert.ok(!c.batches.some((b) => b.id === 'junk'));
    assert.equal(unreadNotes(c).length, 1);
    assert.deepEqual(
      rulesOf(c).map((r) => r.rule.id),
      ['both', 'only-real', 'set-against-real', 'taste'],
    );
  });

  it('leaves the rest as it was', () => {
    const before = library();
    const c = withoutBatch(before, 'junk', 'now');
    const kept = c.rules.find((r) => r.id === 'set-against-real');
    assert.equal(
      kept,
      before.rules.find((r) => r.id === 'set-against-real'),
    );
    assert.equal(withoutBatch(before, 'nothing', 'now'), before);
  });
});
