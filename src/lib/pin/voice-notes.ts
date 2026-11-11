/*
 * Notes from what was said (D131, D137): a take's words, once read, become notes on its
 * screens, placed by the pointer, never by a model. Each sentence of the words left after the
 * voice tags is a claim, split again at "but", and it lands where the pointer was while it was
 * said: an area round a circle, an arrow between two rests for "move" or "align", a dot on a
 * rest or wherever the pointer was at "this", or else the whole screen. A claim that goes on
 * about the thing the last one was on (pointed at again, or "it", "that" with nothing pointed
 * at) joins its note, so a note is all that was said about one thing (D147); its parts say
 * what works or what to avoid by the words in them, read across the whole note, so a plain
 * description takes the side of the rest of what was said. The voice tags heard are applied in the order they were
 * said: a tag and a source carry on to the screens shown next, a star or topics go to a note,
 * "drop that", "redo this screen" and "not that, this" edit the notes made so far; the screens
 * said "remove it" over are named by `removedScreens`, to take out of the batch (D139). Running the
 * same take again replaces what it made, so reading it twice never doubles a note.
 */

import {
  type Area,
  type Asset,
  areaFrom,
  arrowFrom,
  type Mark,
  placesOf,
  type Shape,
  type SourceKind,
  sortTopics,
  type Topic,
} from './model';
import type { PointerSample, Take } from './narration';
import { wordsByScreen } from './transcript';
import {
  type NoteRef,
  parseVoiceTags,
  SENTENCE_PAUSE,
  type TimedWord,
  type VoiceOp,
} from './voice-tags';

/** A claim: one thing said about a screen, with when it was said. */
export type Claim = {
  text: string;
  words: TimedWord[];
  start: number;
  end: number;
  /** It only points, "Here and here." (D191): more spots for the note before it. */
  pointing?: true;
};

/** The note's place when nothing was pointed at: the whole screen. */
export const WHOLE: Area = { kind: 'area', x: 0, y: 0, w: 1, h: 1 };

export const isWhole = (s: Shape) => s.kind === 'area' && s.w >= 0.999 && s.h >= 0.999;

/** The ids of the notes a take makes start with this, so a second reading replaces them. */
export const voicePrefix = (takeId: string) =>
  `v${takeId
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, 20)}`;

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
const endsSentence = (text: string) => /[.?!]["'”’)]*$/.test(text);

/** Words that turn a sentence round, where one claim ends and the next begins. */
const CONTRAST = new Set(['but', 'however', 'although', 'though', 'whereas', 'yet']);
/** Words that say nothing on their own. */
const FILLER = new Set([
  'um',
  'uh',
  'erm',
  'so',
  'okay',
  'ok',
  'and',
  'yeah',
  'like',
  'well',
  'right',
  'oh',
]);

/** A pause this long ends a sentence whatever comes next: the thought has moved on. */
const LOST_THREAD = 6000;

/**
 * Words with no thought of their own (D186): a sentence made only of them has said nothing yet.
 * "Okay", "like", "right" and "well" are left out, as they can be the whole verdict.
 */
const EMPTY = new Set([
  ...['this', 'that', 'these', 'those', 'it', 'its', "it's", "that's", 'here', 'there', 'one'],
  ...['is', 'are', 'was', 'were', 'be', 'been', 'am', "i'm", 'do', 'does', 'did', 'to'],
  ...['i', 'you', 'we', 'they', 'me', 'us', 'them', 'my', 'your', 'our', 'their'],
  ...['the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'about'],
  ...['would', 'could', 'should', 'can', 'will', 'have', 'has', 'had', 'just', 'also', 'then'],
  ...['now', 'or', 'but', 'if', 'what', 'which', 'thing', 'things'],
  ...['um', 'uh', 'erm', 'oh', 'ah', 'so', 'and', 'wait', 'hmm', 'hm', 'mm'],
]);
/** What a screen is called: "this slide" is the screen, not something on it. */
const SCREEN_NOUN = new Set(['slide', 'screen', 'page', 'screenshot']);
/** Words no sentence ends on: whatever full stop or pause follows one, the sentence goes on. */
const DANGLING = new Set([
  ...['the', 'a', 'an', 'my', 'your', 'our', 'their', 'of', 'and', 'or', 'because'],
  // "Change the numbers to. Bolder font." (D191): Whisper's stop at a pause to look.
  ...['would', 'could', 'should', 'very', 'to'],
]);
/** Words that begin a thought without being one, so a sentence of only these is still open. */
const OPENS = new Set(['is', 'are', 'was', 'were', 'be', "i'm", "it's", "that's", 'would']);

const saidOf = (words: readonly TimedWord[]) => words.map((w) => norm(w.text)).filter(Boolean);
/** Whether what was said says nothing: only words with no thought of their own. */
const saysNothing = (said: readonly string[]) => said.every((w) => EMPTY.has(w));

/** Words that say where: "here" alone points, and so do two or more of the rest. */
const POINTS = new Set(['this', 'here', 'these', 'that', 'those', 'there']);
const PLACE = new Set(['here', 'there']);
const BETWEEN = new Set(['and', 'also', 'too', 'again', 'as', 'well']);
/**
 * Whether what was said only points (D191): "Here and here.", "This, this and this.", "Here.".
 * It says nothing on its own (D186), but it was said while pointing at more of what the note
 * before is about: on the author's second review three such remarks were dropped with their spots.
 */
const onlyPoints = (said: readonly string[]) => {
  const points = said.filter((w) => POINTS.has(w));
  return (
    said.every((w) => POINTS.has(w) || BETWEEN.has(w)) &&
    (points.length >= 2 || points.some((w) => PLACE.has(w)))
  );
};

/**
 * Whether a sentence so far is unfinished (D186): it ends on a word no sentence ends on ("I would
 * make the"), or it has opened a thought and said nothing yet ("This is"). Whisper puts a full
 * stop at a pause, and starts the next word with a capital, wherever the speaker stopped to look.
 */
function unfinished(sentence: readonly TimedWord[]): boolean {
  const said = saidOf(sentence);
  const last = said[said.length - 1];
  if (!last) return false;
  return DANGLING.has(last) || (saysNothing(said) && OPENS.has(last));
}

/**
 * Whether a pause before this word ends the sentence (D162). Whisper starts a sentence with a
 * capital, so a word in lower case after a pause goes on with the same thought, as people stop to
 * look or think in the middle of one: "a nice atmosphere … and vibes".
 */
const pauseEnds = (word: TimedWord, gap: number) =>
  gap >= LOST_THREAD || (gap >= SENTENCE_PAUSE && !/^[^\p{L}\p{N}]*\p{Ll}/u.test(word.text));

/** What was said, as claims: a sentence each, split at a contrast. */
export function claimsOf(words: readonly TimedWord[]): Claim[] {
  const sentences: TimedWord[][] = [];
  // The words an unfinished sentence went on past, whatever stop or pause came after them.
  const joined = new Set<TimedWord>();
  let current: TimedWord[] = [];
  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (current.length && prev && pauseEnds(word, word.start - prev.end)) {
      if (word.start - prev.end < LOST_THREAD && unfinished(current)) joined.add(prev);
      else {
        sentences.push(current);
        current = [];
      }
    }
    current.push(word);
    if (endsSentence(word.text)) {
      const next = words[i + 1];
      if (next && next.start - word.end < LOST_THREAD && unfinished(current)) joined.add(word);
      else {
        sentences.push(current);
        current = [];
      }
    }
  });
  if (current.length) sentences.push(current);

  const claims: Claim[] = [];
  for (const sentence of sentences) {
    let part: TimedWord[] = [];
    const flush = () => {
      const said = saidOf(part);
      // One word can be a whole note, "Nice" over what the pointer is on, but not a stray "a",
      // and not a sentence that never got to its point: "This is." (D186).
      const enough = said.length >= 2 || (said[0]?.length ?? 0) >= 3;
      if (enough && said.some((w) => !FILLER.has(w)) && !saysNothing(said))
        claims.push(claimOf(part, joined));
      else if (onlyPoints(said)) claims.push({ ...claimOf(part, joined), pointing: true });
      part = [];
    };
    for (const word of sentence) {
      if (part.length && CONTRAST.has(norm(word.text))) {
        flush();
        continue;
      }
      part.push(word);
    }
    flush();
  }
  return claims;
}

