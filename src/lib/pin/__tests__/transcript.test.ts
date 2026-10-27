import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Shown } from '../narration';
import { opLabel, spoken, wordsByScreen, wordsFromChunks, wordsFromWhisper } from '../transcript';
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
    const words = [word('one', 100), word('two', 999), word('three', 1000), word('four', 2500)];
    assert.deepEqual(
      wordsByScreen(shown, words, 2).map((s) => spoken(s)),
      ['one two', 'three four'],
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
