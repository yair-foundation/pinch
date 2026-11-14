import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Shown } from '../narration';
import {
  opLabel,
  spoken,
  withoutLooseHyphens,
  wordsByScreen,
  wordsFromChunks,
  wordsFromWhisper,
  wordsLookWrong,
} from '../transcript';
import type { TimedWord } from '../voice-tags';

const segment = (text: string, from: number, to: number) => ({
  timestamps: { from: '', to: '' },
  offsets: { from, to },
  text,
});

describe('transcript: whisper.cpp', () => {
  it('reads one word per segment, trimmed, in milliseconds', () => {
    const json = {
      transcription: [
        segment(' Tag', 0, 320),
        segment(' this', 320, 500),
        segment(' as', 500, 610),
      ],
    };
    assert.deepEqual(wordsFromWhisper(json), [
      { text: 'Tag', start: 0, end: 320 },
      { text: 'this', start: 320, end: 500 },
      { text: 'as', start: 500, end: 610 },
    ]);
  });
  it('drops what is not speech, and empty or untimed segments', () => {
    const json = {
      transcription: [
        segment(' [BLANK_AUDIO]', 0, 900),
        segment(' (music)', 900, 1200),
        segment(' ', 1200, 1300),
        { text: ' lost' },
        segment(' kept.', 1300, 1600),
      ],
    };
    assert.deepEqual(wordsFromWhisper(json), [{ text: 'kept.', start: 1300, end: 1600 }]);
  });
  it('reads nothing from something else', () => {
    assert.deepEqual(wordsFromWhisper(null), []);
    assert.deepEqual(wordsFromWhisper({ transcription: 'no' }), []);
  });
});

describe('transcript: words stretched over a pause', () => {
  it('pulls them back to when they were said, so the pause shows', () => {
    const words = wordsFromWhisper({
      transcription: [
        segment(' This', 14000, 14400),
        segment(' is', 14400, 14600),
        segment(' ours.', 14600, 20500),
        segment(" I'm", 20500, 29200),
        segment(' missing', 29200, 29600),
        segment(' button', 29600, 43500),
        segment(' The', 43500, 45200),
        segment(' icons', 45200, 45600),
      ],
    });
    assert.deepEqual(
      words.map((w) => [w.text, w.start, w.end]),
      [
        ['This', 14000, 14400],
        ['is', 14400, 14600],
        ['ours.', 14600, 15000],
        ["I'm", 28800, 29200],
        ['missing', 29200, 29600],
        ['button', 29600, 30000],
        ['The', 44800, 45200],
        ['icons', 45200, 45600],
      ],
    );
  });
  it('takes a stretched first word as opening, and leaves a slow word alone', () => {
    const words = wordsFromChunks([
      { text: " I'm", timestamp: [1, 25.04] },
      { text: ' using', timestamp: [25.04, 26.3] },
    ]);
    assert.deepEqual(
      words.map((w) => [w.text, w.start, w.end]),
      [
        ["I'm", 24640, 25040],
        ['using', 25040, 26300],
      ],
    );
  });
  it('opens a sentence after a full stop, though the word before it is short', () => {
    const words = wordsFromWhisper({
      transcription: [segment(' it.', 63900, 64200), segment(' I', 64200, 78000)],
    });
    assert.deepEqual(words[1], { text: 'I', start: 77600, end: 78000 });
  });
});

describe('transcript: the browser', () => {
  it('reads its word chunks, in seconds, as timed words in milliseconds', () => {
    assert.deepEqual(
      wordsFromChunks([
        { text: ' Remove', timestamp: [1.2, 1.5] },
        { text: ' it.', timestamp: [1.5, null] },
      ]),
      [
        { text: 'Remove', start: 1200, end: 1500 },
        { text: 'it.', start: 1500, end: 1800 },
      ],
    );
  });
  it('drops what is not speech, and words with no start', () => {
    assert.deepEqual(
      wordsFromChunks([
        { text: ' [BLANK_AUDIO]', timestamp: [0, 2] },
        { text: ' lost', timestamp: [null, 2] },
      ]),
      [],
    );
    assert.deepEqual(wordsFromChunks(undefined), []);
  });
  it('drops the words of a chunk that repeat the overlap with the chunk before it', () => {
    const words = wordsFromChunks([
      { text: ' Lots', timestamp: [25, 25.3] },
      { text: ' of', timestamp: [25.3, 25.5] },
      { text: ' space,', timestamp: [25.5, 26] },
      { text: ' Lots', timestamp: [25.02, 25.28] },
      { text: ' of', timestamp: [25.32, 25.48] },
      { text: ' space', timestamp: [25.52, 25.9] },
      { text: ' between', timestamp: [26, 26.4] },
    ]);
    assert.equal(spoken(words), 'Lots of space, between');
  });
  it('keeps a word said twice, and two different words said over one moment', () => {
    const said = [
      { text: ' very,', timestamp: [1, 1.3] },
      { text: ' very', timestamp: [1.3, 1.6] },
      { text: ' nice', timestamp: [1.6, 2] },
      { text: ' mice', timestamp: [1.7, 2] },
    ] as { text: string; timestamp: [number, number] }[];
    assert.equal(spoken(wordsFromChunks(said)), 'very, very nice mice');
  });
});

