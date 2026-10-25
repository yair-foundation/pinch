import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, versionLine } from '../agent';
import {
  changesLines,
  changesSince,
  MAX_EXPORTS,
  mergeExports,
  versionOf,
  withExported,
} from '../changes';
import {
  type Collection,
  mergeCollection,
  newCollection,
  type Rule,
  rulesVersion,
} from '../learnings';
import { withBrief } from '../screen-index';

const rule = (id: string, text: string, extra: Partial<Rule> = {}): Rule => ({
  id,
  text,
  context: '',
  topics: ['layout'],
  tags: [],
  evidence: [],
  status: 'approved',
  createdAt: `2026-10-25T10:00:0${id.charCodeAt(0) - 97}Z`,
  ...extra,
});

/** Three rules, exported once. */
function exported(): Collection {
  const c: Collection = {
    ...newCollection('My rules', 'c1', '2026-10-25T10:00:00Z'),
    rules: [
      rule('a', 'Keep cards quiet.'),
      rule('b', 'Leave space between rows.'),
      rule('c', 'Avoid underlines.'),
    ],
  };
  return withExported(c, '2026-10-25T12:00:00Z');
}

const topics = (c: Collection, version: string) =>
  answer(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_rule_topics', arguments: { version } },
    },
    async () => c,
  ) as Promise<{ result: { content: { text: string }[] } }>;

describe('what changed since a copy of the rules (D128)', () => {
  it('keeps each export’s version once, the newest few', () => {
    const c = exported();
    assert.equal(c.exports?.length, 1);
    assert.equal(c.exports?.[0].version, rulesVersion(c));
    assert.deepEqual(
      c.exports?.[0].rules.map(([key]) => key),
      ['a', 'b', 'c'],
    );
    const again = withExported(c, '2026-10-26T09:00:00Z');
    assert.equal(again.exports?.length, 1);
    assert.equal(again.exports?.[0].at, '2026-10-26T09:00:00Z');
    let many = c;
    for (let i = 0; i < MAX_EXPORTS + 3; i++)
      many = withExported(
        { ...many, rules: [...many.rules, rule(`x${i}`, `Rule ${i}.`)] },
        `2026-10-27T10:${String(i).padStart(2, '0')}:00Z`,
      );
    assert.equal(many.exports?.length, MAX_EXPORTS);
  });

  it('says which rules are new, changed or gone, with the numbers they had', () => {
    const c = exported();
    const v = rulesVersion(c);
    const later: Collection = {
      ...c,
      rules: [
        rule('a', 'Keep cards quiet.', { status: 'dismissed' }),
        rule('b', 'Leave generous space between rows.', { context: 'in lists' }),
        rule('c', 'Avoid underlines.'),
        rule('d', 'Write dates with the month in words.'),
      ],
    };
    const ch = changesSince(later, v);
    assert.ok(ch);
    assert.deepEqual(
      ch.added.map((r) => r.id),
      ['R3'],
    );
    assert.deepEqual(
      ch.reworded.map((x) => [x.rule.id, x.was]),
      [['R1', 'R2']],
    );
    assert.deepEqual(ch.gone, [{ was: 'R1', text: 'Keep cards quiet.' }]);
    assert.equal(ch.renumbered, true, 'R3 became R2');
    assert.equal(ch.briefs, false);
    assert.deepEqual(changesLines(ch), [
      '- New R3: Write dates with the month in words.',
      '- Changed R1 (was R2): Leave generous space between rows. (where: in lists)',
      '- Gone, was R1: Keep cards quiet.',
      'Rule numbers have moved since your copy: refer to rules by the numbers get_design_rules gives now.',
    ]);
    assert.equal(changesSince(later, 'unknown'), null);
    // A brief counts for a product with notes, so the copy and the change both have one.
    const tagged: Collection = {
      ...c,
      batches: [
        {
          id: 'b1',
          name: 'pinch-2026-10-25',
          addedAt: 'x',
          exportedAt: 'x',
          root: 'pinch-2026-10-25/',
          images: 1,
          notes: [
            {
              ref: '01.1',
              image: 'inbox.png',
              source: 'ours',
              topics: ['layout'],
              works: 'Calm.',
              doesNotWork: '',
              crop: 'crops/01.1.jpg',
              screenTag: 'Inbox',
            },
          ],
        },
      ],
    };
    const copy = withExported(tagged, 'x');
    const briefed = withBrief(copy, 'Inbox', 'Messages in one place.', 'n');
    assert.notEqual(rulesVersion(briefed), rulesVersion(copy));
    assert.deepEqual(
      changesLines(changesSince(briefed, rulesVersion(copy)) as NonNullable<typeof ch>),
      ['- The briefs changed: get_design_rules gives them first.'],
    );
  });

  it('is in list_rule_topics for a copy behind, and falls back for one Pinch has no record of', async () => {
    const c = exported();
    const v = rulesVersion(c);
    const later = { ...c, rules: [...c.rules, rule('d', 'Write dates with the month in words.')] };
    const text = (await topics(later, v)).result.content[0].text;
    assert.match(text, new RegExp(`your copy \\(${v}, exported 2026-10-25\\) is behind`));
    assert.match(text, /- New R4: Write dates with the month in words\./);
    assert.doesNotMatch(text, /numbers have moved/);
    assert.match(
      (await topics(later, 'zzz')).result.content[0].text,
      /your copy \(zzz\) is behind/,
    );
    assert.match(versionLine(v, v), /your copy is current/);
  });

  it('survives merging two collections, a version once', () => {
    const a = exported();
    const b = withExported(
      { ...a, rules: [...a.rules, rule('d', 'New.')], exports: [] },
      '2026-10-26T10:00:00Z',
    );
    const merged = mergeCollection(a, b, 'n');
    assert.equal(merged.exports?.length, 2);
    assert.equal(mergeExports(a.exports, a.exports).length, 1);
    assert.equal(versionOf(a, 'x').version, rulesVersion(a));
  });
});
