/*
 * What was said in a take (D131, D136, D140): whisper.cpp's output, or the browser's Whisper words,
 * read into timed words, the words
 * split by the screen on show when each was said, and the voice tags heard, as short labels.
 */

import type { Shown } from './narration';
import { SENTENCE_PAUSE, type TimedWord, type VoiceOp } from './voice-tags';

/** One segment of whisper.cpp's JSON (`-oj`); with `-ml 1 -sow` each is one word. */
type WhisperSegment = { offsets?: { from?: number; to?: number }; text?: string };

/** Sounds whisper writes in brackets instead of words: "[BLANK_AUDIO]", "(music)". */
const NOT_SPEECH = /^[[(*].*[\])*]$/;

/** Longer than anyone says a word: the rest of it is a pause. */
const LONGEST_WORD = 1500;
const USUAL_WORD = 400;

/**
 * Whisper stretches the words either side of a pause across it (D159): "button" ends as the next
 * sentence starts, and that sentence's first word starts as "button" ends. Pulled back, a note's
 * words are when they were said, so the pause shows and the pointer is read at the right moment.
 * A long word that comes first, or after a long word or a full stop, opens a sentence, so its end
 * is right; any other closes one, so its start is right.
 */
function withoutStretch(words: readonly TimedWord[]): TimedWord[] {
  const long = (w: TimedWord) => w.end - w.start > LONGEST_WORD;
  return words.map((word, i) => {
    if (!long(word)) return word;
    const before = words[i - 1];
    const opens = !before || long(before) || /[.?!]$/.test(before.text);
    return opens
      ? { ...word, start: word.end - USUAL_WORD }
      : { ...word, end: word.start + USUAL_WORD };
  });
}

/** whisper.cpp's JSON, word per segment, as timed words in milliseconds. */
export function wordsFromWhisper(json: unknown): TimedWord[] {
  const segments = (json as { transcription?: WhisperSegment[] } | null)?.transcription;
  if (!Array.isArray(segments)) return [];
  const words: TimedWord[] = [];
  for (const s of segments) {
    const text = (s.text ?? '').trim();
    const start = s.offsets?.from;
    const end = s.offsets?.to;
    if (!text || NOT_SPEECH.test(text) || typeof start !== 'number' || typeof end !== 'number')
      continue;
    words.push({ text, start, end: Math.max(start, end) });
  }
  return withoutStretch(words);
}

/**
 * The browser's Whisper gives a hyphen to the word after it (D192): "off" then "-brand", which
 * read "off -brand" 58 times in one review. A word that begins with a hyphen and a letter is the
 * rest of the word before it. It is done where a take's words are read as well, so one kept
 * before this reads right.
 */
export function withoutLooseHyphens(words: readonly TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const word of words) {
    const last = out[out.length - 1];
    if (last && /^-\p{L}/u.test(word.text) && /[\p{L}\p{N}]$/u.test(last.text))
      out[out.length - 1] = { ...last, text: last.text + word.text, end: word.end };
    else out.push(word);
  }
  return out;
}

/** A word as transformers.js gives it in the browser (D140): its text and its times in seconds. */
type BrowserChunk = { text?: string; timestamp?: [number | null, number | null] };

/** The browser's Whisper words (`return_timestamps: 'word'`) as timed words in milliseconds. */
export function wordsFromChunks(chunks: readonly BrowserChunk[] | undefined): TimedWord[] {
  const words: TimedWord[] = [];
  for (const c of chunks ?? []) {
    const text = (c.text ?? '').trim();
    const [from, to] = c.timestamp ?? [null, null];
    if (!text || NOT_SPEECH.test(text) || typeof from !== 'number') continue;
    const start = Math.round(from * 1000);
    // The last word of a recording can come with no end: give it a short one.
    const end = typeof to === 'number' ? Math.max(start, Math.round(to * 1000)) : start + 300;
    words.push({ text, start, end });
  }
  return withoutLooseHyphens(withoutRepeats(withoutStretch(words)));
}

/** A word to compare: "Good," and "good" are one word. */
const bareWord = (text: string) => text.toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * Whisper reads long audio in overlapping chunks, and where two chunks read the overlap differently
 * both can come back (D157): in time order, "Lots Lots of of space space". A word said over the
 * same moment as the word before it is that word again. One said after it, "very, very", was said.
 */