describe('transcript: a hyphen given to the next word (D192)', () => {
  it('joins it to the word before, on reading and for a take read earlier', () => {
    const words = wordsFromChunks([
      { text: ' This', timestamp: [1, 1.2] },
      { text: ' is', timestamp: [1.2, 1.4] },
      { text: ' off', timestamp: [1.4, 1.7] },
      { text: ' -brand.', timestamp: [1.7, 2.1] },
    ]);
    assert.equal(spoken(words), 'This is off-brand.');
    assert.deepEqual(words.at(-1), { text: 'off-brand.', start: 1400, end: 2100 });
    const kept: TimedWord[] = [
      { text: 'copy', start: 0, end: 300 },
      { text: '-paste', start: 300, end: 700 },
      { text: '-', start: 800, end: 900 },
      { text: 'fine', start: 900, end: 1200 },
    ];
    assert.equal(spoken(withoutLooseHyphens(kept)), 'copy-paste - fine');
  });
});

describe('transcript: words that look invented', () => {
  const said = (text: string): TimedWord[] =>
    text.split(' ').map((w, i) => ({ text: w, start: i * 300, end: i * 300 + 250 }));

  it('flags a phrase on a loop, as a real take came out over its pauses', () => {
    for (const text of [
      "I can't wait to see the one I can't wait to see the one. I can't wait to see the one.",
      "I'm not going to get it. I'm not going to get it. I'm not going to get it.",
      'What the... What the... What the... What the...',
      'oh, oh, oh, oh, oh,',
    ])
      assert.equal(wordsLookWrong(said(text)), true, text);
  });

  it('leaves what people say, a word said twice and a doubled reading among them', () => {
    for (const text of [
      'This is a very, very nice interface.',
      'It It looks looks very very good, good, very very intense.',
      'Lots Lots of of space space between between the the bullets.',
      'Good separation with this divider and this divider.',
      'No, no, no, not like this.',
      'Very good typography. Very good layout. Very good spacing.',
    ])
      assert.equal(wordsLookWrong(said(text)), false, text);
    assert.equal(wordsLookWrong([]), false);
  });

  it('leaves a phrase said again after a pause or a turn (D199)', () => {
    // "Delete this slide." over three slides in a row, with a pause before each.
    const again = (phrase: string, times: number, gap: number): TimedWord[] =>
      Array.from({ length: times }).flatMap((_, k) =>
        phrase.split(' ').map((w, i) => {
          const start = k * (phrase.split(' ').length * 300 + gap) + i * 300;
          return { text: w, start, end: start + 250 };
        }),
      );
    assert.equal(wordsLookWrong(again('Delete this slide.', 3, 2000)), false);
    assert.equal(wordsLookWrong(again('Okay.', 6, 1600)), false);
    // Said quickly on each screen, the reel turning between them.
    const quick = again('Delete this slide.', 3, 400);
    assert.equal(wordsLookWrong(quick), true);
    assert.equal(wordsLookWrong(quick, [1100, 2400]), false);
  });
});

describe('transcript: by screen', () => {
  const word = (text: string, start: number): TimedWord => ({ text, start, end: start + 200 });
  const shown: Shown[] = [
    { t: 0, screen: 0 },
    { t: 1000, screen: 1 },
    { t: 1500, screen: 1, click: [0.5, 0.5] },
    { t: 2000, screen: 1, paused: true },
    { t: 3000, screen: null },
  ];
  it('gives each word to the screen on show when it began', () => {
    const words = [word('one', 100), word('two.', 999), word('three', 1000), word('four', 2500)];
    assert.deepEqual(
      wordsByScreen(shown, words, 2).map((s) => spoken(s)),
      ['one two.', 'three four'],
    );
  });
  it('keeps a sentence still being said as the reel turns on the screen it began on (D186)', () => {
    const words = [word('This', 600), word('is', 850), word('okay.', 1100), word('Next', 2500)];
    assert.deepEqual(
      wordsByScreen(shown, words, 2).map((s) => spoken(s)),
      ['This is okay.', 'Next'],
    );
  });
  it('gives words on the end card to the last screen', () => {
    assert.deepEqual(
      wordsByScreen(shown, [word('done', 3200)], 2).map((s) => spoken(s)),
      ['', 'done'],
    );
  });
  it('starts on the first screen when nothing was shown', () => {
    assert.deepEqual(
      wordsByScreen([], [word('hi', 0)], 3).map((s) => s.length),
      [1, 0, 0],
    );
  });
});

describe('transcript: labels', () => {
  it('names each voice tag briefly', () => {
    assert.equal(opLabel({ kind: 'tag', tag: 'Checkout', start: 0, end: 1 }), 'Tag Checkout');
    assert.equal(opLabel({ kind: 'star', note: 2, start: 0, end: 1 }), 'Star note 2');
    assert.equal(opLabel({ kind: 'drop', note: 'last', start: 0, end: 1 }), 'Drop');
    assert.equal(
      opLabel({ kind: 'topics', topics: ['copy', 'layout'], start: 0, end: 1 }),
      'About copy, layout',
    );
  });
});
