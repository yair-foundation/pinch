import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type BatchNote, type Collection, mergeCollection, newCollection, type Rule } from '../learnings';
import { beyondFree, freePlan, freeProductOf, inFreePlan, productsOf, withFreeProduct } from '../plan';

const note = (ref: string, screenTag?: string): BatchNote => ({
  ref,
  image: `${ref}.png`,
  source: 'ours',
  topics: ['visual'],
  works: 'x',
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  ...(screenTag ? { screenTag } : {}),
});

const rule = (id: string, notes: string[]): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: notes.map((note) => ({ batchId: 'b1', note })),
  status: 'approved',
  createdAt: '2026-10-24T10:00:00Z',
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-24T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'b',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'b/',
        images: 5,
        notes: [
          note('01.1', 'Agent Hub'),
          note('02.1', 'agent hub'),
          note('03.1', 'Multi-calendar'),
          note('04.1'),
        ],
      },
    ],
    rules: [
      rule('hub', ['01.1', '02.1']),
      rule('cal', ['03.1']),
      rule('both', ['01.1', '03.1']),
      rule('none', ['04.1']),
      rule('agreed', []),
    ],
  };
}

describe('the free plan’s one product (D123)', () => {
  it('is the set with the most notes until the author picks one', () => {
    const c = library();
    assert.equal(freeProductOf(c), 'Agent Hub');
    const picked = withFreeProduct(c, 'multi calendar', 'now');
    assert.equal(freeProductOf(picked), 'Multi-calendar');
    assert.equal(freeProductOf({ ...c, freeProduct: 'gone' }), 'Agent Hub');
    assert.equal(freeProductOf(newCollection('x', 'c', 'n')), null);
  });

  it('gives the agent that product’s rules and those drawn from no product', () => {
    const c = library();
    assert.deepEqual([...productsOf(c, c.rules[2])].length, 2);
    assert.deepEqual(
      freePlan(c).rules.map((r) => r.id),
      ['hub', 'both', 'none', 'agreed'],
    );
    assert.equal(inFreePlan(c, c.rules[1]), false);
    assert.equal(beyondFree(c, c.rules), 1);
    const cal = withFreeProduct(c, 'Multi-calendar', 'n');
    assert.deepEqual(
      freePlan(cal).rules.map((r) => r.id),
      ['cal', 'both', 'none', 'agreed'],
    );
    const untagged = { ...c, batches: [{ ...c.batches[0], notes: [note('01.1'), note('03.1')] }] };
    assert.equal(freePlan(untagged).rules.length, c.rules.length, 'no products, no limit');
  });

  it('survives a merge, this one’s pick first', () => {
    const into = library();
    const from = withFreeProduct({ ...library(), id: 'c2' }, 'Multi-calendar', 'n');
    from.batches = from.batches.map((b) => ({ ...b, id: 'b2' }));
    assert.equal(mergeCollection(into, from, 'later').freeProduct, from.freeProduct);
    assert.equal(
      mergeCollection(withFreeProduct(into, 'Agent Hub', 'n'), from, 'later').freeProduct,
      withFreeProduct(into, 'Agent Hub', 'n').freeProduct,
    );
  });
});
