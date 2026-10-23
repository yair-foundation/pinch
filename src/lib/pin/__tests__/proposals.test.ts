import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Collection, newCollection, type Rule, rulesOf, rulesText } from '../learnings';
import {
  keepProposal,
  MAX_PROPOSALS,
  type Proposal,
  proposalOf,
  proposalsIn,
  withProposal,
} from '../proposals';

const rule = (id: string, text: string, more: Partial<Rule> = {}): Rule => ({
  id,
  text,
  title: `Title ${id}`,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: [{ batchId: 'b1', note: '01.1' }],
  status: 'approved',
  createdAt: `2026-10-21T10:00:0${id.length}Z`,
  ...more,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-21T10:00:00Z'),
    rules: [
      rule('a', 'Avoid gradients on AI chat bubbles.'),
      rule('bb', 'Leave a gap between connectors and what they link.'),
    ],
  };
}

const proposal = (args: Record<string, unknown>, c: Collection | null = library()) => {
  const out = proposalOf(args, c, '2026-10-23T10:00:00Z', 'p1');
  if ('error' in out) throw new Error(out.error);
  return out.proposal;
};

describe('a rule proposed by the agent (D116)', () => {
  it('is a new rule, tidied, with what was agreed', () => {
    const p = proposal({
      text: '  AI boxes are   white. ',
      where: 'in AI features',
      topics: ['visual', 'nonsense', 'visual'],
      why: 'The person said AI boxes stay white, with only a glow.',
    });
    assert.deepEqual(p, {
      id: 'p1',
      at: '2026-10-23T10:00:00Z',
      text: 'AI boxes are white.',
      where: 'in AI features',
      topics: ['visual'],
      why: 'The person said AI boxes stay white, with only a glow.',
    });
  });

  it('changes a rule by its number, kept as the rule’s lasting key and what it said', () => {
    const p = proposal({
      rule: 'R2',
      text: 'End dots sit centred on the card edge.',
      why: 'Agreed.',
    });
    assert.equal(p.rule, 'bb');
    assert.equal(p.was, 'Leave a gap between connectors and what they link.');
  });

  it('says what is missing or wrong', () => {
    const err = (args: Record<string, unknown>, c: Collection | null = library()) => {
      const out = proposalOf(args, c, 'now', 'p1');
      return 'error' in out ? out.error : '';
    };
    assert.match(err({ why: 'x' }), /Give the rule in text/);
    assert.match(err({ text: 'x' }), /Give why/);
    assert.match(
      err({ rule: 'R9', text: 'x', why: 'y' }),
      /No rule R9\. Rules are numbered R1 to R2/,
    );
    assert.match(err({ rule: 'R1', text: 'x', why: 'y' }, null), /no rules to change yet/);
  });

  it('waits once, and no more than the cap', () => {
    const p = proposal({ text: 'One.', why: 'x' });
    const list = withProposal([], p);
    assert.equal(withProposal(list, { ...p, id: 'p2', text: 'ONE.' }), list, 'the same one again');
    const many = Array.from({ length: MAX_PROPOSALS + 3 }, (_, i) => ({
      ...p,
      id: `p${i}`,
      text: `R ${i}.`,
    }));
    const capped = many.reduce(withProposal, [] as Proposal[]);
    assert.equal(capped.length, MAX_PROPOSALS);
    assert.equal(capped[0].id, 'p3', 'the oldest go');
  });

  it('reads only proposals back from the store', () => {
    const p = proposal({ text: 'One.', why: 'x' });
    assert.deepEqual(proposalsIn({ proposals: [p, { id: 1 }, null, 'x'] }), [p]);
    assert.deepEqual(proposalsIn(null), []);
  });
});

describe('keeping a proposal (D116)', () => {
  it('adds a new rule with no notes, which reaches the agent with what was agreed', () => {
    const p = proposal({
      text: 'AI boxes are white.',
      topics: ['visual'],
      why: 'Said in round 4.',
    });
    const c = keepProposal(library(), p, 'now', () => 'new1');
    const kept = c.rules.find((r) => r.id === 'new1');
    assert.deepEqual(kept, {
      id: 'new1',
      text: 'AI boxes are white.',
      context: '',
      topics: ['visual'],
      tags: [],
      evidence: [],
      status: 'approved',
      agreed: { why: 'Said in round 4.', at: 'now' },
      createdAt: 'now',
    });
    assert.ok(
      rulesOf(c).some((r) => r.rule.id === 'new1'),
      'the agent gets it',
    );
    assert.match(
      rulesText(c, rulesOf(c)),
      /agreed with the designer in conversation: Said in round 4\./,
    );
  });

  it('changes a rule’s words and place and keeps its notes; its title goes, to be named again', () => {
    const p = proposal({
      rule: 'R1',
      text: 'AI chat bubbles a person sent may take the AI gradient.',
      where: 'in sent AI replies',
      why: 'Agreed.',
    });
    const c = keepProposal(library(), p, 'now', () => 'unused');
    const changed = c.rules.find((r) => r.id === 'a');
    assert.equal(changed?.text, 'AI chat bubbles a person sent may take the AI gradient.');
    assert.equal(changed?.context, 'in sent AI replies');
    assert.deepEqual(changed?.topics, ['visual'], 'no topics given: they stay');
    assert.deepEqual(changed?.evidence, [{ batchId: 'b1', note: '01.1' }]);
    assert.ok(!('title' in (changed ?? {})));
    assert.equal(c.rules.length, 2);
  });

  it('keeps a change to a rule removed since as a new rule', () => {
    const p = proposal({ rule: 'R1', text: 'New words.', why: 'Agreed.' });
    const before = library();
    before.rules[0] = { ...before.rules[0], status: 'dismissed' };
    const c = keepProposal(before, p, 'now', () => 'new1');
    assert.equal(c.rules.length, 3);
    assert.equal(c.rules.find((r) => r.id === 'a')?.text, 'Avoid gradients on AI chat bubbles.');
  });
});
