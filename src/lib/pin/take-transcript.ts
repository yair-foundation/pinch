/*
 * Everything said in a take, in order, with what became of each remark (D188): a note, a voice
 * tag that was acted on, or words too thin to be a note. The notes are made from the words by
 * rules, and a rule can take a remark another way than it was meant: on the author's review of
 * 336 slides, "Remove this." took three screens out of the batch and "Delete this" dropped a note
 * that wasn't there, and neither left a trace in what the agent was given. So the package carries
 * the words as they were said, and names the remarks it is not sure of. Pure.
 */

import { clockText, type Take } from './narration';
import { opLabel, spoken, wordsByScreen } from './transcript';
import {
  heard,
  namesOnlyTheScreen,
  onlyTurns,
  saidSomething,
  stopsShort,
  wordsIn,
} from './voice-notes';
import { SENTENCE_PAUSE, type TimedWord } from './voice-tags';

/** One thing said over a screen. */
export type Remark = {
  /** The screen it is filed on, by its place in the take. */
  screen: number;
  /** When it began, in the recording. */
  at: number;
  text: string;
  /** A note, a voice tag that was acted on, or words left out of the notes. */
  kind: 'note' | 'tag' | 'left';
  /** Why it may not have been taken as it was meant, as the author would say it. */
  unsure?: string;
};

/** The screen on show at a time: the end card counts as the last screen. */
function screenAt(take: Take, t: number): number {
  let screen: number | null = take.shown[0]?.screen ?? 0;
  for (const mark of [...take.shown].sort((a, b) => a.t - b.t)) {
    if (mark.t > t) break;
    screen = mark.screen;
  }
  return Math.min(screen ?? take.screens.length - 1, take.screens.length - 1);
}

/** What a voice tag took away, for the author to see it was taken as one. */
const TOOK: Partial<Record<string, string>> = {
  remove: 'Taken as a command: this screenshot left the batch, so it has no notes.',
  drop: 'Taken as a command: it took out the note before it.',
  redo: 'Taken as a command: it took out the notes before it on this screen.',
};

/** A take's remarks, in the order they were said. */
export function remarksOf(take: Take, known: readonly string[] = []): Remark[] {
  const screens = take.screens.length;
  const out: Remark[] = [];
  wordsByScreen(take.shown, wordsIn(take), screens).forEach((words, screen) => {
    if (!words.length) return;
    const { claims, ops, left } = heard(words, known);
    for (const claim of claims) {
      const last = claim.words[claim.words.length - 1];
      const ended = screenAt(take, last.start);
      const unsure = namesOnlyTheScreen(claim.words)
        ? 'Too short to say what I meant: its start may be missing.'
        : stopsShort(claim.words)
          ? 'Stops mid-sentence: its end may be missing.'
          : ended !== screen
            ? `Said as the reel turned to ${take.screens[ended].name}.`
            : undefined;
      out.push({
        screen,
        at: claim.start,
        text: claim.text,
        kind: 'note',
        ...(unsure && { unsure }),
      });
    }
    for (const op of ops) {
      const said = words.filter((w) => w.start >= op.start && w.end <= op.end);
      const unsure = TOOK[op.kind];
      out.push({
        screen,
        at: op.start,
        text: `${spoken(said)} (${opLabel(op)})`,
        kind: 'tag',
        ...(unsure && { unsure }),
      });
    }
    // Words left out, a run at a time: a pause between two of them starts the next.
    const runs: TimedWord[][] = [];
    for (const word of left) {
      const run = runs.at(-1);
      const before = run?.at(-1);
      if (run && before && word.start - before.end < SENTENCE_PAUSE) run.push(word);
      else runs.push([word]);
    }
    // A lone "but" is where a remark was split in two (D192), not a remark to ask about.
    for (const run of runs)
      out.push({
        screen,
        at: run[0].start,
        text: spoken(run),
        kind: 'left',
        ...(saidSomething(run) && !onlyTurns(run) && { unsure: 'Too short to be a note.' }),
      });
  });
  return out.sort((a, b) => a.at - b.at);
}

