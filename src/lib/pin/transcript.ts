/*
 * What was said in a take (D131, D136): whisper.cpp's output read into timed words, the words
 * split by the screen on show when each was said, and the voice tags heard, as short labels.
 */

import type { Shown } from './narration';
import type { TimedWord, VoiceOp } from './voice-tags';

/** One segment of whisper.cpp's JSON (`-oj`); with `-ml 1 -sow` each is one word. */
type WhisperSegment = { offsets?: { from?: number; to?: number }; text?: string };

/** Sounds whisper writes in brackets instead of words: "[BLANK_AUDIO]", "(music)". */
const NOT_SPEECH = /^[[(*].*[\])*]$/;

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
  return words;
}

/**
 * The words said over each screen: a word belongs to the screen on show when it began. Words
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
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    while (i < marks.length && marks[i].t <= word.start) screen = marks[i++].screen;
    out[Math.min(screen ?? screens - 1, screens - 1)].push(word);
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
  }
}
