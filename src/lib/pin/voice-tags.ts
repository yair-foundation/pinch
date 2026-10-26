/*
 * Voice tags (D131): a few spoken phrases that set a field instead of becoming a note. "Tag this
 * as Checkout" sets the screen's tag, "a competitor" its source, "the role is target" its set's
 * role, "star this" a note's best example, "that's about copy" its topics; "drop that", "redo
 * this screen", "not that, this", "next" and "back" edit and move. Phrases are matched exactly,
 * on short clauses only, so ordinary critique ("this is our old checkout and the spacing is off")
 * stays a note; whatever matches is taken out of the words, so a command is never also a note.
 * The AI step that turns the rest into notes can return the same fields for other wordings.
 */

import { cleanScreenTag, type SourceKind, type Topic } from './model';
import { type ScreenRole, screenNamesOf } from './screen-index';

/** A word as speech-to-text gives it, timed in recording time (ms). */
export type TimedWord = { text: string; start: number; end: number };

/** Which note an edit is for: the nth on the screen (1 is the first), or the last. */
export type NoteRef = number | 'last';

/** One field set, or one edit, with when it was said. */
export type VoiceOp = { start: number; end: number } & (
  | { kind: 'tag'; tag: string }
  | { kind: 'untag' }
  | { kind: 'source'; source: SourceKind }
  | { kind: 'unsource'; source?: SourceKind }
  | { kind: 'role'; role: ScreenRole }
  | { kind: 'star'; note?: NoteRef }
  | { kind: 'unstar'; note?: NoteRef }
  | { kind: 'topics'; topics: Topic[] }
  | { kind: 'drop'; note: NoteRef }
  | { kind: 'redo' }
  | { kind: 'repoint' }
  | { kind: 'next' }
  | { kind: 'back' }
);

/** A pause this long between two words ends a sentence, as a full stop does. */
export const SENTENCE_PAUSE = 700;

/** Words said around a command that don't change it. */
const FILLER = new Set([
  'ok',
  'okay',
  'so',
  'and',
  'um',
  'uh',
  'erm',
  'please',
  'now',
  'alright',
  'right',
  'pinch',
  'oh',
  'yeah',
  'yes',
]);

const SOURCES: Record<SourceKind, string[]> = {
  ours: ['ours', 'mine', 'our product', 'our own', 'our own product', 'our app', 'our site'],
  competitor: ['competitor', 'a competitor', 'the competition', 'a rival', 'competitors'],
  other: [
    'other product',
    'another product',
    'a different product',
    'some other product',
    "someone else's",
    "someone else's product",
  ],
  concept: ['concept', 'a concept', 'a mockup', 'mockup', 'a mock up', 'mock up', 'never shipped'],
};

const ROLES: Record<ScreenRole, string[]> = {
  target: [
    'target',
    'target style',
    'the target',
    'the target style',
    'aim for this look',
    'the look to aim for',
  ],
  today: [
    'today',
    'how it looks today',
    'as it looks today',
    'as it is today',
    'the current look',
    'current look',
  ],
  principle: [
    'principle',
    'principle only',
    'just the idea',
    'only the idea',
    'the idea not the look',
  ],
};

const TOPIC_WORDS: Record<string, Topic> = {
  visual: 'visual',
  visuals: 'visual',
  look: 'visual',
  colour: 'visual',
  color: 'visual',
  colours: 'visual',
  colors: 'visual',
  typography: 'visual',
  type: 'visual',
  layout: 'layout',
  spacing: 'layout',
  alignment: 'layout',
  hierarchy: 'layout',
  copy: 'copy',
  words: 'copy',
  wording: 'copy',
  text: 'copy',
  tone: 'copy',
  interaction: 'interaction',
  interactions: 'interaction',
  states: 'interaction',
  feedback: 'interaction',
  motion: 'interaction',
  flow: 'flow',
  flows: 'flow',
  journey: 'flow',
  accessibility: 'accessibility',
  a11y: 'accessibility',
  contrast: 'accessibility',
};

const ORDINALS: Record<string, number> = {
  first: 1,
  one: 1,
  '1': 1,
  second: 2,
  two: 2,
  '2': 2,
  third: 3,
  three: 3,
  '3': 3,
  fourth: 4,
  four: 4,
  '4': 4,
  fifth: 5,
  five: 5,
  '5': 5,
  sixth: 6,
  six: 6,
  '6': 6,
  seventh: 7,
  seven: 7,
  '7': 7,
  eighth: 8,
  eight: 8,
  '8': 8,
  ninth: 9,
  nine: 9,
  '9': 9,
};

/** A word as it is compared: lower case, without the punctuation around it. */
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');

