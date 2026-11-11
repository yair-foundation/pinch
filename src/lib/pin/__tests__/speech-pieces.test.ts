import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loudnessOf,
  loudRuns,
  piecesOf,
  SPEECH_RATE,
  soundOf,
  speechIn,
  wordsOfPiece,
  wordsOfPieces,
} from '../speech-pieces';

/** A recording of quiet with a tone over each span given, in milliseconds. */
function recording(durationMs: number, loud: [number, number][]): Float32Array {
  const samples = new Float32Array((durationMs * SPEECH_RATE) / 1000);
  for (let i = 0; i < samples.length; i++) {
    const t = (i * 1000) / SPEECH_RATE;
    const on = loud.some(([a, b]) => t >= a && t < b);
    samples[i] = (on ? 0.2 : 0.001) * Math.sin(i / 3);
  }
  return samples;
}

/** Silero's answers, one each 32 ms from 0: speech over each span given. */
const answers = (durationMs: number, speech: [number, number][]) =>
  Array.from({ length: Math.ceil(durationMs / 32) }, (_, i) =>
    speech.some(([a, b]) => i * 32 >= a && i * 32 < b) ? 0.9 : 0.02,
  );

describe('speech pieces: what is loud', () => {
  it('finds each stretch above the room', () => {
    const db = loudnessOf(
      recording(10_000, [
        [2000, 3000],
        [6000, 7500],
      ]),
    );
    assert.deepEqual(loudRuns(db), [
      { from: 2000, to: 3000 },
      { from: 6000, to: 7500 },
    ]);
  });
  it('joins sounds a short pause apart, and keeps a long pause between two', () => {
    const db = loudnessOf(
      recording(10_000, [
        [1000, 1500],
        [2000, 2600],
        [4000, 4500],
      ]),
    );
    assert.deepEqual(loudRuns(db), [
      { from: 1000, to: 2600 },
      { from: 4000, to: 4500 },
    ]);
  });
  it('leaves out a click', () => {
    const db = loudnessOf(
      recording(10_000, [
        [1000, 1100],
        [5000, 6000],
      ]),
    );
    assert.deepEqual(loudRuns(db), [{ from: 5000, to: 6000 }]);
  });
  it('finds nothing in a silent recording', () => {
    assert.deepEqual(loudRuns(loudnessOf(recording(5000, []))), []);
    assert.deepEqual(loudRuns(loudnessOf(new Float32Array(0))), []);
  });
});

describe('speech pieces: what Silero heard', () => {
  it('turns its answers into stretches of speech', () => {
    const heard = speechIn(answers(5000, [[992, 2016]]), 0, 32);
    assert.deepEqual(heard, [{ from: 992, to: 2016 }]);
  });
  it('starts from where it began to listen', () => {
    const heard = speechIn(answers(2000, [[320, 960]]), 10_000, 32);
    assert.deepEqual(heard, [{ from: 10_320, to: 10_960 }]);
  });
  it('keeps a word whole over a short dip, and leaves out a cough', () => {
    const dip = answers(3000, [
      [320, 960],
      [1024, 1600],
    ]);
    assert.deepEqual(speechIn(dip, 0, 32), [{ from: 320, to: 1600 }]);
    assert.deepEqual(speechIn(answers(3000, [[320, 448]]), 0, 32), []);
  });
  it('ends speech that runs to the end of what it heard', () => {
    assert.deepEqual(speechIn([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9], 0, 32), [
      { from: 0, to: 320 },
    ]);
  });
});

describe('speech pieces: what to read', () => {
  const db = loudnessOf(recording(60_000, []));
  it('reads a loud stretch that holds speech, and not one that holds none', () => {
    const runs = [
      { from: 1000, to: 2500 },
      { from: 5000, to: 5600 },
    ];
    const pieces = piecesOf(runs, [{ from: 1200, to: 2400 }], db);
    assert.deepEqual(pieces, [{ from: 1000, to: 2500, onset: 1000 }]);
  });
  it('leaves a scroll before the words and a click after them out of the piece', () => {
    // On the author's take: 2.6 s of scrolling, then "Delete this slide", then more noise.
    const pieces = piecesOf([{ from: 10_000, to: 18_000 }], [{ from: 12_600, to: 13_800 }], db);
    assert.deepEqual(pieces, [{ from: 12_000, to: 14_200, onset: 12_400 }]);
  });
  it('starts a piece before Silero heard it, as it hears a soft start late', () => {
    const [piece] = piecesOf([{ from: 4900, to: 6300 }], [{ from: 5200, to: 6250 }], db);
    assert.equal(piece.from, 4900);
    assert.equal(piece.onset, 5000);
  });
  it('makes one piece of two stretches of speech in one loud stretch', () => {
    const speech = [
      { from: 1100, to: 1900 },
      { from: 2300, to: 3000 },
    ];
    const pieces = piecesOf([{ from: 1000, to: 3100 }], speech, db);
    assert.deepEqual(pieces, [{ from: 1000, to: 3100, onset: 1000 }]);
  });
  it('reads speech that was heard where nothing was loud', () => {
    const pieces = piecesOf([], [{ from: 3000, to: 4000 }], db);
    assert.deepEqual(pieces, [{ from: 2400, to: 4400, onset: 3000 }]);
  });
  it('cuts a piece longer than Whisper reads at once, where it is quietest', () => {
    const samples = recording(60_000, [
      [0, 20_000],
      [20_400, 60_000],
    ]);
    const pieces = piecesOf(
      [{ from: 0, to: 60_000 }],
      [{ from: 0, to: 60_000 }],
      loudnessOf(samples),
    );
    assert.ok(pieces.length >= 2);
    assert.ok(pieces.every((p) => p.to - p.from <= 28_000));
    assert.ok(pieces[0].to >= 20_000 && pieces[0].to <= 20_400);
    assert.equal(pieces[1].from, pieces[0].to);
    assert.equal(pieces.at(-1)?.to, 60_000);
  });
  it('hands Whisper the piece with quiet either side, inside the recording', () => {
    assert.deepEqual(soundOf({ from: 100, to: 2000 }, 2100), { from: 0, to: 2100 });
    assert.deepEqual(soundOf({ from: 5000, to: 6000 }, 60_000), { from: 4750, to: 6250 });
  });
});

