import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assetsOf, batchNotes, readExport } from '../import';
import { type Asset, manifest } from '../model';
import type { PointerSample, Take } from '../narration';
import { takePackage } from '../notes-package';
import {
  aboutTheScreen,
  applyTake,
  claimsOf,
  flipVerdict,
  heard,
  isWhole,
  leanOfClaim,
  placeClaim,
  placesOfClaim,
  pointerOn,
  reachOf,
  removedScreens,
  sidesOf,
  takesApplied,
  topicsOfClaim,
  verdictOfClaim,
  voiceNotes,
  voicePrefix,
  wordsIn,
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

describe('voice notes: pauses', () => {
  /** Words at the given start times, in ms, each 200ms long. */
  const timed = (...said: [string, number][]) =>
    said.map(([text, start]) => ({ text, start, end: start + 200 }));

  it('keeps a sentence whole across a pause in it, as the author talks', () => {
    assert.deepEqual(
      claimsOf(
        timed(
          ["It's", 0],
          ['setting', 300],
          ['a', 600],
          ['nice', 900],
          ['atmosphere', 1200],
          ['and', 2500],
          ['vibes.', 2800],
          ['It', 4600],
          ['is', 4900],
          ['too', 5200],
          ['much', 5500],
          ['height.', 7000],
        ),
      ).map((c) => c.text),
      ["It's setting a nice atmosphere and vibes.", 'It is too much height.'],
    );
  });
  it('ends a sentence at a pause before a capital, with no full stop to go on', () => {
    assert.deepEqual(
      claimsOf(
        timed(['Great', 0], ['title', 300], ['The', 1500], ['icons', 1800], ['are', 2100], ['plain', 2400]),
      ).map((c) => c.text),
      ['Great title.', 'The icons are plain.'],
    );
  });
  it('ends one at a very long pause, whatever comes next', () => {
    assert.deepEqual(
      claimsOf(timed(['Great', 0], ['title', 300], ['the', 7000], ['icons', 7300])).map(
        (c) => c.text,
      ),
      ['Great title.', 'The icons.'],
    );
  });
  it('ends one at a long pause before lower case, unless the words go on (D192)', () => {
    const texts = (...words: [string, number][]) => claimsOf(timed(...words)).map((c) => c.text);
    // Read piece by piece, a short remark has no capital and no full stop.
    assert.deepEqual(
      texts(['No', 0], ['margin', 300], ['in', 600], ['here', 900], ['too', 5000], ['much', 5300], ['margin', 5600]),
      ['No margin in here.', 'Too much margin.'],
    );
    // A stop to point, under two and a half seconds, is the same sentence.
    assert.deepEqual(texts(['Make', 0], ['it', 300], ['sharp', 2500], ['corners.', 2800]), [
      'Make it sharp corners.',
    ]);
    // A word no remark begins with goes on, however long the stop.
    assert.deepEqual(
      texts(['We', 0], ["don't", 300], ['have', 600], ['these', 900], ['shapes', 1200], ['in', 7000], ['the', 7300], ['system.', 7600]),
      ["We don't have these shapes in the system."],
    );
    // So does a sentence that stopped on a word no remark ends on, or on a comma.
    assert.deepEqual(
      texts(['Avoid', 0], ['mocks', 300], ['without', 600], ['a', 4000], ['real', 4300], ['design.', 4600]),
      ['Avoid mocks without a real design.'],
    );
    assert.deepEqual(texts(['Again,', 0], ['screenshot.', 3500]), ['Again, screenshot.']);
    // And an order still waiting for how.
    assert.deepEqual(
      texts(['make', 0], ['those', 300], ['titles', 600], ['bigger', 4200], ['and', 4500], ['bolder.', 4800]),
      ['Make those titles bigger and bolder.'],
    );
  });
  it('runs a sentence on past "is", unless it says where or how something is (D192)', () => {
    assert.deepEqual(
      claimsOf(
        timed(['The', 0], ['title', 300], ['is.', 600], ['Wrong', 3000], ['and', 3300], ['small.', 3600]),
      ).map((c) => c.text),
      ['The title is wrong and small.'],
    );
    assert.deepEqual(
      claimsOf(
        timed(['Down', 0], ['left', 300], ['where', 600], ['the', 900], ['disclaimers', 1200], ['are.', 1500], ['Remove', 4000], ['the', 4300], ['dot.', 4600]),
      ).map((c) => c.text),
      ['Down left where the disclaimers are.', 'Remove the dot.'],
    );
  });
  it('runs an unfinished sentence on past the stop and the capital a pause gave it (D186)', () => {
    assert.deepEqual(
      claimsOf(
        timed(['I', 0], ['would', 300], ['make', 600], ['the.', 900], ['UI', 2400], ['bigger.', 2700]),
      ).map((c) => c.text),
      ['I would make the UI bigger.'],
    );
    assert.deepEqual(
      claimsOf(timed(['This', 0], ['is.', 300], ['Okay.', 1800])).map((c) => c.text),
      ['This is okay.'],
    );
  });
  it('drops a sentence that never got to its point, and keeps a verdict of one word (D186)', () => {
    assert.deepEqual(
      claimsOf(
        timed(['This', 0], ['is.', 300], ['Oh,', 9000], ['wait.', 9300], ['This.', 18000], ['To', 27000], ['do.', 27300]),
      ).map((c) => c.text),
      [],
    );
    assert.deepEqual(
      claimsOf(timed(['This', 0], ['is', 300], ['okay.', 600], ['I', 9000], ['like', 9300], ['it.', 9600])).map(
        (c) => c.text,
      ),
      ['This is okay.', 'I like it.'],
    );
  });
  it('keeps a word said alone, but not a stray one', () => {
    assert.deepEqual(
      claimsOf(timed(['Nice.', 0], ['Um.', 2000], ['A.', 4000])).map((c) => c.text),
      ['Nice.'],
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
  it('reads a wish for something else against what is there, and keeping it for it', () => {
    assert.ok(leanOfClaim("I'd want a lighter serif here.") < 0);
    assert.ok(leanOfClaim("I'd rather see one accent.") < 0);
    assert.ok(leanOfClaim("That's exactly the voice I want.") > 0);
    assert.ok(leanOfClaim("I'd keep it.") > 0);
    assert.ok(leanOfClaim("It doesn't shout.") > 0);
  });
  it('reads a whole note: a plain description takes the side of the rest (D147)', () => {
    assert.deepEqual(
      sidesOf(['The balance is set in a medium sans.', "I'd want a light serif."]),
      { good: '', bad: "The balance is set in a medium sans. I'd want a light serif." },
    );
    assert.deepEqual(sidesOf(['The button is small and flat.', "It's lovely."]), {
      good: "The button is small and flat. It's lovely.",
      bad: '',
    });
    assert.deepEqual(sidesOf(['The card is lovely.', 'The label is too small.']), {
      good: 'The card is lovely.',
      bad: 'The label is too small.',
    });
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
  it('puts a dot where the pointer comes to rest just after "this", as pointing lags (D185)', () => {
    const moving: PointerSample[] = [
      [0, 0, 0.1, 0.1],
      [250, 0, 0.12, 0.13],
      [650, 0, 0.6, 0.3],
      [700, 0, 0.7, 0.4],
    ];
    assert.deepEqual(placeClaim(claim('I like this a lot'), moving, 0, size), {
      kind: 'dot',
      x: 0.7,
      y: 0.4,
    });
  });
  it('puts a dot where the pointer is at "this" when it never rests', () => {
    const moving: PointerSample[] = [
      [0, 0, 0.1, 0.1],
      [250, 0, 0.12, 0.13],
      [650, 0, 0.6, 0.3],
      [700, 0, null, null],
    ];
    assert.deepEqual(placeClaim(claim('I like this a lot'), moving, 0, size), {
      kind: 'dot',
      x: 0.12,
      y: 0.13,
    });
  });
  it('reads a sweep that turns but never closes as nothing drawn (D185)', () => {
    // A slow arc round most of the slide over six seconds, ending far from where it began.
    const sweep: PointerSample[] = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * 1.9 * Math.PI;
      sweep.push([i * 100, 0, 0.5 + 0.4 * Math.cos(a), 0.5 + 0.35 * Math.sin(a)]);
    }
    const shape = placeClaim(claim('Remove this slide design, we have no such thing', 1000), sweep, 0, size);
    // Nothing drawn: no area but the whole screen, which "this slide" is (D188).
    assert.ok(shape.kind !== 'area' || isWhole(shape));
  });
  it('reads a closed loop that takes seconds as wandering, not a circle (D185)', () => {
    const slow: PointerSample[] = [];
    for (let i = 0; i <= 80; i++) {
      const a = (i / 80) * 2 * Math.PI;
      slow.push([i * 100, 0, 0.5 + 0.4 * Math.cos(a), 0.5 + 0.4 * Math.sin(a)]);
    }
    const shape = placeClaim(claim('The whole layout feels busy to me here', 2000), slow, 0, size);
    assert.notEqual(shape.kind, 'area');
  });
  it('puts a scrub as the small area it went back and forth over (D185)', () => {
    const scrub: PointerSample[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = 0.3 + 0.1 * (i % 10 < 5 ? (i % 10) / 5 : (10 - (i % 10)) / 5);
      scrub.push([i * 25, 0, x, 0.6 + 0.004 * Math.sin(i)]);
    }
    const shape = placeClaim(claim('The number here is too big'), scrub, 0, size);
    assert.equal(shape.kind, 'area');
    if (shape.kind !== 'area') return;
    assert.ok(shape.w < 0.2 && shape.h < 0.1, `small: ${JSON.stringify(shape)}`);
    assert.ok(Math.abs(shape.x + shape.w / 2 - 0.35) < 0.03);
  });
  it('ignores a hand parked since long before the sentence (D185)', () => {
    const parked = rest(0.9, 0.95, 0, 20_000);
    assert.ok(isWhole(placeClaim(claim('Please find alternatives', 8000), parked, 0, size)));
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
  it('ends a rest where the pointer left the screenshot, not at the end of the sentence', () => {
    const c = claim('The footer is too busy.', 2000);
    const pointer: PointerSample[] = [...rest(0.5, 0.1, 0, 1800), ...rest(0.5, 0.9, 1900, 4000)];
    assert.deepEqual(placeClaim(c, pointer, 0, size), { kind: 'dot', x: 0.5, y: 0.9 });
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

  it('names the takes whose notes are on the batch, for the export to carry (D183)', () => {
    const made = applyTake([asset('one'), asset('two')], take(say('The button is too heavy.')));
    const other: Take = { ...take([]), id: 'cccc-dddd' };
    assert.deepEqual(
      takesApplied(made, [other, take([])]).map((t) => t.id),
      ['aaaa-bbbb'],
    );
    assert.deepEqual(takesApplied([asset('one')], [other, take([])]), []);
  });

  it('makes one note of all that was said about one thing (D147)', () => {
    const words = say("The balance is set in a medium sans. I'd want a light serif.");
    const [one] = applyTake([asset('one'), asset('two')], take(words, circle(0.5, 0.5, 0.1, 0)));
    assert.equal(one.marks.length, 1);
    const [m] = one.marks;
    assert.equal(m.shape.kind, 'area');
    assert.equal(m.good, '');
    assert.equal(m.bad, "The balance is set in a medium sans. I'd want a light serif.");
    assert.equal(m.quote, m.bad);
  });

  it('keeps both sides of one thing in its note, and a contrast in it', () => {
    const words = say("The button is small and flat. It's an obvious action but it doesn't shout.");
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(words, rest(0.3, 0.7, 0, words.at(-1)?.end ?? 0)),
    );
    assert.equal(one.marks.length, 1);
    assert.equal(
      one.marks[0].good,
      "The button is small and flat. It's an obvious action. It doesn't shout.",
    );
  });

  it('keeps the words in the order they were said, all the way to the package', () => {
    // The author's own note: sorted into works and doesn't, it came out with its sentences swapped.
    const said = [
      'And this one is great.',
      'I think that comparison to typing is not the right comparison because everyone today is using.',
      'Whisper, Flow.',
      'Notetakers, like Granola.',
      'So the comparison is not relevant.',
    ].join(' ');
    const words = say(said);
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(words, rest(0.3, 0.7, 0, words.at(-1)?.end ?? 0)),
    );
    assert.equal(one.marks.length, 1);
    assert.ok(one.marks[0].good && one.marks[0].bad, 'the note holds both sides');
    const data = manifest([one], '2026-11-06T10:00:00.000Z');
    const encode = (x: string) => new TextEncoder().encode(x);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const files = new Map<string, Uint8Array>([
      ['pinch-x/notes.json', encode(JSON.stringify(data))],
      [`pinch-x/${data.assets[0].image}`, PNG],
    ]);
    const exp = readExport(files);
    assert.equal(batchNotes(exp)[0].spoken, said);
    const pack = takePackage(exp, files, '2026-11-06T10:00:00.000Z');
    assert.ok(new TextDecoder().decode(pack.files[0].data).includes(said));
    let n = 0;
    const back = assetsOf(exp, files, () => `id${++n}`).assets[0].asset;
    assert.equal(back.marks[0].quote, said, 'opening the export again keeps them');
  });

  it('starts a note for another thing pointed at, and picks up "it" with nothing pointed at', () => {
    const first = say('The header is lovely.');
    const second = say('The footer is too busy.', 2000);
    const pointed = applyTake(
      [asset('one'), asset('two')],
      take([...first, ...second], [...rest(0.5, 0.1, 0, 1800), ...rest(0.5, 0.9, 1900, 4000)]),
    );
    assert.deepEqual(
      voiceNotes(pointed[0]).map((m) => [m.good, m.bad]),
      [
        ['The header is lovely.', ''],
        ['', 'The footer is too busy.'],
      ],
    );
    const [unpointed] = applyTake(
      [asset('one'), asset('two')],
      take(say("The header is calm. It's the best part.")),
    );
    assert.equal(unpointed.marks.length, 1);
    assert.equal(unpointed.marks[0].good, "The header is calm. It's the best part.");
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

  it('names the screens said "remove it" over, and leaves the rest', () => {
    const t = take([
      ...say('This is a duplicate. … Remove this screenshot.'),
      ...say('The list reads well.', 11_000),
    ]);
    assert.deepEqual(removedScreens(t), ['one']);
    assert.deepEqual(removedScreens(take(say('Remove that.'))), []);
    // Said of a thing on the screen, it is a note, and the screen stays (D191).
    const said = take(say('Remove this.'));
    assert.deepEqual(removedScreens(said), []);
    assert.equal(applyTake([asset('one'), asset('two')], said)[0].marks.length, 1);
    assert.equal(applyTake([asset('one'), asset('two')], t).length, 2);
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

describe('voice notes: about the screen (D188)', () => {
  it('knows a remark that points at nothing but the screen', () => {
    assert.ok(aboutTheScreen(say('Delete this slide.')));
    assert.ok(aboutTheScreen(say('I like this page a lot')));
    assert.ok(aboutTheScreen(say('Keep that screen, and this slide too')));
    assert.ok(!aboutTheScreen(say('Delete this.')));
    assert.ok(!aboutTheScreen(say('On this slide this title is too big')));
    assert.ok(!aboutTheScreen(say('The slide is too busy')));
  });
  it('puts it on the whole screen, wherever the hand came to rest after the scroll', () => {
    // The author's review: the hand settles just before the words, and "this" is said in a rest.
    const settled = rest(0.46, 0.54, 800, 4000);
    assert.ok(isWhole(placeClaim(claim('Delete this slide.', 1000), settled, 0, size)));
    assert.ok(isWhole(placeClaim(claim('Delete this slide.', 200), circle(0.7, 0.7, 0.04, 0), 0, size)));
    // What is pointed at still lands where it was pointed.
    assert.equal(placeClaim(claim('Delete this.', 1000), settled, 0, size).kind, 'dot');
  });
});

describe('voice notes: nothing said is lost (D188)', () => {
  const asset = (id: string, marks: Asset['marks'] = []): Asset => ({
    id,
    name: `${id}.png`,
    type: 'image/png',
    width: 1000,
    height: 1000,
    note: '',
    marks,
  });
  const take = (words: TimedWord[], durationMs = 20_000): Take => ({
    id: 'aaaa-bbbb',
    version: 1,
    recordedAt: '2026-11-11T10:00:00.000Z',
    durationMs,
    mimeType: 'audio/webm',
    screens: [
      { id: 'one', name: 'one.png', width: 1000, height: 1000 },
      { id: 'two', name: 'two.png', width: 1000, height: 1000 },
    ],
    shown: [
      { t: 0, screen: 0 },
      { t: 10_000, screen: 1 },
    ],
    pointer: [],
    words,
  });

  it('keeps "Delete this" as a note when the screen has no note to drop', () => {
    const { claims, ops } = heard(say('Delete this'));
    assert.deepEqual(
      claims.map((c) => c.text),
      ['Delete this.'],
    );
    assert.deepEqual(ops, []);
    const [one] = applyTake([asset('one'), asset('two')], take(say('Delete this')));
    assert.deepEqual(
      one.marks.map((m) => m.quote),
      ['Delete this.'],
    );
  });
  it('still drops the last note with it, said after one', () => {
    const { claims, ops } = heard(say('The header is loud. … Drop that.'));
    assert.equal(claims.length, 1);
    assert.deepEqual(
      ops.map((o) => o.kind),
      ['drop'],
    );
    const [one] = applyTake(
      [asset('one'), asset('two')],
      take(say('The header is loud. … Drop that.')),
    );
    assert.equal(one.marks.length, 0);
    // A note from an earlier take is one to drop, too.
    assert.deepEqual(
      heard(say('Drop this'), [], true).ops.map((o) => o.kind),
      ['drop'],
    );
    // "Delete" is said of a thing on the screen, whatever notes there are (D191).
    assert.deepEqual(heard(say('Delete this'), [], true).ops, []);
  });
  it('says what it left out of the notes', () => {
    const { claims, left } = heard(say('Oh, wait. … The header is loud.'));
    assert.equal(claims.length, 1);
    assert.deepEqual(
      left.map((w) => w.text),
      ['Oh,', 'wait.'],
    );
  });
  it('takes a remark about the screen to the package with no close-up to miss', () => {
    const t = take(say('Delete this slide.'));
    const [one] = applyTake([asset('one'), asset('two')], t);
    assert.ok(isWhole(one.marks[0].shape));
    const data = manifest([one], '2026-11-11T10:00:00.000Z');
    const encode = (x: string) => new TextEncoder().encode(x);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const files = new Map<string, Uint8Array>([
      ['pinch-x/notes.json', encode(JSON.stringify(data))],
      [`pinch-x/${data.assets[0].image}`, PNG],
    ]);
    const exp = readExport(files);
    assert.equal(batchNotes(exp)[0].whole, true);
    const pack = takePackage(exp, files, '2026-11-11T10:00:00.000Z', [t]);
    assert.equal(pack.missing, 0);
    const names = pack.files.map((f) => f.name.split('/').slice(1).join('/'));
    assert.ok(names.includes('transcript.md'));
    assert.ok(!names.some((n) => n.startsWith('crops/') || n.startsWith('marked/')));
  });

  it('leaves out a word timed after the recording ended', () => {
    const t = take([...say('The header is loud.'), ...say('Thank you.', 25_000)]);
    assert.equal(wordsIn(t).length, 4);
    const [one, two] = applyTake([asset('one'), asset('two')], t);
    assert.equal(one.marks.length, 1);
    assert.equal(two.marks.length, 0);
  });
  it('keeps a sentence that goes on about "it" in the same breath in the note before', () => {
    // Read piece by piece (D187), Whisper writes three sentences where it wrote one, and the
    // hand has left for somewhere else by the second.
    const words = say("This color should be changed. It's not good. It's clashing with the background.");
    const pointer: PointerSample[] = [
      ...circle(0.5, 0.75, 0.08, 0),
      [900, 0, 0.5, 0.83],
      [1500, 0, 0.06, 0.32],
      [4000, 0, null, null],
    ];
    const [one] = applyTake([asset('one'), asset('two')], { ...take(words), pointer });
    assert.equal(one.marks.length, 1);
    assert.equal(
      one.marks[0].quote,
      "This color should be changed. It's not good. It's clashing with the background.",
    );
    assert.equal(one.marks[0].shape.kind, 'area');
  });
});

describe('voice notes: several spots in one note (D190)', () => {
  /** The pointer going straight from one point to another on screen 0, a sample every 20ms. */
  const go = (x0: number, y0: number, x1: number, y1: number, from: number, steps = 10) =>
    Array.from({ length: steps }, (_, i): PointerSample => {
      const f = (i + 1) / steps;
      return [from + (i + 1) * 20, 0, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    });
  /** Along a line and back, `passes` times, from `from`. */
  function trace(x0: number, y0: number, x1: number, y1: number, from: number, passes: number) {
    const out: PointerSample[] = [[from, 0, x0, y0]];
    for (let p = 0; p < passes; p++) {
      const [a, b] = p % 2 ? [[x1, y1], [x0, y0]] : [[x0, y0], [x1, y1]];
      out.push(...go(a[0], a[1], b[0], b[1], from + p * 400, 20));
    }
    return out;
  }
  const areas = (shapes: ReturnType<typeof placesOfClaim>) =>
    shapes.map((s) => (s.kind === 'area' ? [s.x + s.w / 2, s.y + s.h / 2].map((v) => Number(v.toFixed(1))) : s.kind));

  it('reads every circle in a stroke, not only the first', () => {
    // Round one thing, straight on to the next and round that, without the hand stopping.
    const path = [...circle(0.25, 0.3, 0.06, 0), ...go(0.31, 0.3, 0.76, 0.7, 800), ...circle(0.7, 0.7, 0.06, 1020)];
    const { strokes } = pointerOn(path, 0, 0, 3000, size);
    assert.deepEqual(
      strokes.map((s) => s.kind),
      ['circle', 'circle'],
    );
    assert.ok(strokes[0].to <= strokes[1].from);
  });

  it('reads a line gone along and back as the thin area it kept to, and once along as a hand on its way', () => {
    const { strokes } = pointerOn(trace(0.3, 0.5, 0.6, 0.5, 0, 3), 0, 0, 3000, size);
    assert.deepEqual(
      strokes.map((s) => s.kind),
      ['line'],
    );
    const area = strokes[0].area;
    assert.ok(area && area.w > 0.28 && area.h < 0.05);
    const once = pointerOn(trace(0.3, 0.5, 0.6, 0.5, 0, 1), 0, 0, 3000, size);
    assert.deepEqual(
      once.strokes.map((s) => s.kind),
      ['travel'],
    );
  });

  it('reads two lines that meet at a corner as two, as down one gutter and along the next', () => {
    // The author's "reduce these margins": down the gutter and back, then along the other and back.
    const path = [...trace(0.5, 0.5, 0.5, 0.9, 0, 2), ...trace(0.5, 0.5, 0.7, 0.5, 820, 2).slice(1)];
    const lines = pointerOn(path, 0, 0, 4000, size).strokes.filter((s) => s.kind === 'line');
    assert.equal(lines.length, 2);
    assert.ok((lines[0].area?.h ?? 0) > 0.3 && (lines[1].area?.w ?? 0) > 0.15);
  });

  it('puts a sentence on each thing circled while it was said, in the order circled', () => {
    const path = [...circle(0.25, 0.8, 0.06, 0), ...go(0.31, 0.8, 0.76, 0.8, 800), ...circle(0.7, 0.8, 0.06, 1020)];
    const spots = placesOfClaim(claim('The stroke here and here are not consistent'), path, 0, size);
    assert.deepEqual(areas(spots), [
      [0.3, 0.8],
      [0.7, 0.8],
    ]);
    // The first is still the place a single-place reading gives.
    assert.deepEqual(placeClaim(claim('The stroke here and here are not consistent'), path, 0, size), spots[0]);
  });

  it('puts "this" and "this" on the two places the hand rested, one dot each', () => {
    const pointer = [...rest(0.2, 0.2, 0, 900), ...rest(0.7, 0.7, 1000, 4000)];
    const spots = placesOfClaim(claim('This … and this clash'), pointer, 0, size);
    assert.deepEqual(spots, [
      { kind: 'dot', x: 0.2, y: 0.2 },
      { kind: 'dot', x: 0.7, y: 0.7 },
    ]);
  });

  it('counts a spot once: loops over each other, and a "here" said on what was just circled', () => {
    const twice = [...circle(0.5, 0.5, 0.08, 0), ...circle(0.51, 0.5, 0.05, 820)];
    assert.equal(placesOfClaim(claim('I like this a lot here'), twice, 0, size).length, 1);
  });

  it('leaves out a sweep round most of the screen beside a real spot, and alone takes it for the screen', () => {
    const small = circle(0.2, 0.2, 0.05, 0);
    const wide = circle(0.5, 0.5, 0.45, 1020).map(([t, s, x, y]): PointerSample => [t, s, x, y]);
    const both = placesOfClaim(claim('Add a mark here and move the whole section down a bit'), [...small, ...go(0.25, 0.2, 0.95, 0.5, 800), ...wide], 0, size);
    assert.deepEqual(areas(both), [[0.2, 0.2]]);
    assert.ok(isWhole(placesOfClaim(claim('Move the whole section down a bit'), wide, 0, size)[0]));
  });

  it('does not take a circle whose tail the sentence began in', () => {
    // The circle was made for the sentence before: this one starts as it ends, and points elsewhere.
    const pointer = [...circle(0.2, 0.2, 0.06, 0), ...rest(0.7, 0.7, 1000, 4000)];
    const spots = placesOfClaim(claim('And this is too heavy', 1100), pointer, 0, size);
    assert.deepEqual(spots, [{ kind: 'dot', x: 0.7, y: 0.7 }]);
  });

  const one: Asset = {
    id: 'one',
    name: 'one.png',
    type: 'image/png',
    width: 1000,
    height: 1000,
    note: '',
    marks: [],
  };
  const takeOf = (words: TimedWord[], pointer: PointerSample[]): Take => ({
    id: 'aaaa-bbbb',
    version: 1,
    recordedAt: '2026-11-11T10:00:00.000Z',
    durationMs: 20_000,
    mimeType: 'audio/webm',
    screens: [{ id: 'one', name: 'one.png', width: 1000, height: 1000 }],
    shown: [{ t: 0, screen: 0 }],
    pointer,
    words,
  });

  it('keeps every spot on the note it makes, the first as its place', () => {
    const pointer = [
      ...circle(0.25, 0.8, 0.06, 0),
      ...go(0.31, 0.8, 0.76, 0.8, 800),
      ...circle(0.7, 0.8, 0.06, 1020),
    ];
    const take = takeOf(say('The stroke here and here are not consistent.'), pointer);
    const [made] = applyTake([one], take);
    assert.equal(made.marks.length, 1);
    assert.equal(made.marks[0].shape.kind, 'area');
    assert.deepEqual(
      (made.marks[0].also ?? []).map((s) => s.kind),
      ['area'],
    );
    // Read again, it comes to the same.
    assert.deepEqual(applyTake([made], take)[0].marks, made.marks);
  });

  it('adds a spot pointed at as more is said about the same thing, and counts the first once', () => {
    const words = [
      ...say('The header is loud here.'),
      ...say('Here it is the same … and here', 2400),
    ];
    const pointer = [...rest(0.2, 0.2, 0, 3000), ...rest(0.7, 0.7, 3100, 9000)];
    const [made] = applyTake([one], takeOf(words, pointer));
    assert.equal(made.marks.length, 1);
    assert.deepEqual(made.marks[0].shape, { kind: 'dot', x: 0.2, y: 0.2 });
    assert.deepEqual(made.marks[0].also, [{ kind: 'dot', x: 0.7, y: 0.7 }]);
  });

  it('takes every spot to the export and back, each with its own close-up', () => {
    const pointer = [
      ...circle(0.25, 0.8, 0.06, 0),
      ...go(0.31, 0.8, 0.76, 0.8, 800),
      ...circle(0.7, 0.8, 0.06, 1020),
    ];
    const [made] = applyTake(
      [one],
      takeOf(say('The stroke here and here are not consistent.'), pointer),
    );
    const data = manifest([made], '2026-11-11T10:00:00.000Z');
    const [noted] = data.assets[0].notes;
    assert.equal(noted.crop, 'crops/01-one-note-1.jpg');
    assert.deepEqual(
      noted.also?.map((p) => [p.shape.kind, p.crop]),
      [['area', 'crops/01-one-note-1-2.jpg']],
    );
    const encode = (x: string) => new TextEncoder().encode(x);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const files = new Map<string, Uint8Array>([
      ['pinch-x/notes.json', encode(JSON.stringify(data))],
      [`pinch-x/${data.assets[0].image}`, PNG],
    ]);
    const exp = readExport(files);
    assert.deepEqual(
      batchNotes(exp)[0].also?.map((p) => p.crop),
      ['crops/01-one-note-1-2.jpg'],
    );
    let n = 0;
    const back = assetsOf(exp, files, () => `id${++n}`).assets[0].asset;
    assert.equal(back.marks[0].also?.length, 1);
    assert.equal(back.marks[0].also?.[0].kind, 'area');
  });

  it('leaves a note with one spot as it was before', () => {
    const [made] = applyTake([one], takeOf(say('This is too heavy.'), rest(0.3, 0.7, 0, 3000)));
    assert.equal(made.marks.length, 1);
    assert.ok(!('also' in made.marks[0]));
  });
});

describe('voice notes: what a second real review showed (D191)', () => {
  const go = (x0: number, y0: number, x1: number, y1: number, from: number, steps = 10) =>
    Array.from({ length: steps }, (_, i): PointerSample => {
      const f = (i + 1) / steps;
      return [from + (i + 1) * 20, 0, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    });
  /** A hand wiggling on a spot from `from` for `ms`: never at rest, never far. */
  const wiggle = (x: number, y: number, from: number, ms: number) =>
    Array.from({ length: Math.floor(ms / 20) }, (_, i): PointerSample => [
      from + i * 20,
      0,
      x + 0.012 * Math.sin(i),
      y + 0.012 * Math.cos(i * 1.3),
    ]);
  const one: Asset = {
    id: 'one',
    name: 'one.png',
    type: 'image/png',
    width: 1000,
    height: 1000,
    note: '',
    marks: [],
  };
  const takeOf = (words: TimedWord[], pointer: PointerSample[]): Take => ({
    id: 'aaaa-bbbb',
    version: 1,
    recordedAt: '2026-11-11T15:19:00.000Z',
    durationMs: 30_000,
    mimeType: 'audio/webm',
    screens: [{ id: 'one', name: 'one.png', width: 1000, height: 1000 }],
    shown: [{ t: 0, screen: 0 }],
    pointer,
    words,
  });

  it('keeps a remark that only points, and drops one that never began', () => {
    const texts = (said: string) => claimsOf(say(said)).map((c) => [c.text, c.pointing ?? false]);
    assert.deepEqual(texts('Here and here.'), [['Here and here.', true]]);
    assert.deepEqual(texts('This, this, and this.'), [['This, this, and this.', true]]);
    assert.deepEqual(texts('Here.'), [['Here.', true]]);
    assert.deepEqual(texts('This.'), []);
    assert.deepEqual(texts('This is.'), []);
  });

  it('adds what "Here and here." points at to the note before it', () => {
    const words = [...say('Change to rounded corners.'), ...say('Here and here.', 3000)];
    const pointer = [
      ...circle(0.2, 0.3, 0.05, 0),
      ...rest(0.6, 0.3, 2400, 3250),
      ...rest(0.8, 0.7, 3300, 6000),
    ];
    const [made] = applyTake([one], takeOf(words, pointer));
    assert.equal(made.marks.length, 1);
    assert.equal(made.marks[0].quote, 'Change to rounded corners. Here and here.');
    assert.deepEqual(
      [made.marks[0].shape, ...(made.marks[0].also ?? [])].map((s) => s.kind),
      ['area', 'dot', 'dot'],
    );
  });

  it('does not end a sentence on "to"', () => {
    const words = [...say("Let's try to change the numbers to."), ...say('Bolder font.', 2500)];
    assert.deepEqual(
      claimsOf(words).map((c) => c.text),
      ["Let's try to change the numbers to bolder font."],
    );
  });

  it('gives each claim the time nearer to it than to its neighbours, and no further than three seconds', () => {
    assert.deepEqual(
      reachOf([
        { start: 1000, end: 2000 },
        { start: 4000, end: 5000 },
        { start: 20_000, end: 21_000 },
      ]),
      [
        { from: -2000, to: 3000 },
        { from: 3000, to: 8000 },
        { from: 17_000, to: 24_000 },
      ],
    );
  });

  it('gives a short sentence the things circled after it, and the next sentence the ones before it', () => {
    // "These are too small", then on along the row; then three captions and "This is also too small".
    const first = claim('These are too small', 0);
    const second = claim('This is also too small', 8000);
    const pointer = [
      ...circle(0.1, 0.2, 0.04, 0),
      ...go(0.14, 0.2, 0.5, 0.2, 800),
      ...circle(0.46, 0.2, 0.04, 1020),
      ...go(0.5, 0.2, 0.3, 0.8, 1840),
      ...circle(0.26, 0.8, 0.04, 6200),
      ...go(0.3, 0.8, 0.7, 0.8, 7020),
      ...circle(0.66, 0.8, 0.04, 7240),
    ];
    const reach = reachOf([first, second]);
    assert.equal(placesOfClaim(first, pointer, 0, size, reach[0]).length, 2);
    assert.equal(placesOfClaim(second, pointer, 0, size, reach[1]).length, 2);
    // Without its reach, a claim has only what was drawn while it was said.
    assert.equal(placesOfClaim(first, pointer, 0, size).length, 1);
  });

  it('boxes a scrub by where it went back and forth, not by the way the hand came', () => {
    const scrub: PointerSample[] = [...go(0.9, 0.1, 0.3, 0.6, 0, 20)];
    for (let i = 0; i <= 40; i++) {
      const x = 0.3 + 0.08 * (i % 10 < 5 ? (i % 10) / 5 : (10 - (i % 10)) / 5);
      scrub.push([420 + i * 25, 0, x, 0.6 + 0.004 * Math.sin(i)]);
    }
    const [stroke] = pointerOn(scrub, 0, 0, 3000, size).strokes;
    assert.equal(stroke.kind, 'scrub');
    assert.ok(stroke.area && stroke.area.w < 0.15 && stroke.area.x > 0.25 && stroke.area.y > 0.55);
  });

  it('takes "this" and "here" from a hand wiggling on each, as on a hand at rest', () => {
    const said = claim('Move this to be … here');
    const there = said.words[said.words.length - 1].start;
    const pointer = [
      ...wiggle(0.85, 0.1, 0, 1200),
      ...go(0.85, 0.1, 0.1, 0.45, 1200, 20),
      ...wiggle(0.1, 0.45, 1620, 3000),
    ];
    assert.ok(there > 1900);
    const spots = placesOfClaim(said, pointer, 0, size);
    assert.equal(spots.length, 2);
    const centre = (s: (typeof spots)[number]) =>
      s.kind === 'area' ? [s.x + s.w / 2, s.y + s.h / 2] : s.kind === 'dot' ? [s.x, s.y] : [];
    assert.ok(Math.abs(centre(spots[0])[0] - 0.85) < 0.05 && Math.abs(centre(spots[1])[0] - 0.1) < 0.05);
  });

  it('reads a long line drawn by hand, wobble and all, and not a loop as wide as it is long', () => {
    // Along the row and back a little lower: a divider drawn where there is none.
    const wobbly: PointerSample[] = [[0, 0, 0.2, 0.5], ...go(0.2, 0.5, 0.9, 0.51, 0, 30), ...go(0.9, 0.51, 0.2, 0.53, 620, 30)];
    assert.deepEqual(
      pointerOn(wobbly, 0, 0, 3000, size).strokes.map((s) => s.kind),
      ['line'],
    );
    const loop: PointerSample[] = [[0, 0, 0.2, 0.3], ...go(0.2, 0.3, 0.6, 0.3, 0, 30), ...go(0.6, 0.3, 0.6, 0.7, 620, 30), ...go(0.6, 0.7, 0.2, 0.7, 1240, 30)];
    assert.ok(!pointerOn(loop, 0, 0, 3000, size).strokes.some((s) => s.kind === 'line'));
  });
});