/** What the takes are for, as their author said it (D194): each such remark, in order. */
export function purposeOf(takes: readonly Take[], known: readonly string[] = []): string[] {
  return takes.flatMap((take) =>
    wordsByScreen(take.shown, wordsIn(take), take.screens.length).flatMap((words) =>
      heard(words, known).ops.flatMap((op) => (op.kind === 'purpose' ? [op.text] : [])),
    ),
  );
}

/** A screen on show for less than this was passed, not looked at. */
const GLANCE = 500;

/** How long each screen of a take was on show, in milliseconds: 0 for one that never was. */
export function dwellOf(take: Take): number[] {
  const dwell = take.screens.map(() => 0);
  const marks = [...take.shown].sort((a, b) => a.t - b.t);
  marks.forEach((mark, i) => {
    if (mark.screen === null || mark.screen >= dwell.length) return;
    dwell[mark.screen] += Math.max(0, (marks[i + 1]?.t ?? take.durationMs) - mark.t);
  });
  return dwell;
}

/**
 * The screens of a take nothing was said over (D189): those shown, with whether each was only
 * glanced at, and those the take ended before. In a review where saying nothing means "keep", it
 * is the list of what to keep, and a screen that flashed past is one the author may not have seen.
 */
export function quietOf(
  take: Take,
  known: readonly string[] = [],
): { quiet: { screen: number; glanced: boolean }[]; unseen: number[] } {
  const spoken = new Set(remarksOf(take, known).map((r) => r.screen));
  const seen = new Set(take.shown.flatMap((s) => (s.screen === null ? [] : [s.screen])));
  const dwell = dwellOf(take);
  const quiet: { screen: number; glanced: boolean }[] = [];
  const unseen: number[] = [];
  take.screens.forEach((_, screen) => {
    if (spoken.has(screen)) return;
    if (seen.has(screen)) quiet.push({ screen, glanced: dwell[screen] < GLANCE });
    else unseen.push(screen);
  });
  return { quiet, unseen };
}

const screens = (n: number) => `${n} ${n === 1 ? 'screen' : 'screens'}`;

export const TRANSCRIPT_FILE = 'transcript.md';

/** A take's file beside the notes folder (D183): "pinch-take-2026-11-13-07-37-56.json". */
export const takeFileName = (take: Pick<Take, 'recordedAt'>) =>
  `pinch-take-${take.recordedAt.slice(0, 19).replace(/[T:]/g, '-')}.json`;

const remarkLine = (r: Remark) =>
  `- ${clockText(r.at)} ${r.text}${r.unsure ? ` [${r.unsure}]` : r.kind === 'left' ? ' [Not a note.]' : ''}`;

/** Files as a span: "`sheets/quiet-01.jpg` to `sheets/quiet-08.jpg`", or the one. */
export const filesSpan = (names: readonly string[]) =>
  names.length > 1 ? `\`${names[0]}\` to \`${names[names.length - 1]}\`` : `\`${names[0]}\``;

/** Where the screens nothing was said over can be seen (D193), as a sentence after the count. */
export const drawnOn = (sheets: readonly string[]) =>
  sheets.length ? ` They are drawn small, each with its name, on ${filesSpan(sheets)}.` : '';

/**
 * The takes' words as a file for the package: each screen in the order it was first spoken over,
 * with its remarks and the time of each, then the screens nothing was said over (D189). Empty when
 * nothing was said. With the take's file beside the folder, it ends by naming it (D192): an agent
 * that wanted to trace a note back reported there was nothing to trace it with.
 */