function withoutRepeats(words: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && word.start < last.end && bareWord(word.text) === bareWord(last.text)) continue;
    out.push(word);
  }
  return out;
}

/** A pause this long between two words: what comes after was said again, not looped (D199). */
const LOOP_GAP = 1500;

/**
 * Whether a take's words look invented (D159): over a long silence Whisper can repeat a phrase on a
 * loop, "I'm not going to get it" thirteen times over. A phrase of up to eight words said three times
 * running, or a shorter one more, is that; a person says "very, very" or "no, no, no". A loop runs
 * on without a break, so a pause of 1.5 seconds or a turn of the reel (`turns`, in take time) ends
 * the run (D199): "Delete this slide" said over three slides in a row was said three times.
 */
export function wordsLookWrong(
  words: readonly TimedWord[],
  turns: readonly number[] = [],
): boolean {
  const kept = [...words]
    .sort((a, b) => a.start - b.start)
    .map((w) => ({ bare: bareWord(w.text), start: w.start, end: w.end }))
    .filter((w) => w.bare);
  // Whether a pause or a turn falls between two words, so the run of repeats starts again.
  const broken = (a: (typeof kept)[number], b: (typeof kept)[number]) =>
    b.start - a.end >= LOOP_GAP || turns.some((t) => t > a.start && t <= b.start);
  for (let phrase = 1; phrase <= 8; phrase++) {
    const times = phrase === 1 ? 5 : phrase === 2 ? 4 : 3;
    let same = 0;
    for (let i = phrase; i < kept.length; i++) {
      if (broken(kept[i - 1], kept[i])) {
        same = 0;
        continue;
      }
      same = kept[i].bare === kept[i - phrase].bare ? same + 1 : 0;
      if (same >= phrase * (times - 1)) return true;
    }
  }
  return false;
}

/**
 * The words said over each screen: a word belongs to the screen on show when it began, and a
 * sentence still being said as the reel turns stays on the screen it began on (D186: "This is",
 * a turn, "okay" lost its verdict to the next screen, where "okay" alone was dropped). Words
 * said on the end card (`screen: null`) go to the last screen, as they're about the batch so far.
 */
export function wordsByScreen(
  shown: readonly Shown[],
  words: readonly TimedWord[],
  screens: number,
): TimedWord[][] {
  const out: TimedWord[][] = Array.from({ length: screens }, () => []);
  if (!screens) return out;
  const marks = [...shown].sort((a, b) => a.t - b.t);
  let i = 0;
  let screen: number | null = marks[0]?.screen ?? 0;
  let prev: { word: TimedWord; at: number } | null = null;
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    while (i < marks.length && marks[i].t <= word.start) screen = marks[i++].screen;
    const midSentence =
      prev !== null &&
      word.start - prev.word.end < SENTENCE_PAUSE &&
      !/[.?!]["'”’)]*$/.test(prev.word.text);
    const at: number =
      midSentence && prev ? prev.at : Math.min(screen ?? screens - 1, screens - 1);
    out[at].push(word);
    prev = { word, at };
  }
  return out;
}

/** The words as text, as they were said. */
export const spoken = (words: readonly TimedWord[]) => words.map((w) => w.text).join(' ');

const nth = (note?: number | 'last') =>
  note === undefined || note === 'last' ? '' : ` note ${note}`;

/** A voice tag heard, as a short label for the reel. */
export function opLabel(op: VoiceOp): string {
  switch (op.kind) {
    case 'tag':
      return `Tag ${op.tag}`;
    case 'untag':
      return 'Untag';
    case 'source':
      return `Source ${op.source}`;
    case 'unsource':
      return 'No source';
    case 'role':
      return `Role ${op.role}`;
    case 'star':
      return `Star${nth(op.note)}`;
    case 'unstar':
      return `Unstar${nth(op.note)}`;
    case 'topics':
      return `About ${op.topics.join(', ')}`;
    case 'drop':
      return `Drop${nth(op.note)}`;
    case 'redo':
      return 'Redo';
    case 'remove':
      return 'Removed';
    case 'repoint':
      return 'Repoint';
    case 'next':
      return 'Next';
    case 'back':
      return 'Back';
    case 'purpose':
      return 'Purpose';
  }
}