/** A proper name's or an acronym's capital stays; a sentence's first word, joined on, loses it. */
const lowered = (text: string) =>
  /^\p{Lu}\p{Ll}/u.test(text) && !/^I(['’]|$)/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;

function claimOf(words: TimedWord[], joined: ReadonlySet<TimedWord> = new Set()): Claim {
  let text = words
    .map((w, i) => {
      // Where an unfinished sentence went on, the stop Whisper put there goes, and so does the
      // capital it gave the next word: "I would make the. UI bigger." is one sentence.
      const said = joined.has(w) ? w.text.replace(/[.?!]+(["'”’)]*)$/, '$1') : w.text;
      return i > 0 && joined.has(words[i - 1]) ? lowered(said) : said;
    })
    .join(' ')
    .replace(/[,;:]+$/, '');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.?!]["'”’)]*$/.test(text)) text += '.';
  return { text, words, start: words[0].start, end: words[words.length - 1].end };
}

/**
 * What was said over a screen: the claims, and the voice tags heard. "Delete this" drops the last
 * note, and with no note yet on the screen it has nothing to drop: it was said about the screen,
 * so it is a claim (D188). On the author's review of 336 slides four such remarks left no trace.
 */
export function heard(
  words: readonly TimedWord[],
  known: readonly string[] = [],
  hadNotes = false,
): { claims: Claim[]; ops: VoiceOp[]; left: TimedWord[] } {
  const { ops, rest } = parseVoiceTags(words, known);
  const claims = claimsOf(rest);
  // What was neither a voice tag nor enough to be a note: "This is.", "Okay."
  const inClaims = new Set(claims.flatMap((c) => c.words));
  const left = rest.filter((w) => !inClaims.has(w));
  const kept: VoiceOp[] = [];
  const more: Claim[] = [];
  for (const op of ops) {
    const said = words.filter((w) => w.start >= op.start && w.end <= op.end);
    const nothingToDrop =
      op.kind === 'drop' &&
      op.note === 'last' &&
      !hadNotes &&
      !claims.some((c) => c.start < op.start) &&
      !more.length;
    if (nothingToDrop && said.length) more.push(claimOf(said));
    else kept.push(op);
  }
  return { claims: [...claims, ...more].sort((a, b) => a.start - b.start), ops: kept, left };
}

/** Whether words left out of the notes held more than a filler: "This is." does, "Okay." doesn't. */
export const saidSomething = (words: readonly TimedWord[]) =>
  saidOf(words).some((w) => !FILLER.has(w));

/**
 * Whether a note names only the screen and says nothing about it: "This slide.", "Slide.". It is
 * what is left when Whisper drops the start of "Delete this slide" (D187).
 */
export const namesOnlyTheScreen = (words: readonly TimedWord[]) => {
  const said = saidOf(words);
  return said.some((w) => SCREEN_NOUN.has(w)) && said.every((w) => EMPTY.has(w) || SCREEN_NOUN.has(w));
};

/** A take's words that were said in it: one timed after the recording ended was never said. */
export const wordsIn = (take: Pick<Take, 'words' | 'durationMs'>): TimedWord[] =>
  (take.words ?? []).filter((w) => w.start <= take.durationMs);

const PRAISE = new Set([
  'like',
  'love',
  'loved',
  'nice',
  'great',
  'good',
  'works',
  'working',
  'clean',
  'clear',
  'calm',
  'elegant',
  'beautiful',
  'lovely',
  'strong',
  'easy',
  'well',
  'perfect',
  'smart',
  'clever',
  'neat',
  'crisp',
  'balanced',
  'readable',
  'consistent',
  'simple',
  'delightful',
  'best',
  'favourite',
  'favorite',
  'generous',
  'airy',
  'subtle',
  'solid',
  'cool',
  'excellent',
  'right',
  'amazing',
  'fantastic',
  'helpful',
  'friendly',
  'polished',
  'tidy',
  'confident',
  'sharp',
  'exactly',
  'gorgeous',
  'stunning',
  'honest',
  'warm',
  'warmth',
  'quiet',
  'restrained',
  'refined',
  'thoughtful',
  'inviting',
  'charming',
  'effortless',
  'keep',
  'nails',
  'nailed',
  'enjoy',
  'likes',
  'loves',
  // What a thing does when it works, so "it doesn't scan" is a fault.
  'scan',
  'scans',
  'fit',
  'fits',
  'land',
  'lands',
  'flow',
  'flows',
  'help',
  'helps',
  'sense',
  'read',
  'reads',
]);
const FAULT = new Set([
  'too',
  'hard',
  'cramped',
  'cluttered',
  'busy',
  'noisy',
  'confusing',
  'unclear',
  'messy',
  'ugly',
  'bad',
  'wrong',
  'off',
  'awkward',
  'weak',
  'lost',
  'missing',
  'lacks',
  'lacking',
  'competes',
  'competing',
  'fighting',
  'inconsistent',
  'avoid',
  'instead',
  'should',
  'problem',
  'issue',
  'hate',
  'dislike',
  'annoying',
  'distracting',
  'overwhelming',
  'tiny',
  'broken',
  'generic',
  'boring',
  'dated',
  'cheap',
  'harsh',
  'muddy',
  'crowded',
  'tight',
  'loud',
  'heavy',
  'buried',
  'random',
  'odd',
  'weird',
  'meh',
  'worse',
  'worst',
  'fails',
  'clunky',
  'cluttered',
  'jarring',
  'shout',
  'shouts',
  'shouting',
  'shouty',
  'scream',
  'screams',
  'cliché',
  'cliche',
  'clichéd',
  'gimmick',
  'gimmicky',
  'tacky',
  'cheesy',
  'garish',
  'gaudy',
  'fussy',
  'salesy',
  'dull',
  'bland',
  'illegible',
  'unreadable',
  'needs',
]);
/** A wish for something else ("I'd want", "I'd set it in…") says what's there doesn't work. */
const WISH_FROM = new Set(["i'd", 'id', 'would', "we'd", "i'll"]);
const WISH = new Set([
  'want',
  'prefer',
  'rather',
  'like',
  'love',
  'see',
  'make',
  'change',
  'swap',
  'set',
  'go',
  'use',
  'drop',
  'move',
  'try',
  'pick',
  'add',
  'remove',
  'cut',
  'push',
  'replace',
  'simplify',
  'tone',
  'turn',
  'put',
  'give',
  'lose',
  'split',
]);
/** "Like" after these, or before "a", compares ("looks like a sticker sheet"); it doesn't praise. */
const LIKENS = new Set(['look', 'looks', 'feel', 'feels', 'read', 'reads', 'seem', 'seems', 'sound', 'sounds', 'just', 'more', 'less']);
const NEGATION = new Set([
  'not',
  "don't",
  'dont',
  "doesn't",
  'doesnt',
  "isn't",
  'isnt',
  'no',
  'never',
  "can't",
  "won't",
  "aren't",
  'nothing',
]);

/**
 * How far a claim leans to what works (above 0) or what to avoid (below), by the words in it: a
 * word of praise counts for it and a fault against it, each turned round by a "not" just
 * before, so "not bad" is praise and "doesn't shout" too, and "it doesn't scan" a fault; a wish
 * for something else ("I'd want a lighter one", "I'd set it in…") counts against what's there,
 * but "I'd keep it" for it. A negation with nothing to turn ("not decorated", "no boxes") says
 * nothing either way (D147). 0 is a plain description.
 */
export function leanOfClaim(text: string): number {
  const said = text.split(/\s+/).map(norm).filter(Boolean);
  let score = 0;
  said.forEach((w, i) => {
    const wish = WISH.has(w) && said.slice(Math.max(0, i - 2), i).some((x) => WISH_FROM.has(x));
    const likens =
      w === 'like' && (LIKENS.has(said[i - 1] ?? '') || ['a', 'an'].includes(said[i + 1] ?? ''));
    if (likens) return;
    const sign = wish ? -1 : PRAISE.has(w) ? 1 : FAULT.has(w) ? -1 : 0;
    if (!sign) return;
    const negated = said.slice(Math.max(0, i - 2), i).some((x) => NEGATION.has(x));
    score += negated ? -sign : sign;
  });
  return score;
}

/**
 * Whether a claim on its own says what works or what to avoid. Even, as a plain description is,
 * it's what works: the author said it about a screen they chose.
 */
export const verdictOfClaim = (text: string): 'good' | 'bad' =>
  leanOfClaim(text) < 0 ? 'bad' : 'good';

/**
 * A note's parts sorted into what works and what to avoid, read across the whole note (D147):
 * a part that leans takes its own side, and a plain description takes the side the note leans
 * to as a whole, so "The balance is in a medium sans. I'd want a light serif." is all to avoid.
 */
export function sidesOf(parts: readonly string[]): { good: string; bad: string } {
  const leans = parts.map(leanOfClaim);
  const whole = leans.reduce((a, b) => a + b, 0);
  const side = (lean: number) => (lean ? lean > 0 : whole >= 0);
  return {
    good: parts.filter((_, i) => side(leans[i])).join(' '),
    bad: parts.filter((_, i) => !side(leans[i])).join(' '),
  };
}

const TOPIC_OF: Record<string, Topic> = {
  spacing: 'layout',
  padding: 'layout',
  margin: 'layout',
  margins: 'layout',
  gap: 'layout',
  gaps: 'layout',
  alignment: 'layout',
  aligned: 'layout',
  align: 'layout',
  grid: 'layout',
  hierarchy: 'layout',
  layout: 'layout',
  density: 'layout',
  dense: 'layout',
  whitespace: 'layout',
  cramped: 'layout',
  crowded: 'layout',
  columns: 'layout',
  colour: 'visual',
  color: 'visual',
  colours: 'visual',
  colors: 'visual',
  font: 'visual',
  fonts: 'visual',
  typography: 'visual',
  typeface: 'visual',
  icon: 'visual',
  icons: 'visual',
  weight: 'visual',
  shadow: 'visual',
  shadows: 'visual',
  radius: 'visual',
  border: 'visual',
  borders: 'visual',
  gradient: 'visual',
  illustration: 'visual',
  imagery: 'visual',
  photo: 'visual',
  copy: 'copy',
  label: 'copy',
  labels: 'copy',
  heading: 'copy',
  headline: 'copy',
  wording: 'copy',
  tone: 'copy',
  microcopy: 'copy',
  words: 'copy',
  title: 'copy',
  hover: 'interaction',
  click: 'interaction',
  state: 'interaction',
  states: 'interaction',
  animation: 'interaction',
  transition: 'interaction',
  feedback: 'interaction',
  loading: 'interaction',
  toggle: 'interaction',
  flow: 'flow',
  step: 'flow',
  steps: 'flow',
  onboarding: 'flow',
  navigation: 'flow',
  nav: 'flow',
  checkout: 'flow',
  accessible: 'accessibility',
  accessibility: 'accessibility',
  legible: 'accessibility',
  keyboard: 'accessibility',
  contrast: 'accessibility',
};

/** The topics a claim names by its words, in their fixed order. */
export const topicsOfClaim = (text: string): Topic[] =>
  sortTopics(text.split(/\s+/).flatMap((w) => TOPIC_OF[norm(w)] ?? []));

/* ---- Where the pointer was ---- */

type Point = { t: number; x: number; y: number };
type Size = { width: number; height: number };

/** A pointer at rest: where, and from when to when. */
export type Rest = { x: number; y: number; from: number; to: number };

/**
 * A stroke (D185): the pointer's motion between two rests, read on its own before any words. A
 * circle goes round something and closes; a scrub goes back and forth over one spot; a travel is
 * straight and long, the hand going somewhere; the rest is wander, a hand moving while its owner
 * thinks. A line is traced along and back, as down a gutter or under a word (D190). Only a circle, a
 * scrub or a line says what the person meant, as `area`.
 */
export type Stroke = {
  kind: 'circle' | 'scrub' | 'line' | 'travel' | 'wander';
  from: number;
  to: number;
  area: Area | null;
};

/** How far a resting pointer may drift, and how long it must stay, to count as a rest. */
const REST_DRIFT = 0.015;
const REST_MIN = 450;
/** A word's pointer is read this long either side of it, as pointing leads and lags speech. */
const LEAD = 400;
/** A rest may begin this long after a word and still be where it pointed. */
const LAG = 800;
/** A hand that moved for a sentence came to rest no earlier than this before it (D185). */
const ARRIVED = 1500;
/** A slip off the screenshot shorter than this, straight back on, is one stroke still (D185). */
const BRIDGE = 400;
/** Steps under this share of the diagonal have no direction, so a trembling hand doesn't turn. */
const STEP = 0.006;
/**
 * A circle has turned this far, one way, closes within this share of its size, and takes no
 * longer than this a loop.
 */
const CIRCLE_TURN = 1.67 * Math.PI;
const CIRCLE_CLOSES = 0.35;
const CIRCLE_LOOP_MS = 2500;
/** A scrub crosses back over itself at least this often, within this share of the width. */
const SCRUB_TURNS = 3;
const SCRUB_ACROSS = 0.35;
/** A travel is at least this straight (chord over path) and this long (of the diagonal). */
const TRAVEL_STRAIGHT = 0.8;
const TRAVEL_LENGTH = 0.1;
/**
 * A line is gone along and back (D190): this long, of the diagonal, covered this many times over,
 * and never further than this from its own axis. A step this far off the axis, in radians, twice
 * running, is a corner: the line has ended.
 */
const LINE_LENGTH = 0.07;
const LINE_PASSES = 1.8;
const LINE_THIN = 0.02;
/** A long line drawn by hand wobbles: it may stray this share of its own length (D191). */
const LINE_WOBBLE = 0.06;
const LINE_CORNER = 0.6;
/** An area's short side is at least this share of the diagonal, or it was too small to mean. */
const SMALLEST = 0.012;
/** A circle covering this much of the screen is about the screen. */
const HUGE = 0.6;

/**
 * The pointer's path over one screen between two times, broken where it left the screenshot,
 * each with when it ended: where it left, or the end of the window (D147: a rest before the
 * pointer left lasted until it left, not to the end of the window).
 */
function pathsOn(pointer: readonly PointerSample[], screen: number, from: number, to: number) {
  const paths: { points: Point[]; until: number }[] = [];
  let path: Point[] = [];
  let before: Point | null = null;
  // When the pointer slipped off the screenshot, to come straight back (D185) or not.
  let left: number | null = null;
  const close = () => {
    if (path.length) paths.push({ points: path, until: left ?? to });
    path = [];
    left = null;
  };
  for (const [t, s, x, y] of pointer) {
    if (t < from) {
      before = s === screen && x !== null && y !== null ? { t: from, x, y } : null;
      continue;
    }
    if (t > to) break;
    if (before) {
      path.push(before);
      before = null;
    }
    if (s !== screen) {
      close();
      continue;
    }
    if (x === null || y === null) {
      left ??= t;
      continue;
    }
    if (left !== null && t - left > BRIDGE) close();
    left = null;
    path.push({ t, x, y });
  }
  if (before) path.push(before);
  close();
  return paths;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }, size: Size) =>
  Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height) /
  Math.hypot(size.width, size.height);

const restAt = (run: Point[], from: number, to: number): Rest => ({
  x: run.reduce((s, p) => s + p.x, 0) / run.length,
  y: run.reduce((s, p) => s + p.y, 0) / run.length,
  from,
  to,
});

/** The signed turn between the steps a to b and b to c, in radians. */
function turnAt(a: Point, b: Point, c: Point, size: Size): number {
  const ax = (b.x - a.x) * size.width;
  const ay = (b.y - a.y) * size.height;
  const bx = (c.x - b.x) * size.width;
  const by = (c.y - b.y) * size.height;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

function boxOf(pts: readonly Point[], pad: number): Area {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return areaFrom(
    Math.min(...xs) - pad,
    Math.min(...ys) - pad,
    Math.max(...xs) + pad,
    Math.max(...ys) + pad,
  );
}

/** An area widened to `SMALLEST` on a side too thin to have been meant, kept on the screen. */
function atLeast(a: Area, size: Size): Area {
  const d = Math.hypot(size.width, size.height);
  const w = Math.max(a.w, (SMALLEST * d) / size.width);
  const h = Math.max(a.h, (SMALLEST * d) / size.height);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  return areaFrom(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
}

/**
 * A circle on a stroke, begun at `i`: a run that turns through `CIRCLE_TURN` one way, ends near
 * where it began and takes no longer than a hand drawing takes, then goes on round the same spot
 * as long as the pointer stays by it; the box round all of it and where it ends, or null. A sweep
 * turns as far but doesn't close, and a hand wandering round the slide turns but takes seconds a
 * loop: neither counts (D185: on the author's deck, six such sweeps became slide-sized areas on
 * one slide).
 */
function circleFrom(
  pts: readonly Point[],
  i: number,
  size: Size,
): { area: Area; end: number } | null {
  let turned = 0;
  for (let k = i + 1; k + 1 < pts.length; k++) {
    turned += turnAt(pts[k - 1], pts[k], pts[k + 1], size);
    if (Math.abs(turned) < CIRCLE_TURN) continue;
    const run = pts.slice(i, k + 2);
    const box = boxOf(run, 0);
    const across =
      Math.max(box.w * size.width, box.h * size.height) / Math.hypot(size.width, size.height);
    const closes = dist(run[0], run[run.length - 1], size) <= CIRCLE_CLOSES * across;
    const quick =
      run[run.length - 1].t - run[0].t <= (CIRCLE_LOOP_MS * Math.abs(turned)) / (2 * Math.PI);
    if (!quick) return null;
    // Turned enough but not back round yet: a little further may close it; past a turn and a
    // fifth without closing, it never will.
    if (!closes) {
      if (Math.abs(turned) >= 2.4 * Math.PI) return null;
      continue;
    }
    // On round the same spot: every later point within a third of the circle's size of its box.
    const near = (p: Point) =>
      p.x >= box.x - across / 3 &&
      p.x <= box.x + box.w + across / 3 &&
      p.y >= box.y - across / 3 &&
      p.y <= box.y + box.h + across / 3;
    let end = k + 2;
    while (end < pts.length && near(pts[end])) end++;
    const area = boxOf(pts.slice(i, end), 0.01);
    const short = Math.min(area.w * size.width, area.h * size.height);
    if (short / Math.hypot(size.width, size.height) < SMALLEST) return null;
    return { area, end };
  }
  return null;
}

/**
 * Every circle on a stroke, in the order drawn (D190): a hand that circles one thing, goes to the
 * next and circles that, without stopping, has pointed at both. On the author's review, three
 * circles over three quotes were one stroke, and only the first was read.
 */
function circlesOf(pts: readonly Point[], size: Size): { area: Area; from: number; to: number }[] {
  const found: { area: Area; from: number; to: number }[] = [];
  let i = 0;
  while (i + 3 < pts.length) {
    const one = circleFrom(pts, i, size);
    if (one) {
      found.push({ area: one.area, from: pts[i].t, to: pts[one.end - 1].t });
      i = one.end;
    } else i++;
  }
  return found;
}

/** How far apart two axes are, in radians: a line and the same line run backwards are one. */
function axisGap(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/**
 * The lines a stroke goes along and back (D190), each as the thin box it stayed in. The path is
 * cut at its corners into runs that keep to one axis, a reversal being the same axis; a run is a
 * line when it is long, thin, and covered nearly twice over. Once along is a hand on its way.
 */
function linesOf(pts: readonly Point[], size: Size): { area: Area; from: number; to: number }[] {
  const d = Math.hypot(size.width, size.height);
  const at = (p: Point) => ({ x: (p.x * size.width) / d, y: (p.y * size.height) / d });
  const found: { area: Area; from: number; to: number }[] = [];
  const close = (run: Point[]) => {
    if (run.length < 4) return;
    const q = run.map(at);
    // The run's axis: from its first point to the one furthest from it.
    let far = q[0];
    for (const p of q) if (Math.hypot(p.x - q[0].x, p.y - q[0].y) > Math.hypot(far.x - q[0].x, far.y - q[0].y)) far = p;
    const axis = Math.atan2(far.y - q[0].y, far.x - q[0].x);
    const along = q.map((p) => (p.x - q[0].x) * Math.cos(axis) + (p.y - q[0].y) * Math.sin(axis));
    const off = q.map((p) => -(p.x - q[0].x) * Math.sin(axis) + (p.y - q[0].y) * Math.cos(axis));
    const length = Math.max(...along) - Math.min(...along);
    const middle = (Math.max(...off) + Math.min(...off)) / 2;
    const thin = Math.max(...off.map((o) => Math.abs(o - middle)));
    let path = 0;
    for (let k = 1; k < q.length; k++) path += Math.hypot(q[k].x - q[k - 1].x, q[k].y - q[k - 1].y);
    const wobble = Math.max(LINE_THIN, LINE_WOBBLE * length);
    if (length < LINE_LENGTH || thin > wobble || path < LINE_PASSES * length) return;
    found.push({
      area: atLeast(boxOf(run, 0.01), size),
      from: run[0].t,
      to: run[run.length - 1].t,
    });
  };
  let run: Point[] = pts.length ? [pts[0]] : [];
  let axis: number | null = null;
  let strayed = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = at(pts[k - 1]);
    const b = at(pts[k]);
    const step = Math.atan2(b.y - a.y, b.x - a.x);
    // The axis is set once the run has gone somewhere: its first steps have no direction yet.
    if (axis === null) {
      const start = at(run[0]);
      if (Math.hypot(b.x - start.x, b.y - start.y) >= 2 * STEP)
        axis = Math.atan2(b.y - start.y, b.x - start.x);
      run.push(pts[k]);
      continue;
    }
    if (axisGap(step, axis) <= LINE_CORNER) {
      strayed = 0;
      run.push(pts[k]);
      continue;
    }
    // One step off the axis is a wobble; a second is the corner, begun at the first.
    if (++strayed < 2) {
      run.push(pts[k]);
      continue;
    }
    const corner = run.pop() as Point;
    close(run);
    run = [corner, pts[k]];
    axis = null;
    strayed = 0;
  }
  close(run);
  return found;
}

/**
 * What a stroke is, from its shape alone: the circles, or the lines, drawn in it, each with when
 * it was drawn (D190), or the one thing the whole of it was.
 */
function classify(points: Point[], size: Size): Stroke[] {
  const from = points[0].t;
  const to = points[points.length - 1].t;
  const pts: Point[] = [];
  for (const p of points)
    if (!pts.length || dist(pts[pts.length - 1], p, size) >= STEP) pts.push(p);
  const drawn = (kind: 'circle' | 'line', all: { area: Area; from: number; to: number }[]) =>
    all.map((one): Stroke => ({ kind, ...one }));
  // Sharp turns back first: a hand scrubbing makes narrow loops that would pass for circles.
  const turned: number[] = [];
  for (let k = 1; k + 1 < pts.length; k++)
    if (Math.abs(turnAt(pts[k - 1], pts[k], pts[k + 1], size)) > 2.5) turned.push(k);
  const turns = turned.length;
  if (turns >= SCRUB_TURNS) {
    // The scrub is what lies between its first turn back and its last (D191): the way the hand
    // came and the way it left are not part of it, and made a small scrub a wide box, or a wander.
    const scrubbed = pts.slice(turned[0], turned[turns - 1] + 1);
    const box = boxOf(scrubbed, 0);
    if (box.w <= SCRUB_ACROSS && box.h <= SCRUB_ACROSS)
      return [
        {
          kind: 'scrub',
          from: scrubbed[0].t,
          to: scrubbed[scrubbed.length - 1].t,
          area: atLeast(boxOf(scrubbed, 0.01), size),
        },
      ];
    // Too wide for a scrub: lines gone along and back, or a hand wandering.
    const lines = linesOf(pts, size);
    return lines.length ? drawn('line', lines) : [{ kind: 'wander', from, to, area: null }];
  }
  const circles = pts.length >= 4 ? circlesOf(pts, size) : [];
  if (circles.length) return drawn('circle', circles);
  const lines = turns ? linesOf(pts, size) : [];
  if (lines.length) return drawn('line', lines);
  let length = 0;
  for (let k = 1; k < pts.length; k++) length += dist(pts[k - 1], pts[k], size);
  const chord = pts.length > 1 ? dist(pts[0], pts[pts.length - 1], size) : 0;
  if (length >= TRAVEL_LENGTH && chord / length >= TRAVEL_STRAIGHT)
    return [{ kind: 'travel', from, to, area: null }];
  return [{ kind: 'wander', from, to, area: null }];
}

/**
 * A path cut into rests and the strokes between them (D185). The pointer stays put between
 * samples, so a gap is a rest too; a stroke needs three samples to have a shape.
 */
export function strokesOf(
  path: readonly Point[],
  until: number,
  size: Size,
): { rests: Rest[]; strokes: Stroke[] } {
  const rests: Rest[] = [];
  const strokes: Stroke[] = [];
  let moving: Point[] = [];
  let i = 0;
  while (i < path.length) {
    let j = i;
    while (j + 1 < path.length && dist(path[i], path[j + 1], size) <= REST_DRIFT) j++;
    const to = j + 1 < path.length ? path[j + 1].t : until;
    if (to - path[i].t >= REST_MIN) {
      if (moving.length >= 3) strokes.push(...classify(moving, size));
      moving = [];
      rests.push(restAt(path.slice(i, j + 1), path[i].t, to));
    } else moving.push(...path.slice(i, j + 1));
    i = j + 1;
  }
  if (moving.length >= 3) strokes.push(...classify(moving, size));
  return { rests, strokes };
}

/** The rests and strokes of the pointer on a screen between two times. */
export function pointerOn(
  pointer: readonly PointerSample[],
  screen: number,
  from: number,
  to: number,
  size: Size,
): { rests: Rest[]; strokes: Stroke[] } {
  const rests: Rest[] = [];
  const strokes: Stroke[] = [];
  for (const path of pathsOn(pointer, screen, from, to)) {
    const cut = strokesOf(path.points, path.until, size);
    rests.push(...cut.rests);
    strokes.push(...cut.strokes);
  }
  return { rests, strokes };
}

const DEICTIC = new Set(['this', 'here', 'these', 'that', 'those', 'there']);
const MOVES =
  /\b(move|moving|moved|align|aligned|aligning|line (it |this |them )?up|shift|push|pull|closer|next to)\b/i;

/** Where the pointer was at a time on a screen, or null when it was off the screenshot. */
function pointerAt(pointer: readonly PointerSample[], screen: number, t: number) {
  let at: PointerSample | null = null;
  for (const p of pointer) {
    if (p[0] > t) break;
    at = p;
  }
  return at && at[1] === screen && at[2] !== null && at[3] !== null ? { x: at[2], y: at[3] } : null;
}

const isHuge = (a: Area) => a.w * a.h >= HUGE;
const dotAt = (p: { x: number; y: number }): Shape => ({ kind: 'dot', x: p.x, y: p.y });

/**
 * Whether a claim points at nothing but the screen (D188): each "this" or "that" in it is followed
 * by what a screen is called, "Delete this slide", "I like this page". On the author's review, 30
 * of 35 such remarks got a mark where the hand had come to rest after a scroll.
 */
export function aboutTheScreen(words: readonly Pick<TimedWord, 'text'>[]): boolean {
  let named = false;
  for (const [i, word] of words.entries()) {
    if (!DEICTIC.has(norm(word.text))) continue;
    if (!SCREEN_NOUN.has(norm(words[i + 1]?.text ?? ''))) return false;
    named = true;
  }
  return named;
}

/**
 * Where a claim lands on its screen, from the pointer while it was said (D185). A claim that
 * points at nothing but the screen is about the screen, whatever the hand did (D188). The strokes
 * come first: a circle or a scrub made while it was said is the thing, a huge one the screen. A
 * "move" with the pointer resting on two spots is an arrow from the first to the last. At "this",
 * the rest the pointer was in, or the one it came to just before or after the word, as pointing
 * leads and lags speech, else wherever it was. Without any of those, the rest the hand moved to
 * for this sentence; a rest begun long before it is a parked hand, and says nothing.
 */
export function placeClaim(
  claim: Pick<Claim, 'words' | 'start' | 'end' | 'text'>,
  pointer: readonly PointerSample[],
  screen: number,
  size: Size,
): Shape {
  return placesOfClaim(claim, pointer, screen, size)[0];
}

/** A hand hovering over a spot stays within this share of the diagonal, for at least this long. */
const HOVER = 0.05;
const HOVER_MS = 300;

/**
 * Where the hand hovered as a word was said (D191): not at rest, but kept to one small spot from
 * a little before the word to a little after, as a hand does that wiggles on the thing it means.
 * "Move this to be here" was said with the hand jiggling on each, and "here" was lost.
 */
function hoverAt(
  pointer: readonly PointerSample[],
  screen: number,
  word: TimedWord,
  size: Size,
): { x: number; y: number } | undefined {
  const from = word.start - HOVER_MS;
  const to = word.end + HOVER_MS;
  const at: { x: number; y: number }[] = [];
  let before: { x: number; y: number } | null = null;
  for (const [t, s, x, y] of pointer) {
    if (t > to) break;
    const on = s === screen && x !== null && y !== null ? { x, y } : null;
    if (t < from) before = on;
    else if (on) at.push(on);
    else return undefined;
  }
  // Where it was when the window opened counts: no samples since means it has not moved.
  if (before) at.unshift(before);
  if (!at.length) return undefined;
  const xs = at.map((p) => p.x);
  const ys = at.map((p) => p.y);
  const across = dist(
    { x: Math.min(...xs), y: Math.min(...ys) },
    { x: Math.max(...xs), y: Math.max(...ys) },
    size,
  );
  if (across > HOVER) return undefined;
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
}

/** A gesture this long before a claim or after it may still be its own (D191). */
const REACH = 3000;

/**
 * The time each claim on a screen reaches over (D191): from halfway back to the claim before to
 * halfway on to the one after, and no further than `REACH` either way. Every gesture then belongs
 * to the sentence nearest it, and to one only.
 */
export function reachOf(claims: readonly Pick<Claim, 'start' | 'end'>[]) {
  return claims.map((claim, i) => {
    const before = claims[i - 1];
    const after = claims[i + 1];
    return {
      from: Math.max(claim.start - REACH, before ? (before.end + claim.start) / 2 : -Infinity),
      to: Math.min(claim.end + REACH, after ? (claim.end + after.start) / 2 : Infinity),
    };
  });
}

/** The most spots one note points at: more than this is a hand that never settled. */
const MOST_PLACES = 6;

/** Whether two spots are one: areas that mostly cover each other, a dot on an area, two dots close by. */
function samePlace(a: Shape, b: Shape, size: Size): boolean {
  if (a.kind === 'arrow' || b.kind === 'arrow') return false;
  if (a.kind === 'dot' && b.kind === 'dot') return dist(a, b, size) <= 0.06;
  if (a.kind === 'area' && b.kind === 'area') {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 && (w * h) / Math.min(a.w * a.h, b.w * b.h) >= 0.5;
  }
  const area = a.kind === 'area' ? a : (b as Area);
  const dot = a.kind === 'area' ? b : a;
  return (
    dot.x >= area.x - 0.02 &&
    dot.x <= area.x + area.w + 0.02 &&
    dot.y >= area.y - 0.02 &&
    dot.y <= area.y + area.h + 0.02
  );
}

/** One box round two areas that are the same spot: loops drawn over each other, a line retraced. */
const roundBoth = (a: Area, b: Area): Area =>
  areaFrom(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.w, b.x + b.w),
    Math.max(a.y + a.h, b.y + b.h),
  );

/**
 * Every spot a claim points at, in the order pointed at (D190): each circle, scrub or line made
 * while it was said, then each "this" or "here" said with the hand at rest somewhere else. One
 * sentence can be about two things, "the stroke here and here are not consistent", and on the
 * author's review three of eleven notes that pointed lost all but one of their spots. A stroke is
 * the claim's when it was made while the claim was said, not one whose tail the claim began in.
 * Among smaller spots, one that covers most of the screen is left out; alone, it is the screen.
 */
export function placesOfClaim(
  claim: Pick<Claim, 'words' | 'start' | 'end' | 'text'>,
  pointer: readonly PointerSample[],
  screen: number,
  size: Size,
  /** The time around the claim that is nearer to it than to the claims either side (`reachOf`). */
  reach?: { from: number; to: number },
): Shape[] {
  if (aboutTheScreen(claim.words)) return [WHOLE];
  const from = claim.start - LEAD;
  const to = claim.end + LEAD / 2;
  const seen = pointerOn(
    pointer,
    screen,
    Math.min(from - ARRIVED, reach?.from ?? from),
    Math.max(to + LAG, reach?.to ?? to),
    size,
  );
  const during = (x: { from: number; to: number }) => x.to >= from && x.from <= to;
  const overlap = (x: { from: number; to: number }) => Math.min(x.to, to) - Math.max(x.from, from);
  // A gesture is the claim's when its middle falls in the claim's reach (D191): people go on
  // pointing after a short sentence, and point before the next.
  const reached = (x: { from: number; to: number }) =>
    !!reach && (x.from + x.to) / 2 >= reach.from && (x.from + x.to) / 2 <= reach.to;

  // The words that point, and the rest the hand was in as each was said, if it was in one.
  const pointing = claim.words.filter(
    (word, i) =>
      DEICTIC.has(norm(word.text)) && !SCREEN_NOUN.has(norm(claim.words[i + 1]?.text ?? '')),
  );
  const restAt = (word: TimedWord) =>
    seen.rests.find((r) => r.from <= word.start && r.to >= word.start) ??
    hoverAt(pointer, screen, word, size);

  const drawn = seen.strokes.filter((s) => s.area && (during(s) || reached(s)));
  const own = drawn.filter((s) =>
    reach ? reached(s) : overlap(s) >= Math.min(400, (s.to - s.from) / 2),
  );
  // With none made while it was said, the one it overlaps most, as before D190: a circle is often
  // drawn just ahead of the words. Not when "this" was said with the hand at rest: that is the spot.
  const strokes = own.length
    ? own
    : pointing.some(restAt)
      ? []
      : drawn.sort((a, b) => overlap(b) - overlap(a)).slice(0, 1);
  const spots: { shape: Shape; at: number }[] = [];
  // One that covers most of the screen is set aside first, or it would take in every spot in it.
  let screenWide = false;
  for (const stroke of strokes.sort((a, b) => a.from - b.from)) {
    const area = stroke.area as Area;
    if (isHuge(area)) {
      screenWide = true;
      continue;
    }
    const i = spots.findIndex((p) => samePlace(p.shape, area, size));
    if (i < 0) spots.push({ shape: area, at: stroke.from });
    else spots[i] = { shape: roundBoth(spots[i].shape as Area, area), at: spots[i].at };
  }
  if (screenWide && !spots.length) return [WHOLE];

  const rests = seen.rests.filter(during);
  if (!spots.length && MOVES.test(claim.text) && rests.length >= 2) {
    const [a, b] = [rests[0], rests[rests.length - 1]];
    if (dist(a, b, size) >= 0.05) return [arrowFrom(a.x, a.y, b.x, b.y)];
  }
  // Beside something drawn, a word points only from a rest the hand was already in: the rest it
  // comes to after a circle is the end of the circle.
  const beside = spots.length > 0;
  for (const word of pointing) {
    const rest =
      restAt(word) ??
      (beside
        ? undefined
        : seen.rests.find((r) => r.from >= word.start - LEAD && r.from <= word.end + LAG));
    // Only the first spot is taken from a hand still moving: the others need it to have stopped.
    const at = rest ?? (spots.length ? null : pointerAt(pointer, screen, word.start));
    if (!at) continue;
    const dot = dotAt(at);
    if (!spots.some((p) => samePlace(p.shape, dot, size))) spots.push({ shape: dot, at: word.start });
  }
  if (spots.length)
    return spots
      .sort((a, b) => a.at - b.at)
      .slice(0, MOST_PLACES)
      .map((p) => p.shape);
  const arrived = rests
    .filter((r) => r.from >= claim.start - ARRIVED)
    .sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  return [arrived ? dotAt(arrived) : WHOLE];
}

/**
 * A note's spots as more is said about it (D190): a claim with nothing pointed at leaves them as
 * they were, a spot pointed at again stays one, a circle drawn over a dot takes its place, and a
 * new spot is added after the others.
 */
function spotsAgain(last: readonly Shape[], next: readonly Shape[], size: Size): Shape[] {
  if (next.every(isWhole)) return [...last];
  if (last.every(isWhole)) return [...next];
  const out = [...last];
  for (const shape of next) {
    const i = out.findIndex((p) => samePlace(p, shape, size));
    if (i < 0) out.push(shape);
    else if (out[i].kind === 'dot' && shape.kind === 'area') out[i] = shape;
  }
  return out.slice(0, MOST_PLACES);
}

/** Whether the pointer stayed on a note's place through a claim: the hand still on the thing. */
export function stayedOn(
  shape: Shape,
  pointer: readonly PointerSample[],
  screen: number,
  claim: Pick<Claim, 'start' | 'end'>,
  size: Size,
): boolean {
  if (isWhole(shape)) return false;
  const a = pointerAt(pointer, screen, claim.start);
  const b = pointerAt(pointer, screen, (claim.start + claim.end) / 2);
  return !!a && !!b && under(shape, a, size) && under(shape, b, size);
}

/** How long a pause may be inside one note: a longer one starts the next, whatever is said. */
const CONTINUE_GAP = 2500;
/** Words that pick up what was just said, so a sentence with nothing pointed at goes on about it. */
const ANAPHOR = new Set([
  'it',
  "it's",
  'its',
  'that',
  "that's",
  'this',
  'they',
  "they're",
  'these',
  'those',
  'which',
  'and',
  'also',
  'same',
]);

/**
 * Words that can only be about what was just said. A sentence that starts with one in the same
 * breath as the last goes on about its thing, wherever the hand has gone since (D188): read piece
 * by piece, Whisper writes "This color should be changed. It's not good." where it wrote one
 * sentence before, and the second landed where the hand was leaving for.
 */
const PRONOUN = new Set(['it', "it's", 'its', 'they', "they're", 'which']);

/** How much of the bigger of two areas the smaller covers, and the smaller covers of it. */
function overlapOf(a: Area, b: Area) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
}

/**
 * Whether a claim goes on about the thing a note is on (D147): pointed at again (a dot on its
 * area or by its dot, a circle round its dot or over its area), or, with nothing pointed at,
 * picked up by "it", "that", "these". A move is a note of its own.
 */
export function sameThing(last: Shape, next: Shape, text: string, size: Size): boolean {
  if (isWhole(next)) return ANAPHOR.has(norm(text.split(/\s+/)[0] ?? ''));
  if (isWhole(last) || last.kind === 'arrow' || next.kind === 'arrow') return false;
  const inside = (a: Area, p: { x: number; y: number }) =>
    p.x >= a.x - 0.02 && p.x <= a.x + a.w + 0.02 && p.y >= a.y - 0.02 && p.y <= a.y + a.h + 0.02;
  if (last.kind === 'dot' && next.kind === 'dot') return dist(last, next, size) <= 0.06;
  if (last.kind === 'area' && next.kind === 'dot') return inside(last, next);
  if (last.kind === 'dot' && next.kind === 'area') return inside(next, last);
  return last.kind === 'area' && next.kind === 'area' && overlapOf(last, next) >= 0.5;
}

/** Whether a point is on a note's place, as "star this" or "drop that" means it. */
function under(shape: Shape, p: { x: number; y: number }, size: Size) {
  if (isWhole(shape)) return false;
  if (shape.kind === 'dot') return dist(shape, p, size) <= 0.04;
  if (shape.kind === 'arrow')
    return dist(shape, p, size) <= 0.04 || dist({ x: shape.x2, y: shape.y2 }, p, size) <= 0.04;
  return p.x >= shape.x && p.x <= shape.x + shape.w && p.y >= shape.y && p.y <= shape.y + shape.h;
}

/* ---- The take applied to the batch ---- */

/** The notes said on a screen, in the order they were said: the ones a take numbers. */
export const voiceNotes = (a: Pick<Asset, 'marks'>) => a.marks.filter((m) => m.origin === 'voice');

/** The takes whose notes are on the batch (D183), oldest first: the ones its export carries. */
export const takesApplied = (assets: readonly Pick<Asset, 'marks'>[], takes: readonly Take[]) =>
  takes.filter((t) => {
    const prefix = voicePrefix(t.id);
    return assets.some((a) => voiceNotes(a).some((m) => m.id.startsWith(prefix)));
  });

/** A note's verdict turned round: what works becomes what to avoid, and back. */
export const flipVerdict = (m: Mark): Mark => {
  const { best: _best, ...rest } = m;
  return { ...rest, good: m.bad, bad: m.good };
};

type Made = Mark & { at: number };

/**
 * A read take applied to the batch: its notes on each screen, and the voice tags heard. The
 * notes it made before are taken out first. Screens no longer in the batch are left out.
 */
export function applyTake(
  assets: readonly Asset[],
  take: Take,
  known: readonly string[] = [],
): Asset[] {
  const prefix = voicePrefix(take.id);
  const list = assets.map((a) => ({
    ...a,
    marks: a.marks.filter((m) => !m.id.startsWith(prefix)),
  }));
  const words = wordsIn(take);
  if (!words.length) return list;
  const byId = new Map(list.map((a, i) => [a.id, i]));
  const n = take.screens.length;
  const said = wordsByScreen(take.shown, words, n);
  const firstSeen = take.screens.map(
    (_, k) => take.shown.find((s) => s.screen === k)?.t ?? Infinity,
  );

  // The tags and sources named, in time, to carry on to the screens shown after each.
  type Naming = { t: number; screen: number; tag?: string | null; source?: SourceKind | null };
  const namings: Naming[] = [];
  const made: Made[][] = take.screens.map(() => []);
  let count = 0;
  const nextId = () => `${prefix}${(count++).toString(36)}`;

  for (let k = 0; k < n; k++) {
    const at = byId.get(take.screens[k].id);
    if (at === undefined) continue;
    const size = take.screens[k];
    const before = voiceNotes(list[at]);
    const { ops, claims } = heard(said[k], known, before.length > 0);
    const reach = reachOf(claims);
    const events = [
      ...claims.map((c, i) => ({ t: c.start, claim: c, reach: reach[i] })),
      ...ops.map((op) => ({ t: op.start, op })),
    ].sort((a, b) => a.t - b.t);
    const notes = made[k];
    // What the last claim said and when it ended, to join the next one about the same thing.
    let last = null as { id: string; end: number; parts: string[] } | null;
    const target = (ref: NoteRef | undefined, t: number): Mark | undefined => {
      const all: Mark[] = [...before, ...notes];
      if (typeof ref === 'number') return all[ref - 1];
      const p = pointerAt(take.pointer, k, t);
      return (
        (p && [...all].reverse().find((m) => placesOf(m).some((s) => under(s, p, size)))) ||
        notes.at(-1) ||
        before.at(-1)
      );
    };
    const edit = (m: Mark | undefined, change: (m: Mark) => Mark) => {
      if (!m) return;
      const i = notes.findIndex((x) => x.id === m.id);
      if (i >= 0) notes[i] = { ...change(notes[i]), at: notes[i].at };
      else
        list[at] = {
          ...list[at],
          marks: list[at].marks.map((x) => (x.id === m.id ? change(x) : x)),
        };
    };
    for (const e of events) {
      if ('claim' in e) {
        const { claim } = e;
        const spots = placesOfClaim(claim, take.pointer, k, size, e.reach);
        const shape = spots[0];
        const before = last;
        const i = before ? notes.findIndex((m) => m.id === before.id) : -1;
        const prev: Made | undefined = notes[i];
        const sameBreath =
          !!before &&
          claim.start - before.end < SENTENCE_PAUSE &&
          PRONOUN.has(norm(claim.words[0]?.text ?? ''));
        // "Here and here." after a note points at more of what the note is about (D191).
        const pointsOn =
          !!claim.pointing && !!before && !!prev && claim.start - before.end < LOST_THREAD;
        const joins: boolean =
          pointsOn ||
          (!!before &&
            !!prev &&
            claim.start - before.end <= CONTINUE_GAP &&
            (sameBreath ||
              sameThing(prev.shape, shape, claim.text, size) ||
              (isWhole(shape) &&
                placesOf(prev).some((s) => stayedOn(s, take.pointer, k, claim, size)))));
        const parts: string[] = joins && before ? [...before.parts, claim.text] : [claim.text];
        const sides = sidesOf(parts);
        const topics = sortTopics([
          ...(joins ? (prev.topics ?? []) : []),
          ...topicsOfClaim(claim.text),
        ]);
        const note: Made = {
          ...(joins ? prev : {}),
          id: joins ? prev.id : nextId(),
          shape,
          label: '',
          good: sides.good,
          bad: sides.bad,
          ...(topics.length ? { topics } : {}),
          origin: 'voice',
          quote: parts.join(' '),
          at: joins ? prev.at : claim.start,
        };
        // In the same breath the spots stay as they were: the hand has only moved on.
        const all = !joins ? spots : sameBreath ? placesOf(prev) : spotsAgain(placesOf(prev), spots, size);
        note.shape = all[0];
        if (all.length > 1) note.also = all.slice(1);
        else delete note.also;
        // Starred before, it stays a best example only while it still says what works.
        if (note.best && !note.good) delete note.best;
        if (joins) notes[i] = note;
        else notes.push(note);
        last = { id: note.id, end: claim.end, parts };
        continue;
      }
      const { op } = e;
      switch (op.kind) {
        case 'tag':
          namings.push({ t: op.start, screen: k, tag: op.tag });
          break;
        case 'untag':
          namings.push({ t: op.start, screen: k, tag: null });
          break;
        case 'source':
          namings.push({ t: op.start, screen: k, source: op.source });
          break;
        case 'unsource':
          namings.push({ t: op.start, screen: k, source: null });
          break;
        case 'star':
          edit(target(op.note, op.start), (m) => (m.good.trim() ? { ...m, best: true } : m));
          break;
        case 'unstar':
          edit(target(op.note, op.start), (m) => ({ ...m, best: false }));
          break;
        case 'topics':
          edit(target(undefined, op.start), (m) => ({
            ...m,
            topics: sortTopics([...(m.topics ?? []), ...op.topics]),
          }));
          break;
        case 'drop': {
          const m = target(op.note, op.start);
          if (!m) break;
          const i = notes.findIndex((x) => x.id === m.id);
          if (i >= 0) notes.splice(i, 1);
          else list[at] = { ...list[at], marks: list[at].marks.filter((x) => x.id !== m.id) };
          break;
        }
        case 'redo':
          notes.splice(0, notes.length, ...notes.filter((m) => m.at > op.start));
          break;
        // Taken out by `removedScreens`, a step of its own, so Undo brings back just the screen.
        case 'remove':
          break;
        case 'repoint': {
          const p = pointerAt(take.pointer, k, op.end);
          if (p)
            edit(notes.at(-1), ({ also: _also, ...m }) => ({
              ...m,
              shape: { kind: 'dot', x: p.x, y: p.y },
            }));
          break;
        }
        // The role belongs to the tag's set on Your rules; the moves already happened.
        default:
          break;
      }
    }
  }

  namings.sort((a, b) => a.t - b.t);
  for (let k = 0; k < n; k++) {
    const at = byId.get(take.screens[k].id);
    if (at === undefined) continue;
    const a = list[at];
    let { screenTag, source } = a;
    // Named on this screen, or carried from the last naming before it was first shown.
    const own = (key: 'tag' | 'source') => namings.filter((x) => x.screen === k && key in x).at(-1);
    const carried = (key: 'tag' | 'source') =>
      firstSeen[k] === Infinity
        ? undefined
        : namings.filter((x) => key in x && x.t < firstSeen[k] && x.screen !== k).at(-1);
    const tag = own('tag') ?? (screenTag ? undefined : carried('tag'));
    if (tag) screenTag = tag.tag ?? undefined;
    const src = own('source') ?? (source ? undefined : carried('source'));
    if (src) source = src.source ? { kind: src.source } : undefined;
    const marks = [...a.marks, ...made[k].map(({ at: _at, ...m }) => m)];
    const next: Asset = { ...a, marks };
    if (screenTag) next.screenTag = screenTag;
    else delete next.screenTag;
    if (source) next.source = source;
    else delete next.source;
    list[at] = next;
  }
  return list;
}

/** The screens of a read take said "remove it" over (D139), to take out of the batch. */
export const removedScreens = (take: Take, known: readonly string[] = []): string[] =>
  wordsByScreen(take.shown, wordsIn(take), take.screens.length).flatMap((said, k) =>
    parseVoiceTags(said, known).ops.some((op) => op.kind === 'remove') ? [take.screens[k].id] : [],
  );