describe('speech pieces: the words of a piece', () => {
  const piece = { from: 12_000, to: 14_200, onset: 12_400 };
  const read = (words: { text: string; start: number; end: number }[]) =>
    wordsOfPiece({ piece, soundFrom: 11_750, words });
  it('times them in the recording, the first from when the speech began', () => {
    // Whisper timed "Delete" 1.1 s into the clip; the speech began 0.65 s into it.
    const words = [
      { text: 'Delete', start: 1100, end: 1400 },
      { text: 'this', start: 1400, end: 1700 },
      { text: 'slide.', start: 1700, end: 2100 },
    ];
    assert.deepEqual(read(words), [
      { text: 'Delete', start: 12_400, end: 13_150 },
      { text: 'this', start: 13_150, end: 13_450 },
      { text: 'slide.', start: 13_450, end: 13_850 },
    ]);
  });
  it('keeps a first word Whisper heard before Silero did, inside the piece', () => {
    // A soft "I think" before the speech Silero heard: the words keep their own times.
    const out = read([
      { text: 'I', start: 400, end: 520 },
      { text: 'think', start: 520, end: 800 },
      { text: 'so.', start: 800, end: 1100 },
    ]);
    assert.deepEqual(out[0], { text: 'I', start: 12_150, end: 12_270 });
    assert.deepEqual(out[1], { text: 'think', start: 12_270, end: 12_550 });
    assert.equal(read([{ text: 'Early', start: 0, end: 100 }])[0].start, 12_000);
  });
  it('brings in a word timed after the piece ended', () => {
    const out = read([
      { text: 'Thank', start: 700, end: 1000 },
      { text: 'you.', start: 9000, end: 9400 },
    ]);
    assert.deepEqual(out[1], { text: 'you.', start: 14_200, end: 14_600 });
  });
  it('keeps the words in the order they were read', () => {
    const out = read([
      { text: 'one', start: 700, end: 900 },
      { text: 'two', start: 1500, end: 1700 },
      { text: 'three', start: 1200, end: 1400 },
    ]);
    assert.deepEqual(
      out.map((w) => w.text),
      ['one', 'two', 'three'],
    );
    assert.ok(out[2].start >= out[1].start);
    assert.ok(out.every((w) => w.end > w.start));
  });
  it('leaves out a mark that is not a word, and a piece that read as nothing', () => {
    const out = read([
      { text: 'have', start: 700, end: 900 },
      { text: '...', start: 900, end: 1300 },
    ]);
    assert.deepEqual(
      out.map((w) => w.text),
      ['have'],
    );
    assert.deepEqual(read([]), []);
  });
});

describe('speech pieces: the words of a take', () => {
  const at = (from: number) => ({ from, to: from + 1000, onset: from });
  const one = (from: number, ...texts: string[]) => ({
    piece: at(from),
    soundFrom: from,
    words: texts.map((text, i) => ({ text, start: i * 300, end: i * 300 + 250 })),
  });
  const said = (read: ReturnType<typeof one>[]) =>
    wordsOfPieces(read)
      .map((w) => w.text)
      .join(' ');
  it('takes out the full stop of a piece the next one goes on from', () => {
    // On the author's take, one sentence said with pauses to point.
    const read = [
      one(0, 'Add', 'avatars.'),
      one(1800, 'here.'),
      one(3500, 'for', 'each', 'statement.'),
    ];
    assert.equal(said(read), 'Add avatars here for each statement.');
  });
  it('keeps the full stop before a new sentence, and after a long pause', () => {
    assert.equal(
      said([one(0, 'Delete', 'this', 'slide.'), one(2000, 'Delete', 'this', 'slide.')]),
      'Delete this slide. Delete this slide.',
    );
    assert.equal(
      said([one(0, 'Looks', 'fine.'), one(9000, 'and', 'this?')]),
      'Looks fine. and this?',
    );
  });
  it('keeps a question mark and an ellipsis', () => {
    assert.equal(
      said([one(0, 'You', 'know', 'what?'), one(1500, 'keep', 'it.')]),
      'You know what? keep it.',
    );
    assert.equal(said([one(0, 'Well...'), one(1500, 'maybe.')]), 'Well... maybe.');
  });
});
