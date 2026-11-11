/*
 * A take cut at its pauses before it is read (D187). Whisper reads thirty seconds at a time, and
 * over a take that is mostly silence it drops the first word after a pause, bunches the words at a
 * window's edge and fills the quiet with "Thank you.": on the author's review of 336 slides, seven
 * "Delete this slide" came back as "slide.", three never came back, and two notes were invented.
 * So the recording is cut into its stretches of speech and each is read on its own, with nothing
 * carried from the one before, and its words can only be timed inside it.
 *
 * Two ears, because neither does alone. Loudness finds every stretch above the room, in one cheap
 * pass, but a scroll or a click is loud too, and read alone it comes back as "Thank you.". A speech
 * model (Silero) says where the speech is, but it hears a soft start late: cut where it says,
 * "Delete" was lost again. So a piece is the speech Silero heard, begun a little earlier, inside
 * the loud stretch it sits in. Pure: times in milliseconds.
 */

import type { TimedWord } from './voice-tags';

/** Whisper's rate: every recording is read at 16 kHz, one channel. */
export const SPEECH_RATE = 16_000;

/** A stretch of a recording. */
export type Span = { from: number; to: number };

/**
 * A stretch of speech to read on its own: the sound from `from` to `to`, and `onset`, when the
 * speech in it began, which is when its first word was said.
 */
export type Piece = Span & { onset: number };

/** Loudness is measured over this long at a time. */
const FRAME_MS = 20;
/** Louder than the room by this much, in dB, is a sound: a voice, or a scroll. */
const ABOVE_ROOM = 12;
/** Sounds this close together are one stretch, as words in a sentence are. */
const JOIN = 700;
/** A sound shorter than this is a click. */
const SHORTEST = 200;

/** Silero's answer is speech above this, and still speech until it falls below the lower one. */
const SPEECH = 0.5;
const STILL_SPEECH = 0.35;
/** Speech shorter than this is a cough; a dip shorter than this is inside a word. */
const SHORTEST_SPEECH = 250;
const SHORTEST_DIP = 100;

/** How much earlier than Silero heard it a piece's sound starts, and how much later it ends. */
const LEAD = 600;
const TAIL = 400;
/** Silero hears a soft start about this late: the speech began this much before it said so. */
const HEARD_LATE = 200;
/** Whisper reads thirty seconds at a time: a longer piece is cut where it is quietest. */
const LONGEST = 28_000;
/** Quiet kept either side of a piece's sound, as Whisper reads a clip best that starts in quiet. */
export const PIECE_PAD = 250;

/** How loud each 20 ms of a recording is, in dB. */
export function loudnessOf(samples: Float32Array, rate = SPEECH_RATE): Float32Array {
  const size = Math.round((rate * FRAME_MS) / 1000);
  const out = new Float32Array(Math.floor(samples.length / size));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    for (let i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
    out[f] = 10 * Math.log10(Math.max(sum / size, 1e-14));
  }
  return out;
}

/** The room's own level: what the quietest fifth of the recording stays under. */
function roomOf(db: Float32Array): number {
  if (!db.length) return 0;
  const sorted = Float32Array.from(db).sort();
  return sorted[Math.floor(sorted.length * 0.2)];
}

/** The stretches louder than the room: where anything was said, and where anything else was. */
export function loudRuns(db: Float32Array): Span[] {
  const over = roomOf(db) + ABOVE_ROOM;
  const runs: Span[] = [];
  for (let f = 0; f < db.length; f++) {
    if (db[f] <= over) continue;
    const from = f * FRAME_MS;
    while (f + 1 < db.length && db[f + 1] > over) f++;
    const to = (f + 1) * FRAME_MS;
    const last = runs.at(-1);
    if (last && from - last.to <= JOIN) last.to = to;
    else runs.push({ from, to });
  }
  return runs.filter((r) => r.to - r.from >= SHORTEST);
}

/**
 * Where Silero heard speech, from its answer for each window it listened to: `from` is when the
 * first window began and `step` how long each is. Speech starts above `SPEECH` and goes on until
 * the answer has stayed under `STILL_SPEECH` for longer than a dip inside a word.
 */
export function speechIn(answers: ArrayLike<number>, from: number, step: number): Span[] {
  const out: Span[] = [];
  let start: number | null = null;
  let quietSince: number | null = null;
  const close = (end: number) => {
    if (start !== null && end - start >= SHORTEST_SPEECH) out.push({ from: start, to: end });
    start = null;
    quietSince = null;
  };
  for (let i = 0; i < answers.length; i++) {
    const t = from + i * step;
    if (answers[i] >= SPEECH) {
      start ??= t;
      quietSince = null;
    } else if (start !== null && answers[i] < STILL_SPEECH) {
      quietSince ??= t;
      if (t + step - quietSince >= SHORTEST_DIP) close(quietSince);
    }
  }
  close(quietSince ?? from + answers.length * step);
  return out;
}

