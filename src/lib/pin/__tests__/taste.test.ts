import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { learnSystem } from '../learn';
import {
  type Collection,
  newCollection,
  type Rule,
  rulesOf,
  rulesText,
  settleConflict,
  withRule,
} from '../learnings';
import { answerOf, TASTE, withTaste } from '../taste';

const now = '2026-10-21T00:00:00.000Z';
const ids = () => {
  let n = 0;
  return () => `t${++n}`;
};
const rule = (over: Partial<Rule> & { id: string; text: string }): Rule => ({
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: [],
  status: 'approved',
  createdAt: now,
  ...over,
});
const withRules = (rules: Rule[]): Collection => ({
  ...newCollection('Ada', 'c1', now),
  rules,
});

describe('the taste check (D102)', () => {
  it('asks a dozen questions, each option a rule with a short name', () => {
    assert.equal(TASTE.length, 12);
    for (const q of TASTE) {
      assert.ok(q.options.length >= 2, q.id);
      assert.equal(new Set(q.options.map((o) => o.id)).size, q.options.length, q.id);
      for (const o of q.options) {
        assert.match(o.rule, /\.$/, `${q.id}:${o.id} is a sentence`);
        assert.ok(o.title.split(' ').length <= 5, `${q.id}:${o.id} has a short title`);
        assert.doesNotMatch(o.label + o.rule, /->|→/, 'no text arrows');
      }
    }
  });

  it('keeps each pick as the author’s own rule, with no notes, which the agent gets', () => {
    const c = withTaste(withRules([]), { dark: 'black', motion: 'fade' }, now, ids());
    assert.equal(c.rules.length, 2);
    const dark = c.rules.find((r) => r.taste === 'dark:black');
    assert.ok(dark);
    assert.equal(dark.title, 'True black dark mode');
    assert.equal(dark.evidence.length, 0);
    assert.equal(dark.drafted, undefined, "the author's words, not Pinch's");
    assert.equal(answerOf(c, 'dark'), 'black');
    assert.equal(answerOf(c, 'accent'), null);
    const text = rulesText(c, rulesOf(c));
    assert.match(text, /true black background/);
    assert.match(text, /^ {3}- the designer's own pick in Pinch's taste check$/m);
  });

  it('taken again, keeps an answer that stayed and rewrites one that changed', () => {
    const first = withTaste(withRules([]), { dark: 'black', corners: 'round' }, now, ids());
    const dark = first.rules.find((r) => r.taste === 'dark:black');
    assert.ok(dark);
    const edited = withRule(first, dark.id, { text: 'True black, borders #222.' }, now);
    const again = withTaste(edited, { dark: 'black', corners: 'square' }, now, ids());
    assert.equal(again.rules.length, 2, 'never a second rule for one question');
    assert.equal(
      again.rules.find((r) => r.id === dark.id)?.text,
      'True black, borders #222.',
      "the author's edit stays",
    );
    const corners = again.rules.find((r) => r.taste?.startsWith('corners:'));
    assert.equal(corners?.taste, 'corners:square');
    assert.equal(corners?.text, 'Keep corners square or barely rounded.');
  });

  it('brings back a removed pick when it is picked again, and leaves a skipped one alone', () => {
    const first = withTaste(withRules([]), { voice: 'plain', imagery: 'product' }, now, ids());
    const voice = first.rules.find((r) => r.taste === 'voice:plain');
    assert.ok(voice);
    const removed = withRule(first, voice.id, { status: 'dismissed' }, now);
    assert.equal(answerOf(removed, 'voice'), null);
    const again = withTaste(removed, { voice: 'plain' }, now, ids());
    assert.equal(again.rules.find((r) => r.id === voice.id)?.status, 'approved');
    assert.equal(again.rules.filter((r) => r.taste?.startsWith('imagery:')).length, 1);
    assert.equal(withTaste(again, {}, now, ids()), again, 'no picks, no change');
  });
});

describe('rules for an agent (D102)', () => {
  it('come before general design guidance', () => {
    const c = withRules([rule({ id: 'a', text: 'Separate sections with space.' })]);
    assert.match(
      rulesText(c, rulesOf(c)),
      /where general design guidance or a design skill you also follow says otherwise, these rules win/,
    );
  });

  it('say which of two rules that pull against each other to follow, and where', () => {
    const small = rule({ id: 'small', text: 'Keep figures small.' });
    const big = rule({
      id: 'big',
      text: 'Show the key figure big and bold.',
      context: 'on KPI cards',
      conflict: { ruleId: 'small', why: 'One keeps figures small, the other wants them big.' },
      createdAt: '2026-10-22T00:00:00.000Z',
    });
    const c = withRules([small, big]);
    const text = rulesText(c, rulesOf(c));
    assert.match(
      text,
      /^ {3}Pulls against R1, not settled by the designer yet: One keeps figures small, the other wants them big\. Follow this one on KPI cards, R1 elsewhere\.$/m,
    );

    const placed = settleConflict(c, 'big', 'place', now);
    assert.equal(placed.rules.find((r) => r.id === 'big')?.conflict?.settled, true);
    assert.match(
      rulesText(placed, rulesOf(placed)),
      /^ {3}Holds over R1\. Follow this one on KPI cards, R1 elsewhere\.$/m,
    );

    const won = settleConflict(c, 'big', 'wins', now);
    assert.equal(won.rules.find((r) => r.id === 'small')?.status, 'dismissed');
    assert.equal(won.rules.find((r) => r.id === 'big')?.conflict, undefined);
    const left = rulesText(won, rulesOf(won));
    assert.doesNotMatch(left, /Pulls against|Holds over/);
    assert.match(left, /^R1\. Show the key figure big and bold\./m);
  });

  it('follow the newer rule where neither says where, and never name a rule the agent lacks', () => {
    const old = rule({ id: 'old', text: 'Keep page titles short.' });
    const newer = rule({
      id: 'new',
      text: 'Give tutorial titles long wording.',
      conflict: { ruleId: 'old', why: '' },
      createdAt: '2026-10-22T00:00:00.000Z',
    });
    const c = withRules([old, newer]);
    assert.match(
      rulesText(c, rulesOf(c)),
      /^ {3}Pulls against R1, not settled by the designer yet\. Follow this one, the newer\.$/m,
    );
    const gone = withRule(c, 'old', { status: 'dismissed' }, now);
    assert.doesNotMatch(rulesText(gone, rulesOf(gone)), /Pulls against/);
  });
});

describe('where a rule holds (D102)', () => {
  it('tells the reading that a quality of the whole look has no place of its own', () => {
    assert.match(learnSystem, /A quality of the whole look or voice/);
    assert.match(learnSystem, /set a context for it only when notes contrast places/);
  });
});