export function transcriptText(
  takes: readonly Take[],
  known: readonly string[] = [],
  {
    takeFiles = false,
    quietSheets = [],
  }: {
    takeFiles?: boolean;
    /** The sheets the screens nothing was said over are drawn on (D193), as the package names them. */
    quietSheets?: readonly string[];
  } = {},
): string {
  const lines: string[] = [];
  const said: Take[] = [];
  for (const take of takes) {
    const remarks = remarksOf(take, known);
    if (!remarks.length) continue;
    said.push(take);
    if (takes.length > 1)
      lines.push('', `## Take recorded ${take.recordedAt.slice(0, 16).replace('T', ' ')}`);
    const shown = new Set(take.shown.flatMap((s) => (s.screen === null ? [] : [s.screen]))).size;
    const order = [...new Set(remarks.map((r) => r.screen))];
    const head = takes.length > 1 ? '###' : '##';
    lines.push('', `${screens(shown)} shown, ${order.length} with something said.`);
    for (const screen of order)
      lines.push(
        '',
        `${head} ${take.screens[screen].name}`,
        '',
        ...remarks.filter((r) => r.screen === screen).map(remarkLine),
      );
    const { quiet, unseen } = quietOf(take, known);
    const glanced = quiet.filter((q) => q.glanced).length;
    // Marked one by one only where some were glanced at and some were not.
    const marked = glanced > 0 && glanced < quiet.length;
    const brief = marked
      ? ` The ${glanced} marked * ${glanced === 1 ? 'was' : 'were'} on show for under half a second.`
      : glanced
        ? ` ${glanced === 1 ? 'It was' : 'All were'} on show for under half a second.`
        : '';
    if (quiet.length)
      lines.push(
        '',
        `${head} Nothing said`,
        '',
        `I said nothing over ${quiet.length === 1 ? 'this screen' : `these ${screens(quiet.length)}`}.${brief}${drawnOn(quietSheets)}`,
        '',
        ...quiet.map((q) => `- ${take.screens[q.screen].name}${marked && q.glanced ? ' *' : ''}`),
      );
    if (unseen.length)
      lines.push(
        '',
        `${head} Never shown`,
        '',
        `The take ended before ${unseen.length === 1 ? 'this screen' : `these ${screens(unseen.length)}`} came up.`,
        '',
        ...unseen.map((screen) => `- ${take.screens[screen].name}`),
      );
  }
  if (!lines.length) return '';
  if (takeFiles)
    lines.push(
      '',
      '## The take',
      '',
      `${said.map((take) => `\`${takeFileName(take)}\``).join(', ')}, beside this folder, has when each word was said, which screen was on show and where the pointer went. Open it only to trace a note that looks wrong.`,
    );
  return [
    '# Everything I said, in order',
    '',
    '`notes.md` is made from this. Where a remark was not made a note, or may not have been taken as I meant, it says so in brackets after the words.',
    ...lines,
    '',
  ].join('\n');
}

/** The remarks to ask about, as lines for the top of the notes: the screen, when, the words, why. */
export function unsureLines(takes: readonly Take[], known: readonly string[] = []): string[] {
  return takes.flatMap((take) =>
    remarksOf(take, known)
      .filter((r) => r.unsure)
      .map(
        (r) =>
          `- \`${take.screens[r.screen].name}\` at ${clockText(r.at)}: "${r.text.replace(/ \([^)]*\)$/, '')}" ${r.unsure}`,
      ),
  );
}

/**
 * A line for the notes on the screens nothing was said over (D189), or nothing when every screen
 * was spoken over or no take said anything: how many, and where they are listed.
 */
export function quietLine(takes: readonly Take[], known: readonly string[] = []): string {
  const said = takes.filter((take) => remarksOf(take, known).length);
  const all = said.map((take) => quietOf(take, known));
  if (!all.some((q) => q.quiet.length || q.unseen.length)) return '';
  if (said.length > 1)
    return `The screens I said nothing over in each take are listed in \`${TRANSCRIPT_FILE}\`.`;
  const [{ quiet, unseen }] = all;
  const shown = new Set(said[0].shown.flatMap((s) => (s.screen === null ? [] : [s.screen]))).size;
  const passed = quiet.length
    ? `I said nothing over ${quiet.length} of the ${screens(shown)} I was shown.`
    : '';
  const missed = unseen.length
    ? `${unseen.length === 1 ? 'One screen was' : `${unseen.length} screens were`} never shown.`
    : '';
  return `${[passed, missed].filter(Boolean).join(' ')} They are listed at the end of \`${TRANSCRIPT_FILE}\`.`;
}
