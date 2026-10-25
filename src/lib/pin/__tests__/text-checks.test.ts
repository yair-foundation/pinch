import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { CHECK_SCRIPT } from '../check-script';
import {
  CHECK_KINDS,
  checksBasis,
  checksOf,
  cleanChecks,
  cleanValue,
  FLAG_KINDS,
  valueText,
  withChecks,
} from '../checks';
import { type Collection, newCollection, type Rule, rulesOf } from '../learnings';
import { checksGuide } from '../package-checks';

type Failure = { check: string; where: string; found: string; rules: { id: string }[] };
type Script = {
  evaluate: (
    spec: unknown,
    texts: unknown[],
    colours: unknown[],
    more?: unknown,
  ) => { passed: boolean; failures: Failure[]; skipped: { images: number } };
  report: (r: unknown) => string;
  shouting: (t: string) => boolean;
  titleCased: (t: string) => boolean;
  numericDate: (t: string) => string;
};

/** The script as a page would load it, through Node's module exports. */
function script(): Script {
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(CHECK_SCRIPT, { module, globalThis: {} });
  return module.exports as unknown as Script;
}

const text = (where: string, words: string, extra: Record<string, unknown> = {}) => ({
  where,
  text: words,
  full: words,
  size: 16,
  family: 'Figtree',
  colour: 'rgb(23, 23, 23)',
  background: 'rgb(255, 255, 255)',
  underlined: false,
  upper: false,
  align: 'start',
  heading: false,
  ...extra,
});

const flags = (...kinds: string[]) => ({
  checks: kinds.map((kind, i) => ({ kind, value: true, rules: [{ id: `R${i + 1}`, key: kind }] })),
});

describe('checks that need no number (D127)', () => {
  const s = script();

  it('tells capitals, Title Case and numeric dates from what passes', () => {
    assert.equal(s.shouting('NEW BOOKING'), true);
    assert.equal(s.shouting('PAYOUTS'), true);
    assert.equal(s.shouting('AI insights in USD'), false);
    assert.equal(s.titleCased('Owner Payout Preview'), true);
    assert.equal(s.titleCased('Owner payout preview'), false);
    assert.equal(s.titleCased('Unified Inbox'), false, 'one longer word after the first');
    assert.equal(s.titleCased('Payouts With Your Owner'), false, 'small words aside');
    assert.equal(s.numericDate('Check-in 10/25/2026'), '10/25/2026');
    assert.equal(s.numericDate('Due 2026-10-25'), '2026-10-25');
    assert.equal(s.numericDate('25.10.26'), '25.10.26');
    assert.equal(s.numericDate('Oct 25, 2026'), '');
    assert.equal(s.numericDate('Version 1.2.3'), '');
    assert.equal(s.numericDate('40/40/2026'), '');
  });

  it('fails each with the rules it breaks, and passes a page that keeps them', () => {
    const spec = flags(
      'underlines',
      'allCaps',
      'titleCase',
      'numericDates',
      'centredTitles',
      'stretchedImages',
      'unlabelledInputs',
    );
    const bad = s.evaluate(
      spec,
      [
        text('a', 'View details', { underlined: true }),
        text('span', 'new', { upper: true }),
        text('h1', 'Owner Payout Preview', { heading: true, size: 32, align: 'center' }),
        text('td', 'Paid on 10/25/2026'),
        text('p', 'Body'),
        text('p', 'Body'),
      ],
      [],
      {
        images: [
          { where: 'img.hero', text: 'Lake house', natural: 1.5, shown: 1 },
          { where: 'img.later', text: '', natural: 0, shown: 1 },
        ],
        inputs: [{ where: 'input', text: 'Search', labelled: false }],
      },
    );
    assert.deepEqual(
      [...bad.failures.map((f) => `${f.check} ${f.rules[0].id} ${f.where}`)],
      [
        'underlines R1 a',
        'allCaps R2 span',
        'titleCase R3 h1',
        'numericDates R4 td',
        'centredTitles R5 h1',
        'stretchedImages R6 img.hero',
        'unlabelledInputs R7 input',
      ],
    );
    assert.equal(bad.skipped.images, 1);
    assert.match(s.report(bad), /1 images not loaded: proportions not checked\./);
    assert.match(
      s.report(bad),
      /FAIL stretchedImages \(R6\) at img\.hero "Lake house": shown 33% narrower/,
    );
    const good = s.evaluate(
      spec,
      [
        text('a', 'View details'),
        text('span', 'AI'),
        text('h1', 'Owner payout preview', { heading: true, size: 32 }),
        text('td', 'Paid on Oct 25'),
      ],
      [],
      {
        images: [{ where: 'img', text: '', natural: 1.5, shown: 1.51 }],
        inputs: [{ where: 'input', text: '', labelled: true }],
      },
    );
    assert.equal(good.passed, true);
  });

  it('counts large text as a title, and a centred figure as no title', () => {
    const r = s.evaluate(
      flags('centredTitles'),
      [
        text('div.big', 'Revenue this month', { size: 24, align: 'center' }),
        text('div.figure', '$1,240', { size: 40, align: 'center' }),
        text('p', 'Body one'),
        text('p', 'Body two'),
      ],
      [],
    );
    assert.deepEqual([...r.failures.map((f) => f.where)], ['div.big']);
  });

  it('are kept with no value, named in the package, and ask again for unchanged rules', () => {
    assert.equal(cleanValue('underlines', null), true);
    assert.equal(valueText({ value: true }), 'On');
    assert.ok(FLAG_KINDS.every((k) => CHECK_KINDS.includes(k)));
    const kept = cleanChecks(
      {
        checks: [
          { kind: 'allCaps', number: null, list: [], rules: ['a', 'zz'], why: 'Rule R1 says so.' },
          { kind: 'allCaps', number: null, list: [], rules: ['a'], why: 'Twice.' },
        ],
      },
      ['a'],
    );
    assert.deepEqual(kept, [
      { kind: 'allCaps', value: true, rules: ['a'], why: 'Rule R1 says so.' },
    ]);
    const rule: Rule = {
      id: 'a',
      text: 'Avoid all-capital words.',
      context: '',
      topics: ['copy'],
      tags: [],
      evidence: [],
      status: 'approved',
      createdAt: 'x',
    };
    const c: Collection = { ...newCollection('My rules', 'c1', 'x'), rules: [rule] };
    const md = checksGuide(withChecks(c, kept, 'b', 'n'), rulesOf(c), 'x');
    assert.match(md, /- \*\*No words in capitals\*\*\. No text is set in capitals.* Holds R1\./);
    assert.equal(checksOf(withChecks(c, kept, 'b', 'n')).length, 1);
    assert.match(checksBasis([{ id: 'a', text: 'Avoid all-capital words.' }]), /^1-/);
  });
});
