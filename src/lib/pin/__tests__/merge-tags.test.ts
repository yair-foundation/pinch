import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type BatchNote, type Collection, newCollection, type Rule, rulesOf } from '../learnings';
import { readinessOf } from '../readiness';
import {
  briefOf,
  roleOf,
  screenSets,
  withBrief,
  withMergedTag,
  withScreenRole,
} from '../screen-index';

const note = (ref: string, screenTag?: string): BatchNote => ({
  ref,
  image: `screen-${ref}.png`,
  source: 'ours',
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
  createdAt: `2026-10-25T10:00:0${id.charCodeAt(0) - 97}Z`,
});

/** The same product under two names, and one other. */
function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-25T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-25',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-25/',
        images: 4,
        notes: [
          note('01.1', 'Multi-Calendar'),
          note('02.1', 'multi calendar '),
          note('03.1', 'Marketing Asset - Multi-Calendar'),
          note('04.1', 'Inbox'),
          note('05.1'),
        ],
      },
    ],
    rules: [rule('a', ['01.1']), rule('b', ['02.1', '03.1']), rule('c', ['04.1'])],
  };
}

describe('merging one screen tag into another (D129)', () => {
  it('gives every spelling of one the other’s name', () => {
    const merged = withMergedTag(
      library(),
      'Multi-Calendar',
      'Marketing Asset - Multi-Calendar',
      'n',
    );
    assert.deepEqual(
      merged.batches[0].notes.map((n) => n.screenTag ?? ''),
      [
        'Marketing Asset - Multi-Calendar',
        'Marketing Asset - Multi-Calendar',
        'Marketing Asset - Multi-Calendar',
        'Inbox',
        '',
      ],
    );
    assert.deepEqual(
      screenSets(merged).map((s) => [s.name, s.notes]),
      [
        ['Marketing Asset - Multi-Calendar', 3],
        ['Inbox', 1],
      ],
    );
    assert.deepEqual(
      readinessOf(
        merged,
        rulesOf(merged).map((r) => r.rule),
      ).map((r) => [r.tag, r.rules]),
      [
        ['Marketing Asset - Multi-Calendar', 2],
        ['Inbox', 1],
      ],
    );
    assert.equal(merged.updatedAt, 'n');
  });

  it('moves the brief, role and free product where the other has none, and keeps its own', () => {
    const c = withScreenRole(
      withBrief(library(), 'Multi-Calendar', 'Stays at a glance.', 'n'),
      'Multi-Calendar',
      'today',
      'n',
    );
    const moved = withMergedTag(
      { ...c, freeProduct: 'multicalendar' },
      'Multi-Calendar',
      'Inbox',
      'n',
    );
    assert.equal(briefOf(moved, 'Inbox'), 'Stays at a glance.');
    assert.equal(roleOf(moved, 'Inbox'), 'today');
    assert.equal(briefOf(moved, 'Multi-Calendar'), '');
    assert.equal(moved.freeProduct, 'inbox');
    const own = withMergedTag(
      withBrief(c, 'Inbox', 'Messages in one place.', 'n'),
      'Multi-Calendar',
      'Inbox',
      'n',
    );
    assert.equal(briefOf(own, 'Inbox'), 'Messages in one place.');
    assert.equal(Object.keys(own.briefs ?? {}).length, 1, 'the merged one’s brief goes');
  });

  it('changes nothing for the same set, an empty name or a tag no note has', () => {
    const c = library();
    assert.equal(withMergedTag(c, 'Multi-Calendar', 'multi calendar', 'n'), c);
    assert.equal(withMergedTag(c, 'Multi-Calendar', ' ', 'n'), c);
    assert.equal(withMergedTag(c, 'Pricing', 'Inbox', 'n'), c);
  });
});
