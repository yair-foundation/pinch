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
  type Shape,
  type SourceKind,
  sortTopics,
  type Topic,
} from './model';
import type { PointerSample, Take } from './narration';
import { wordsByScreen } from './transcript';
import { type NoteRef, parseVoiceTags, SENTENCE_PAUSE, type TimedWord } from './voice-tags';

/** A claim: one thing said about a screen, with when it was said. */
export type Claim = { text: string; words: TimedWord[]; start: number; end: number };

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

/** What was said, as claims: a sentence each, split at a contrast. */
export function claimsOf(words: readonly TimedWord[]): Claim[] {
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

  const claims: Claim[] = [];
  for (const sentence of sentences) {
    let part: TimedWord[] = [];
    const flush = () => {
      const said = part.map((w) => norm(w.text)).filter(Boolean);
      if (said.length >= 2 && said.some((w) => !FILLER.has(w))) claims.push(claimOf(part));
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

function claimOf(words: TimedWord[]): Claim {
  let text = words
    .map((w) => w.text)
    .join(' ')
    .replace(/[,;:]+$/, '');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.?!]["'”’)]*$/.test(text)) text += '.';
  return { text, words, start: words[0].start, end: words[words.length - 1].end };
}

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
type Rest = { x: number; y: number; from: number; to: number };

/** How far a resting pointer may drift, and how long it must stay, to count as a rest. */
const REST_DRIFT = 0.015;
const REST_MIN = 450;
/** A word's pointer is read this long either side of it, as pointing leads and lags speech. */
const LEAD = 400;

/**
 * The pointer's path over one screen between two times, broken where it left the screenshot,
 * each with when it ended: where it left, or the end of the window (D147: a rest before the
 * pointer left lasted until it left, not to the end of the window).
 */
function pathsOn(pointer: readonly PointerSample[], screen: number, from: number, to: number) {
  const paths: { points: Point[]; until: number }[] = [];
  let path: Point[] = [];
  let before: Point | null = null;
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
    if (s !== screen || x === null || y === null) {
      if (path.length) paths.push({ points: path, until: t });
      path = [];
      continue;
    }
    path.push({ t, x, y });
  }
  if (before) path.push(before);
  if (path.length) paths.push({ points: path, until: to });
  return paths;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }, size: Size) =>
  Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height) /
  Math.hypot(size.width, size.height);

/** Where the pointer rested on a path: it stays put between samples, so a gap is a rest too. */
function restsOf(path: Point[], until: number, size: Size): Rest[] {
  const rests: Rest[] = [];
  let i = 0;
  while (i < path.length) {
    let j = i;
    while (j + 1 < path.length && dist(path[i], path[j + 1], size) <= REST_DRIFT) j++;
    const to = j + 1 < path.length ? path[j + 1].t : until;
    if (to - path[i].t >= REST_MIN) {
      const run = path.slice(i, j + 1);
      rests.push({
        x: run.reduce((s, p) => s + p.x, 0) / run.length,
        y: run.reduce((s, p) => s + p.y, 0) / run.length,
        from: path[i].t,
        to,
      });
    }
    i = j + 1;
  }
  return rests;
}

