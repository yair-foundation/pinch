/*
 * What a note said aloud is, where its words say so plainly (D195): one that says something is
 * right, one that asks, one that takes back the note before it. A review is mostly corrections, so
 * the few notes that approve are the only place the author shows what is right, and its reader
 * found them easy to miss among "Avoid this".
 *
 * Only plain phrases are read. Sorting every note by its words (D147) does not hold on a real
 * review: of 289 notes on one, it took 150 as saying what works, "Off-brand." and "No margins."
 * among them, and "Like this." was approval three times and the end of "Do not number" twice. So
 * a note with no plain phrase in it is left as it is, and a wrong label is rarer than a missing one.
 * Pure.
 */

/** A note that says something is right, wholly or in part, or neither that these words can tell. */
export type NoteKind = 'right' | 'partly' | null;

const PRAISE = 'ok|okay|fine|good|great|nice|cool|right|correct|perfect|lovely|beautiful';
/** What may follow the word of praise: the end, or a little more about the same thing. */
const THEN = String.raw`(?=\s*[.,!]|\s*$|\s+(with|as|for|here|now|to me|and)\b)`;
const VERY = String.raw`(\s+(actually|really|quite|pretty|very|so))?`;

const APPROVES = [
  // "This slide is okay.", "This background is actually cool with this pattern."
  new RegExp(
    String.raw`^(this|that|it|these|those)(\s+[\w'-]+){0,2}\s+(is|are|looks?)${VERY}\s+(${PRAISE})${THEN}`,
    'i',
  ),
  new RegExp(String.raw`^(that's|it's)${VERY}\s+(${PRAISE})${THEN}`, 'i'),
  /^(this|that|it)(\s+[\w'-]+){0,2}\s+works\b/i,
  // "I like this", and not "I like to see more margin", which asks for something else.
  /^(i|we)\s+(really\s+)?(like|love)\s+(this|that|it|these|those|the|how|what)\b/i,
  /^keep\s+(this|that|it|these|those|the)\b/i,
  /^(actually,?\s+)?you\s+can\s+(use|keep)\b/i,
  new RegExp(`^(${PRAISE})[.!]?$`, 'i'),
];
/** A sentence with one of these in it turns on something else: it is not plain approval. */
const TURNS = /\b(not|no|never|don't|doesn't|isn't|aren't|can't|won't|nothing|but|too)\b/i;
/** "Like this.", said of the right one after a correction. Only as the whole of a note. */
const LIKE_THIS = /^like\s+(this|that|these|those)[.!]?$/i;

const sentencesOf = (words: string) =>
  words
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Whether one sentence plainly says something is right. */
export const approves = (sentence: string) =>
  !TURNS.test(sentence) && APPROVES.some((form) => form.test(sentence.replace(/[’‘]/g, "'")));

/**
 * Whether a note says something is right: every sentence of it, or only some. "Like this." counts
 * only as a whole note: joined to "Do not number." it is the end of that sentence, said over the
 * same spot, where the approval was said over another.
 */
export function kindOf(words: string): NoteKind {
  const sentences = sentencesOf(words);
  if (!sentences.length) return null;
  if (sentences.length === 1 && LIKE_THIS.test(sentences[0])) return 'right';
  const right = sentences.filter(approves).length;
  return right === sentences.length ? 'right' : right ? 'partly' : null;
}

/**
 * How a sentence put to the reader begins. A question mark alone is not it: across three reviews
 * five notes had one, and four asked nothing: "Oh boy, where do I start?", "What is this space?",
 * "You know what?", and a suggestion Whisper ended on one.
 */
const ASKS =
  /^(do you (have|think|know|see)|what do you think|any (idea|ideas|thoughts|suggestions)|how would you|what would you|which( one)? would you|is there (a|an|another|any))\b/i;

/** Whether a note asks its reader something: "Do you have an idea how to make it better?" */
export const asks = (words: string) => sentencesOf(words).some((s) => ASKS.test(s));

/**
 * Whether a note begins by taking something back: "Actually you can use this color." after "avoid
 * this color". What it takes back is the note said before it on the same screen.
 */
export const takesBack = (words: string) =>
  /^(actually|sorry|scratch that|on second thought|correction|no,? wait|i take (it|that) back)\b/i.test(
    words.trim(),
  );

/** How a note that says something is right begins in the package, in the author's words. */
export const KIND_START: Record<Exclude<NoteKind, null>, string> = {
  right: 'This is right: ',
  partly: 'Partly right: ',
};
export const ASKS_START = 'A question: ';