/** Whether a word ends a sentence, or a clause within one. */
const endsSentence = (text: string) => /[.?!]["'”’)]*$/.test(text);
const endsClause = (text: string) => /[,;]["'”’)]*$/.test(text);

/** The words between two indexes as compared, fillers dropped from both ends. */
function core(words: string[]): string[] {
  let a = 0;
  let b = words.length;
  while (a < b && FILLER.has(words[a])) a++;
  while (b > a && FILLER.has(words[b - 1])) b--;
  return words.slice(a, b);
}

const phrase = (words: string[]) => words.join(' ');

/** A clause made of an optional lead ("this is", "it's") and one of the phrases, nothing else. */
function leadAndOneOf<T extends string>(
  words: string[],
  table: Record<T, string[]>,
  leads: string[],
): T | null {
  const said = phrase(words);
  for (const lead of ['', ...leads]) {
    if (lead && !said.startsWith(`${lead} `)) continue;
    const rest = lead ? said.slice(lead.length + 1) : said;
    for (const [key, values] of Object.entries(table) as [T, string[]][])
      if (values.includes(rest)) return key;
  }
  return null;
}

const IS = ['this is', "it's", 'its', 'it is', "that's", 'that is', 'this one is', 'this one'];

/** "the second one", "number two", "the last one", "note three": which note, or null. */
function noteRef(words: string[]): NoteRef | null {
  const w = words.filter((x) => !['the', 'one', 'note', 'number', 'mark'].includes(x));
  if (w.length !== 1) return null;
  if (w[0] === 'last') return 'last';
  return ORDINALS[w[0]] ?? null;
}

/** A tag as spoken, tidied: each word capitalised when it all came in lower case. */
function tagFrom(raw: string[], known: readonly string[]) {
  const text = raw
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean)
    .join(' ');
  const cased =
    text === text.toLowerCase()
      ? text.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
      : text;
  const tag = cleanScreenTag(cased);
  return tag ? screenNamesOf([...known, tag]).name(tag) : '';
}

const TAG_LEADS = [
  'tag this as',
  'tag it as',
  'tag this one as',
  'tag as',
  'tag this',
  'tag it',
  'call this',
  'call it',
  'the product is',
  'product is',
  'the tag is',
  'tag is',
];
const UNTAG = ['untag', 'untag this', 'untag it', 'remove the tag', 'no tag', 'clear the tag'];
const STAR = [
  'star',
  'star this',
  'star it',
  'star that',
  'star this one',
  'best example',
  'a best example',
  'this is a best example',
  "that's a best example",
  'follow this',
  'follow this one',
];
const UNSTAR = [
  'unstar',
  'unstar this',
  'unstar it',
  'unstar that',
  'remove the star',
  'not a best example',
  "that's not a best example",
];
const DROP = ['drop', 'delete', 'remove', 'scratch', 'forget'];
const REDO = [
  'redo',
  'redo this',
  'redo this screen',
  'redo this one',
  'start this one over',
  'start over on this one',
  'start this screen over',
];
const NEXT = ['next', 'next one', 'next screen', 'go on', 'move on'];
const BACK = ['back', 'go back', 'previous', 'previous one', 'previous screen', 'last screen'];
const REPOINT = ['not that this', 'no not that this', 'not that this one', 'not that one this one'];
const TOPIC_LEADS = [
  "that's about",
  'that is about',
  'this is about',
  "it's about",
  'it is about',
  'about',
  'topic is',
  'the topic is',
  'topic',
  'topics',
];
const ROLE_LEADS = ['the role is', 'role is', 'role', 'its role is', ...IS];

type Clause = { words: TimedWord[]; said: string[] };
type Unwrapped<T> = T extends unknown ? Omit<T, 'start' | 'end'> : never;
type Op = Unwrapped<VoiceOp>;

/** One short clause as a command, or null when it is something said about the design. */
function command(c: Clause, known: readonly string[]): Op | null {
  const w = core(c.said);
  if (!w.length) return null;
  const said = phrase(w);
  for (const lead of TAG_LEADS) {
    if (!said.startsWith(`${lead} `)) continue;
    // The tag is the rest of the clause, as it was said, fillers at its end left off.
    const skip = c.said.indexOf(w[0]) + lead.split(' ').length;
    const rawWords = c.words.slice(skip).map((x) => x.text);
    let end = rawWords.length;
    while (end > 0 && FILLER.has(norm(rawWords[end - 1]))) end--;
    const tag = tagFrom(rawWords.slice(0, end), known);
    if (tag) return { kind: 'tag', tag };
  }
  if (UNTAG.includes(said)) return { kind: 'untag' };
  if (REPOINT.includes(said)) return { kind: 'repoint' };
  if (NEXT.includes(said)) return { kind: 'next' };
  if (BACK.includes(said)) return { kind: 'back' };
  if (REDO.includes(said)) return { kind: 'redo' };
  if (STAR.includes(said)) return { kind: 'star' };
  if (UNSTAR.includes(said)) return { kind: 'unstar' };
  // "star the second one", "unstar number two"
  if (w[0] === 'star' || w[0] === 'unstar') {
    const note = noteRef(w.slice(1));
    if (note !== null) return { kind: w[0] === 'star' ? 'star' : 'unstar', note };
  }
  // "drop that", "delete it", "drop the second one", "scratch that"
  if (DROP.includes(w[0])) {
    const rest = w.slice(1);
    if (['that', 'it', 'this', 'that one', 'this one', 'the last one'].includes(phrase(rest)))
      return { kind: 'drop', note: 'last' };
    const note = noteRef(rest);
    if (note !== null) return { kind: 'drop', note };
  }
  // "not a competitor", "it's not ours", "no source"
  if (said === 'no source' || said === 'clear the source') return { kind: 'unsource' };
  const notAt = w.indexOf('not');
  if (notAt >= 0 && notAt <= 2) {
    const before = phrase(w.slice(0, notAt));
    if (!before || IS.includes(before)) {
      const source = leadAndOneOf(w.slice(notAt + 1), SOURCES, []);
      if (source) return { kind: 'unsource', source };
    }
  }
  const source = leadAndOneOf(w, SOURCES, [...IS, 'the source is', 'source is', 'source']);
  if (source) return { kind: 'source', source };
  const role = leadAndOneOf(w, ROLES, ROLE_LEADS);
  // A bare "target" or "today" is too common to be a role; it needs a lead.
  if (role && !(w.length === 1 && w[0] !== 'principle')) return { kind: 'role', role };
  for (const lead of TOPIC_LEADS) {
    if (!said.startsWith(`${lead} `)) continue;
    const rest = said.slice(lead.length + 1).split(' ');
    const topics = new Set<Topic>();
    let all = true;
    for (const x of rest) {
      if (['and', 'the', 'its', 'it', 'a', 'both'].includes(x)) continue;
      const topic = TOPIC_WORDS[x];
      if (!topic) {
        all = false;
        break;
      }
      topics.add(topic);
    }
    if (all && topics.size) return { kind: 'topics', topics: [...topics] };
  }
  return null;
}

/**
 * Read the voice tags out of what was said: each command with when it was said, and the words
 * left for the notes. A sentence ends at a full stop or a pause of `SENTENCE_PAUSE`; commas split
 * it into clauses, each of which is a command only as a whole. A tag takes the spelling `known`
 * already uses for it (D110).
 */
export function parseVoiceTags(
  words: readonly TimedWord[],
  known: readonly string[] = [],
): { ops: VoiceOp[]; rest: TimedWord[] } {
  const sentences: TimedWord[][] = [];
  let current: TimedWord[] = [];
  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (current.length && prev && word.start - prev.end >= SENTENCE_PAUSE) {
      sentences.push(current);
      current = [];
    }
    current.push(word);
    if (endsSentence(word.text)) {
      sentences.push(current);
      current = [];
    }
  });
  if (current.length) sentences.push(current);

  const ops: VoiceOp[] = [];
  const rest: TimedWord[] = [];
  const take = (c: Clause): boolean => {
    const op = command(c, known);
    if (!op || !c.words.length) return false;
    ops.push({ ...op, start: c.words[0].start, end: c.words[c.words.length - 1].end } as VoiceOp);
    return true;
  };
  for (const sentence of sentences) {
    const said = sentence.map((x) => norm(x.text));
    // "Not that, this" is one command across its comma.
    if (REPOINT.includes(phrase(core(said))) && take({ words: sentence, said })) continue;
    let clause: TimedWord[] = [];
    const clauses: TimedWord[][] = [];
    for (const word of sentence) {
      clause.push(word);
      if (endsClause(word.text)) {
        clauses.push(clause);
        clause = [];
      }
    }
    if (clause.length) clauses.push(clause);
    for (const c of clauses) {
      if (!take({ words: c, said: c.map((x) => norm(x.text)) })) rest.push(...c);
    }
  }
  return { ops, rest };
}

/**
 * The phrases the reel's legend teaches, one or two for each command, with what each sets. Every
 * one is checked against `parseVoiceTags` in the tests, so the legend never shows a phrase that
 * doesn't work.
 */
export const VOICE_LEGEND: { say: string[]; does: string; kind: VoiceOp['kind'] }[] = [
  { say: ['Tag this as Checkout'], does: 'Tag the screen', kind: 'tag' },
  { say: ['A competitor', 'This is ours'], does: 'Whose design it is', kind: 'source' },
  { say: ['The role is target', 'How it looks today'], does: 'What the set is for', kind: 'role' },
  { say: ['Star this'], does: 'Mark a best example', kind: 'star' },
  { say: ['That’s about copy'], does: 'Set the note’s topics', kind: 'topics' },
  { say: ['Drop that', 'Drop the second one'], does: 'Remove a note', kind: 'drop' },
  { say: ['Not that, this'], does: 'Point at the right spot again', kind: 'repoint' },
  { say: ['Redo this screen'], does: 'Talk through it again', kind: 'redo' },
  { say: ['Next', 'Back'], does: 'Turn the reel', kind: 'next' },
];