/**
 * The pieces to read: each loud stretch that holds speech, from a little before the first speech
 * in it to a little after the last, so a scroll before the words or a click after them is left
 * out. Speech Silero heard where nothing was loud is a piece too. A piece longer than Whisper
 * reads at once is cut where it is quietest.
 */
export function piecesOf(
  runs: readonly Span[],
  speech: readonly Span[],
  db: Float32Array,
): Piece[] {
  const pieces: Piece[] = [];
  const used = new Set<Span>();
  for (const run of runs) {
    const inside = speech.filter((s) => s.to > run.from && s.from < run.to);
    if (!inside.length) continue;
    for (const s of inside) used.add(s);
    const first = Math.min(...inside.map((s) => s.from));
    const last = Math.max(...inside.map((s) => s.to));
    pieces.push({
      from: Math.max(run.from, first - LEAD),
      to: Math.max(Math.min(run.to, last + TAIL), last),
      onset: Math.max(run.from, first - HEARD_LATE),
    });
  }
  for (const s of speech)
    if (!used.has(s))
      pieces.push({ from: Math.max(0, s.from - LEAD), to: s.to + TAIL, onset: s.from });
  pieces.sort((a, b) => a.from - b.from);

  const out: Piece[] = [];
  for (const piece of pieces) {
    let rest = piece;
    while (rest.to - rest.from > LONGEST) {
      // The quietest frame in the second half of what Whisper can read at once.
      let at = Math.floor((rest.from + LONGEST / 2) / FRAME_MS);
      const end = Math.min(db.length - 1, Math.floor((rest.from + LONGEST) / FRAME_MS));
      for (let f = at; f <= end; f++) if (db[f] < db[at]) at = f;
      const cut = Math.min(Math.max(at * FRAME_MS, rest.from + LONGEST / 2), rest.from + LONGEST);
      out.push({ from: rest.from, to: cut, onset: rest.onset });
      rest = { from: cut, to: rest.to, onset: cut };
    }
    out.push(rest);
  }
  return out;
}

/** The sound to hand Whisper for a piece: the piece with quiet either side, within the recording. */
export const soundOf = (piece: Span, durationMs: number): Span => ({
  from: Math.max(0, piece.from - PIECE_PAD),
  to: Math.min(durationMs, piece.to + PIECE_PAD),
});

/** One piece as it was read: its words, timed from the start of the sound Whisper was handed. */
export type PieceWords = { piece: Piece; soundFrom: number; words: readonly TimedWord[] };

/** A pause this long between two pieces and the thought has moved on, whatever comes next. */
const LOST_THREAD = 6000;

/**
 * A piece's words in the recording's time. No word was said before the piece's sound began or
 * after it ended, so each is brought inside, and they stay in the order they were read. The first
 * word began no later than the speech did, whatever time Whisper gave it: it is what a piece is
 * filed by. A mark with no letter in it ("...") is not a word.
 */
export function wordsOfPiece({ piece, soundFrom, words }: PieceWords): TimedWord[] {
  const out: TimedWord[] = [];
  for (const word of words) {
    if (!/[\p{L}\p{N}]/u.test(word.text)) continue;
    const said = word.start + soundFrom;
    const start = out.length
      ? Math.min(Math.max(said, out[out.length - 1].start), piece.to)
      : Math.max(piece.from, Math.min(said, piece.onset));
    const end = Math.max(start + 1, Math.min(word.end + soundFrom, piece.to + TAIL));
    out.push({ text: word.text, start, end });
  }
  return out;
}

/**
 * The words of a take read piece by piece. Whisper ends every clip with a full stop, so a piece
 * that stopped at a pause in mid-sentence reads as a sentence: "Add avatars." then "here." then
 * "for each statement". Where the next piece goes on in lower case, as a sentence does (D162),
 * and soon enough to be the same thought, that full stop was the clip's and goes.
 */
export function wordsOfPieces(read: readonly PieceWords[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const one of read) {
    const words = wordsOfPiece(one);
    const last = out.at(-1);
    const next = words[0];
    if (
      last &&
      next &&
      next.start - last.end < LOST_THREAD &&
      /^[^\p{L}\p{N}]*\p{Ll}/u.test(next.text) &&
      /[^.]\.$/.test(last.text)
    )
      out[out.length - 1] = { ...last, text: last.text.slice(0, -1) };
    out.push(...words);
  }
  return out;
}