/** A circle drawn on a path, as the area it goes round, or null. */
function loopOf(path: Point[], size: Size): Area | null {
  // Steps too small to have a direction are dropped, so a trembling hand doesn't turn.
  const pts: Point[] = [];
  for (const p of path) if (!pts.length || dist(pts[pts.length - 1], p, size) >= 0.006) pts.push(p);
  for (let i = 0; i + 3 < pts.length; i++) {
    let turned = 0;
    for (let k = i + 1; k + 1 < pts.length; k++) {
      const ax = (pts[k].x - pts[k - 1].x) * size.width;
      const ay = (pts[k].y - pts[k - 1].y) * size.height;
      const bx = (pts[k + 1].x - pts[k].x) * size.width;
      const by = (pts[k + 1].y - pts[k].y) * size.height;
      turned += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
      if (Math.abs(turned) < 1.75 * Math.PI) continue;
      const run = pts.slice(i, k + 2);
      const xs = run.map((p) => p.x);
      const ys = run.map((p) => p.y);
      const area = areaFrom(
        Math.min(...xs) - 0.01,
        Math.min(...ys) - 0.01,
        Math.max(...xs) + 0.01,
        Math.max(...ys) + 0.01,
      );
      const small = Math.min(area.w * size.width, area.h * size.height);
      if (small / Math.hypot(size.width, size.height) >= 0.02) return area;
      break;
    }
  }
  return null;
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

/** Where a claim lands on its screen, from the pointer while it was said. */
export function placeClaim(
  claim: Pick<Claim, 'words' | 'start' | 'end' | 'text'>,
  pointer: readonly PointerSample[],
  screen: number,
  size: Size,
): Shape {
  const from = claim.start - LEAD;
  const to = claim.end + LEAD / 2;
  const paths = pathsOn(pointer, screen, from, to);
  for (const path of paths) {
    const loop = loopOf(path.points, size);
    if (loop) return loop;
  }
  const rests = paths.flatMap((p) => restsOf(p.points, p.until, size));
  if (MOVES.test(claim.text) && rests.length >= 2) {
    const [a, b] = [rests[0], rests[rests.length - 1]];
    if (dist(a, b, size) >= 0.05) return arrowFrom(a.x, a.y, b.x, b.y);
  }
  // At "this", the rest it was said in, else wherever the pointer was, else a rest close by.
  for (const word of claim.words) {
    if (!DEICTIC.has(norm(word.text))) continue;
    const p =
      rests.find((r) => r.from <= word.start && r.to >= word.start) ??
      pointerAt(pointer, screen, word.start) ??
      rests.find((r) => r.from <= word.end + LEAD && r.to >= word.start - LEAD);
    if (p) return { kind: 'dot', x: p.x, y: p.y };
  }
  const longest = rests.sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  if (longest) return { kind: 'dot', x: longest.x, y: longest.y };
  return WHOLE;
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

/** A note's place as more is said about it: the circle over a dot, a place over the whole screen. */
const placeAgain = (last: Shape, next: Shape): Shape =>
  isWhole(last) || (last.kind === 'dot' && next.kind === 'area') ? next : last;

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
  const words = take.words ?? [];
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
    const { ops, rest } = parseVoiceTags(said[k], known);
    const before = voiceNotes(list[at]);
    const events = [
      ...claimsOf(rest).map((c) => ({ t: c.start, claim: c })),
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
        (p && [...all].reverse().find((m) => under(m.shape, p, size))) ||
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
        const shape = placeClaim(claim, take.pointer, k, size);
        const before = last;
        const i = before ? notes.findIndex((m) => m.id === before.id) : -1;
        const prev: Made | undefined = notes[i];
        const joins: boolean =
          !!before &&
          !!prev &&
          claim.start - before.end <= CONTINUE_GAP &&
          sameThing(prev.shape, shape, claim.text, size);
        const parts: string[] = joins && before ? [...before.parts, claim.text] : [claim.text];
        const sides = sidesOf(parts);
        const topics = sortTopics([
          ...(joins ? (prev.topics ?? []) : []),
          ...topicsOfClaim(claim.text),
        ]);
        const note: Made = {
          ...(joins ? prev : {}),
          id: joins ? prev.id : nextId(),
          shape: joins ? placeAgain(prev.shape, shape) : shape,
          label: '',
          good: sides.good,
          bad: sides.bad,
          ...(topics.length ? { topics } : {}),
          origin: 'voice',
          quote: parts.join(' '),
          at: joins ? prev.at : claim.start,
        };
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
          if (p) edit(notes.at(-1), (m) => ({ ...m, shape: { kind: 'dot', x: p.x, y: p.y } }));
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
  wordsByScreen(take.shown, take.words ?? [], take.screens.length).flatMap((said, k) =>
    parseVoiceTags(said, known).ops.some((op) => op.kind === 'remove') ? [take.screens[k].id] : [],
  );
