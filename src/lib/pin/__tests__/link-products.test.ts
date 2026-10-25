import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, topicsText } from '../agent';
import { type BatchNote, type Collection, newCollection, type Rule, rulesOf } from '../learnings';
import { inFreePlan } from '../plan';
import { gapsLines } from '../readiness';
import { linkedTags, linksOf, productOf, withBrief, withScreenRole } from '../screen-index';

const note = (ref: string, screenTag: string, best = false): BatchNote => ({
  ref,
  image: `screen-${ref}.png`,
  source: 'ours',
  topics: ['layout'],
  works: `Works ${ref}.`,
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  screenTag,
  ...(best ? { best: true as const } : {}),
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

/** Multi-Calendar's screens today and its target style, and Inbox on its own. */
function library(): Collection {
  const c: Collection = {
    ...newCollection('My rules', 'c1', '2026-10-25T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-25',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-25/',
        images: 3,
        notes: [
          note('01.1', 'Multi-Calendar'),
          note('02.1', 'Marketing Asset - Multi-Calendar', true),
          note('03.1', 'Inbox'),
        ],
      },
    ],
    rules: [rule('a', ['01.1']), rule('b', ['02.1']), rule('c', ['03.1'])],
  };
  const roles = withScreenRole(
    withScreenRole(c, 'Multi-Calendar', 'today', 'n'),
    'Marketing Asset - Multi-Calendar',
    'target',
    'n',
  );
  return withBrief(roles, 'Marketing Asset - Multi-Calendar', 'Stays at a glance.', 'n');
}

const rulesFor = async (c: Collection, screenTags: string[]) =>
  (
    (await answer(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_design_rules', arguments: { screenTags } },
      },
      async () => c,
    )) as { result: { content: { text: string }[] } }
  ).result.content[0].text;

describe('a product’s screens today and its target style, linked (D130)', () => {
  it('reads one product from the tag’s last part, across spellings', () => {
    for (const [a, b] of [
      ['Multi-Calendar', 'Marketing Asset - Multi-Calendar'],
      ['Unified Inbox', 'Marketing Assets - Unified Inbox'],
      ['Agent Hub', 'Marketing Assets - Agenthub'],
      ['PriceOptimizer', 'Marketing Asset - Price Optimiser'],
      ['Reservations', 'Marketing Asset - Reservation'],
    ])
      assert.equal(productOf(a), productOf(b), `${a} and ${b}`);
    for (const [a, b] of [
      ['Agent Hub', 'Agent Hub Activity'],
      ['Marketing Assets', 'Marketing Assets - Unified Inbox'],
      ['Reports', 'AI Revenue Center'],
    ])
      assert.notEqual(productOf(a), productOf(b), `${a} and ${b}`);
  });

  it('brings the other set when one is asked for, each named with its role', async () => {
    const c = library();
    assert.deepEqual(linkedTags(c, ['multi calendar']), [
      'multi calendar',
      'Marketing Asset - Multi-Calendar',
    ]);
    assert.deepEqual(linksOf(c, 'Inbox'), []);
    const text = await rulesFor(c, ['Multi-Calendar']);
    assert.match(text, /^R1\. Rule a\./m);
    assert.match(text, /^R2\. Rule b\./m);
    assert.doesNotMatch(text, /Rule c\./);
    assert.match(text, /“Marketing Asset - Multi-Calendar”: Stays at a glance\./);
    assert.match(text, /Multi-Calendar.*how the product looks today/);
    assert.match(text, /Marketing Asset - Multi-Calendar.*target style/i);
  });

  it('shares the brief and best examples in readiness, and names the link', () => {
    const c = library();
    assert.match(
      topicsText(c),
      /^- Multi-Calendar: 1 rule, 0 checked, no best example, a brief; one product with Marketing Asset - Multi-Calendar$/m,
    );
    assert.deepEqual(
      gapsLines(
        c,
        rulesOf(c).map((r) => r.rule),
        ['Multi-Calendar'],
      ),
      [],
    );
  });

  it('is one product on the free plan', () => {
    const c = { ...library(), freeProduct: 'multicalendar' };
    const [a, b, inbox] = c.rules;
    assert.equal(inFreePlan(c, a), true);
    assert.equal(inFreePlan(c, b), true);
    assert.equal(inFreePlan(c, inbox), false);
  });
});
