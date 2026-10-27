import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Asset } from '../model';
import type { PointerSample, Take } from '../narration';
import {
  applyTake,
  claimsOf,
  flipVerdict,
  isWhole,
  placeClaim,
  topicsOfClaim,
  verdictOfClaim,
  voiceNotes,
  voicePrefix,
} from '../voice-notes';
import type { TimedWord } from '../voice-tags';

/** Words 300ms apart from `t`; "…" stands for a long pause. */
function say(text: string, t = 0): TimedWord[] {
  const words: TimedWord[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token === '…') {
      t += 1500;
      continue;
    }
    words.push({ text: token, start: t, end: t + 250 });
    t += 300;
  }
  return words;
}

const size = { width: 1000, height: 1000 };
const claim = (text: string, t = 0) => {
  const words = say(text, t);
  return { text, words, start: words[0].start, end: words[words.length - 1].end };
};

/** The pointer resting at a point on screen 0 from `from` to `to`, as the reel samples it. */
const rest = (x: number, y: number, from: number, to: number): PointerSample[] => [
  [from, 0, x, y],
  [to, 0, null, null],
];

/** The pointer going round a circle on screen 0 from `from`, one sample every 20ms. */
function circle(cx: number, cy: number, r: number, from: number): PointerSample[] {
  const out: PointerSample[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    out.push([from + i * 20, 0, cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

describe('voice notes: claims', () => {
  it('makes a claim of each sentence, split at a contrast', () => {
    assert.deepEqual(
      claimsOf(say('The type is lovely, but the spacing is cramped. … Love the empty state')).map(
        (c) => c.text,
      ),
      ['The type is lovely.', 'The spacing is cramped.', 'Love the empty state.'],
    );
  });
  it('drops what says nothing on its own', () => {
    assert.deepEqual(
      claimsOf(say('Um. Okay so. The nav is calm.')).map((c) => c.text),
      ['The nav is calm.'],
    );
  });
});

describe('voice notes: works or avoid', () => {
  it('reads praise as what works and faults as what to avoid', () => {
    assert.equal(verdictOfClaim('I love how calm this header is.'), 'good');
    assert.equal(verdictOfClaim('The primary button is too heavy.'), 'bad');
    assert.equal(verdictOfClaim('The spacing between the cards feels cramped.'), 'bad');
  });
  it('turns a word round after a not', () => {
    assert.equal(verdictOfClaim("I don't like the gradient."), 'bad');
    assert.equal(verdictOfClaim('Honestly not bad.'), 'good');
    assert.equal(verdictOfClaim("The label doesn't scan."), 'bad');
  });
  it('takes a plain description as what works', () => {
    assert.equal(verdictOfClaim('The price sits under the title.'), 'good');
  });
  it('flips, and a flipped note is no longer a best example', () => {
    const m = flipVerdict({
      id: 'a',
      shape: { kind: 'dot', x: 0, y: 0 },
      label: '',
      good: 'Calm.',
      bad: '',
      origin: 'voice',
      best: true,
    });
    assert.equal(m.bad, 'Calm.');
    assert.equal(m.good, '');
    assert.equal(m.best, undefined);
  });
  it('names the topics in the words', () => {
    assert.deepEqual(topicsOfClaim('The spacing and the font colour.'), ['visual', 'layout']);
    assert.deepEqual(topicsOfClaim('It feels right.'), []);
  });
});

describe('voice notes: where the pointer was', () => {
  it('puts a circle as the area it goes round', () => {
    const shape = placeClaim(
      claim('These three cards are calm'),
      circle(0.5, 0.4, 0.1, 100),
      0,
      size,
    );
    assert.equal(shape.kind, 'area');
    if (shape.kind !== 'area') return;
    assert.ok(Math.abs(shape.x - 0.39) < 0.02 && Math.abs(shape.w - 0.22) < 0.03);
  });
  it('puts a dot where the pointer rests', () => {
    assert.deepEqual(
      placeClaim(claim('The button is too heavy'), rest(0.2, 0.8, 0, 1200), 0, size),
      { kind: 'dot', x: 0.2, y: 0.8 },
    );
  });
  it('puts a dot where the pointer is at "this", even moving', () => {
    const moving: PointerSample[] = [
      [0, 0, 0.1, 0.1],
      [250, 0, 0.12, 0.13],
      [650, 0, 0.6, 0.3],
      [700, 0, 0.7, 0.4],
    ];
    assert.deepEqual(placeClaim(claim('I like this a lot'), moving, 0, size), {
      kind: 'dot',
      x: 0.12,
      y: 0.13,
    });
  });
  it('puts an arrow between two rests for a move', () => {
    const path = [...rest(0.2, 0.2, 0, 700), ...rest(0.7, 0.6, 900, 1600)];
    assert.deepEqual(placeClaim(claim('Move the logo over to the right'), path, 0, size), {
      kind: 'arrow',
      x: 0.2,
      y: 0.2,
      x2: 0.7,
      y2: 0.6,
    });
  });
  it('is about the whole screen with no pointer on it', () => {
    assert.ok(isWhole(placeClaim(claim('The whole thing feels calm'), [], 0, size)));
    const off: PointerSample[] = [[0, 0, null, null]];
    assert.ok(isWhole(placeClaim(claim('The whole thing feels calm'), off, 0, size)));
  });
  it('reads only the screen the claim is on', () => {
    const other: PointerSample[] = [
      [0, 1, 0.5, 0.5],
      [1200, 1, 0.8, 0.8],
    ];
    assert.ok(isWhole(placeClaim(claim('The button is too heavy'), other, 0, size)));
  });
});

describe('voice notes: a take applied', () => {
  const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
    id,
    name: `${id}.png`,
    type: 'image/png',
    width: 1000,
    height: 1000,
    note: '',
    marks: [],
    ...extra,
  });
  const take = (
    words: TimedWord[],
    pointer: PointerSample[] = [],
    shown = [
      { t: 0, screen: 0 },
      { t: 10_000, screen: 1 },
    ],
  ): Take => ({
    id: 'aaaa-bbbb',
    version: 1,
    recordedAt: '2026-10-27T10:00:00.000Z',
    durationMs: 20_000,
    mimeType: 'audio/webm',
    screens: [
      { id: 'one', name: 'one.png', width: 1000, height: 1000 },
      { id: 'two', name: 'two.png', width: 1000, height: 1000 },
    ],
    shown,
    pointer,
    words,
  });

  it('makes a note of each claim, with its words, on its screen', () => {
    const [one, two] = applyTake(
      [asset('one'), asset('two')],
      take([...say('The button is too heavy.'), ...say('The list reads well.', 11_000)]),
    );
    assert.equal(one.marks.length, 1);
    assert.equal(one.marks[0].bad, 'The button is too heavy.');
    assert.equal(one.marks[0].origin, 'voice');
    assert.equal(one.marks[0].quote, 'The button is too heavy.');
    assert.ok(one.marks[0].id.startsWith(voicePrefix('aaaa-bbbb')));
    assert.equal(two.marks[0].good, 'The list reads well.');
  });

  it('replaces what the same take made before', () => {
    const t = take(say('The button is too heavy.'));
    const once = applyTake([asset('one'), asset('two')], t);
    const twice = applyTake(once, t);
    assert.equal(twice[0].marks.length, 1);
  });

  it('keeps the notes made before it', () => {
    const typed = {
      id: 'm1',
      shape: { kind: 'dot' as const, x: 0, y: 0 },
      label: '',
      good: 'Typed.',
      bad: '',
      origin: 'user' as const,
    };
    const [one] = applyTake(
      [asset('one', { marks: [typed] }), asset('two')],
      take(say('The button is too heavy.')),
    );
    assert.deepEqual(
      one.marks.map((m) => m.origin),
      ['user', 'voice'],
    );
  });

  it('sets the tag and source said, and carries them to the next screen', () => {
    const [one, two] = applyTake(
      [asset('one'), asset('two')],
      take([...say('Tag this as checkout. A competitor.'), ...say('The list reads well.', 11_000)]),
    );
    assert.equal(one.screenTag, 'Checkout');
    assert.deepEqual(one.source, { kind: 'competitor' });
    assert.equal(two.screenTag, 'Checkout');
    assert.deepEqual(two.source, { kind: 'competitor' });
  });

  it('carries a tag only to a screen that has none', () => {
    const [, two] = applyTake(
      [asset('one'), asset('two', { screenTag: 'Billing' })],
      take(say('Tag this as checkout.')),
    );
    assert.equal(two.screenTag, 'Billing');
  });

  it('stars and drops the note meant', () => {
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(
        say('The header is calm. … The footer is too busy. … Drop the second one. … Star this.'),
      ),
    );
    assert.deepEqual(
      voiceNotes(one).map((m) => [m.good || m.bad, m.best]),
      [['The header is calm.', true]],
    );
  });

  it('adds the topics said to the last note', () => {
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(say("The header is calm. … That's about copy.")),
    );
    assert.deepEqual(one.marks[0].topics, ['copy']);
  });

  it('redoes a screen: what was said on it before goes', () => {
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(say('The header is calm. … Redo this screen. … The header is loud.')),
    );
    assert.deepEqual(
      one.marks.map((m) => m.good || m.bad),
      ['The header is loud.'],
    );
  });

  it('moves the last note to where the pointer is at "not that, this"', () => {
    const words = say('The button is too heavy. … Not that, this.');
    const at = words.at(-1)?.end ?? 0;
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(words, [...rest(0.2, 0.2, 0, 900), [at - 100, 0, 0.6, 0.7]]),
    );
    assert.deepEqual(one.marks[0].shape, { kind: 'dot', x: 0.6, y: 0.7 });
  });

  it('leaves out a screen no longer in the batch', () => {
    const out = applyTake(
      [asset('two')],
      take([...say('Gone.'), ...say('The list reads well.', 11_000)]),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].marks.length, 1);
  });
});
