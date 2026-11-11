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
import { heard, namesOnlyTheScreen, saidSomething, wordsIn } from './voice-notes';
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
    for (const run of runs)
      out.push({
        screen,
        at: run[0].start,
        text: spoken(run),
        kind: 'left',
        ...(saidSomething(run) && { unsure: 'Too short to be a note.' }),
      });
  });
  return out.sort((a, b) => a.at - b.at);
}

export const TRANSCRIPT_FILE = 'transcript.md';

const remarkLine = (r: Remark) =>
  `- ${clockText(r.at)} ${r.text}${r.unsure ? ` [${r.unsure}]` : r.kind === 'left' ? ' [Not a note.]' : ''}`;

/**
 * The takes' words as a file for the package: each screen in the order it was first spoken over,
 * with its remarks and the time of each. Empty when nothing was said.
 */
export function transcriptText(takes: readonly Take[], known: readonly string[] = []): string {
  const lines: string[] = [];
  for (const take of takes) {
    const remarks = remarksOf(take, known);
    if (!remarks.length) continue;
    if (takes.length > 1)
      lines.push('', `## Take recorded ${take.recordedAt.slice(0, 16).replace('T', ' ')}`);
    const shown = new Set(take.shown.flatMap((s) => (s.screen === null ? [] : [s.screen]))).size;
    const order = [...new Set(remarks.map((r) => r.screen))];
    lines.push(
      '',
      `${shown} ${shown === 1 ? 'screen' : 'screens'} shown, ${order.length} with something said.`,
    );
    for (const screen of order)
      lines.push(
        '',
        `${takes.length > 1 ? '###' : '##'} ${take.screens[screen].name}`,
        '',
        ...remarks.filter((r) => r.screen === screen).map(remarkLine),
      );
  }
  if (!lines.length) return '';
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
