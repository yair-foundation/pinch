import {
  type Batch,
  type BatchNote,
  batchFolder,
  type Collection,
  type PackageFile,
  rulesOf,
  rulesText,
} from './learnings';
import { batchNotes, type PinchExport } from './import';
import { assetOf, numberOf } from './library';
import { speaksOfColour, whereWithoutColours } from './mark-words';
import type { Take } from './narration';
import { ASKS_START, asks, KIND_START, kindOf, takesBack } from './note-kind';
import { MARKED_PER_SHEET, markedSheetOf, sheetFile } from './sheet';
import {
  drawnOn,
  purposeOf,
  quietLine,
  quietOf,
  TRANSCRIPT_FILE,
  takeFileName,
  transcriptText,
  unsureLines,
} from './take-transcript';

/*
 * The package an agent gets (D157): the author's words, what they pointed at, and nothing else.
 * In the author's trial this beat the same words in a plain file and beat the package of rules
 * (docs/hand-vs-pinch.md). An agent reads whatever is in the folder, so labels, rules and checks
 * stay out: `rulesPackage` still makes the full backup. The one instruction is the check against
 * these notes (D174), which made screens closer and a generic review made them worse. Pure: the
 * files come in as bytes.
 *
 * A take's Export holds that take alone (D163): nothing is kept between takes. Someone who saved
 * notes or rules before takes them away with `savedPackage` (D164).
 */

/**
 * Whether the words of notes are saved anonymously (D163). Off, nothing of a take leaves the browser
 * for someone not signed in.
 */
export const NOTE_TEXT_SAVED: boolean = false;

/**
 * Whether the reading of notes into rules, and the credits that pay for it, are on the page (D157).
 * Off, they are hidden and nothing is taken away: rules, balances and the agent's tools stay.
 */
export const READING_SHOWN: boolean = false;

export const NOTES_FILE = 'notes.md';

const toTheMinute = (stamp: string) => stamp.slice(0, 16).replace(/[T:]/g, '-');

/** The package's folder, to the minute so that takes can sit side by side: "pinch-notes-2026-11-05-14-32/". */
export const notesPackageRoot = (stamp: string) => `pinch-notes-${toTheMinute(stamp)}/`;

/** The check an agent runs on its own screen before showing it (D174), as a Claude Code sub-agent. */
export const CHECK_FILE = 'pinch-check.md';

/*
 * The check is a file, not only a request: asked in notes.md alone, an agent ran it once in 12
 * builds, and with this file in `.claude/agents/`, 12 times in 12 (docs/taste-harness.md). The first
 * sentence is the one tested; the rest is how the file gets there, and the way without it.
 */
const CHECK_LINE = `Before you show me a screen, draw it and run the pinch-check agent on the drawing, then fix what it finds. If \`.claude/agents/${CHECK_FILE}\` isn't in the project, copy \`${CHECK_FILE}\` from this folder there. Until it runs, have a fresh agent do what that file says, with only my notes and your drawing.`;

/*
 * What the tested check said, with where the notes are made general: takes sit side by side, each
 * in its own folder. Only the notes' words count: a generic review made the screens worse. It runs
 * on Haiku (D178): a tenth of the cost of the builder's model for this step, and no worse. Since
 * D186 it says how far a note carries: on the author's own deck it held a slide to one a
 * two-word note had "approved", and asked for a chart to go as "product UI".
 */
const CHECK_AGENT = `---
name: pinch-check
description: Checks a drawn screen against the designer's Pinch notes, in the folders named pinch-notes-…. Use it every time after drawing a screen, before saying it is done. Give it the path of the drawing.
tools: Read, Glob
model: haiku
---

You check a screen before the designer sees it. Every folder named pinch-notes-… in this project holds what this designer said about screens while pointing at them: each note is tied to a spot, with a close-up and a marked copy. Find them with Glob (\`**/pinch-notes-*/notes.md\`), and open each notes.md and the images it names.

Look at the drawing you were given. Find where it repeats something the designer corrected before, or goes against what they said they like or don't. Only what their notes support. A note is about the thing it was said over: carry it to another element only where that element plainly does the same job on the same kind of screen, and leave it out when you have to argue for the match. A note that only approves a screen ("this is okay") asks for nothing: don't hold another screen to the one it approved. A note too short to say what it means is not evidence. Don't add taste of your own. At most 6, the most important first, or none. For each: the note's folder, number and words, what in the screen, and the change to make.
`;

/*
 * The first line is what the trial's prompt told its builds, which nobody will say in a real
 * project. Marks drawn before D157 are coloured by a label that was often wrong, hence the last.
 */
/*
 * A project with a design system (D179): on made-up and real design systems alike, the takes added
 * to it, and this line kept the agent on its values where a note and a token disagreed.
 */
const DEFER_LINE =
  'Where this project has a design system, use its values, tokens and components as they are; read these notes for how and where to use them, and for what still comes out wrong.';

/*
 * A take can be a work order as well as taste (D189): the author's review of 336 slides was "delete
 * this slide" over some, a change over a few and nothing over the rest, with the rule for reading
 * it said aloud in the first half minute, and the intro spoke only of taste. The lines tested
 * before it stay as they were.
 */
const WORK_LINE =
  'A note that asks for something to be changed or removed is about the screen it is on: where that screen is yours to change, do it there. If my first notes say how to read the rest, such as what I will say for a screen to go, or what it means when I say nothing over one, follow that for every screen.';

/*
 * The first line is the one the trials tested (D157), and stays for a take that says nothing of
 * what it is for. A take whose author said so (D194) opens with their words instead, and is not
 * told it is about designing for them: a review of 220 slides was bad examples to write rules from.
 */
const TASTE_LINE =
  'When you design for me, read all of this first and open the images: it is everything you know about my taste.';

const introOf = (purpose: readonly string[]) => [
  '# My notes on these screenshots',
  '',
  ...(purpose.length
    ? [
        `What these notes are for, as I said it: ${purpose.map((p) => `"${p}"`).join(' ')}`,
        '',
        'Read all of this first and open the images.',
      ]
    : [TASTE_LINE]),
  '',
  WORK_LINE,
  '',
  DEFER_LINE,
  '',
  CHECK_LINE,
  '',
];
/** For notes kept before D166, whose close-ups have the mark drawn on them. */
const MARKS_DRAWN =
  "Each note has a number. Each marked copy has those numbers on the spots I pointed at while saying the notes, and each close-up shows one spot. A mark's colour means nothing.";
/*
 * Since D192 the notes are the notes: a review of 220 slides came to 80,000 characters, over half
 * of them file paths and colours, and its reader had to strip it by script to read it whole. A
 * screen names its marked copy, the one picture every rule it wrote was read from; the screenshot
 * and the close-ups are found by name. A spot's colours are given where the note speaks of colour.
 */
const MARKS_IN_WORDS = [
  "Each note has a number. Each marked copy has those numbers on the spots I pointed at while saying the notes. Under each note is where it is and the text there, and where the note speaks of colour, the spot's main colours; for a point, the colour right under it comes first. A note about the whole screen has no mark, and neither has one I said with nothing pointed at: its words are all that place it. A note that points at several spots has its number on each of them and a line for each, in the order I pointed. A mark's colour means nothing.",
  '',
  'Each screen is named with its marked copy, or with its screenshot where every note on it is about the whole screen. The screenshot without the marks has the marked copy\'s name in `images/`. A close-up of a small spot, bright with the rest dimmed, is in `crops/` under that name with `-note-` and the note\'s number, and `-2`, `-3` for the note\'s further spots; a spot large enough to read on the marked copy has none.',
].join('\n');

/*
 * A long take comes with sheets (D193): its reader drew 134 marked copies eight to a sheet before
 * it could read the notes, and asked for the screens nothing was said over, to learn what passed.
 */
const SHEETS_LINE = `Look at the sheets first: the marked copies drawn small, ${MARKED_PER_SHEET} to a sheet, each screen with its number in the corner and its notes' numbers on their spots. Each screen below says which sheet it is on; open its marked copy to read it closely.`;

/**
 * What the starts of some notes mean (D195), said only where a take has such notes: how many say
 * something is right, how many ask, and that a note taken back says so.
 */
function kindsLine(right: number, asking: number, back: number): string {
  if (!right && !asking && !back) return '';
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    'Most of my notes correct something.',
    right
      ? `${count(right, 'says something is right and begins', 'say something is right and begin')} "${KIND_START.right.trim()}", or "${KIND_START.partly.trim()}" where only some of the note does.`
      : '',
    asking
      ? `${count(asking, 'asks something and begins', 'ask something and begin')} "${ASKS_START.trim()}".`
      : '',
    back ? 'Where I took something back, both notes say so.' : '',
    'Only plain words are caught, so read every note for what it says.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The sheets an export says it drew: the marked copies', and those of the screens nothing was said over. */
function sheetsOf(manifest: unknown): { marked: string[]; quiet: string[] } {
  const sheets = (manifest as { sheets?: { marked?: unknown; quiet?: unknown } } | null)?.sheets;
  const names = (list: unknown) =>
    Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  return { marked: names(sheets?.marked), quiet: names(sheets?.quiet) };
}

/*
 * The remarks that may not have been taken as they were meant (D188), ahead of the notes, so an
 * agent asks about them instead of guessing: a voice tag that took something away, a note too
 * short to mean anything, a sentence said as the reel turned.
 */
const UNSURE = [
  '## Not sure',
  '',
  `These may not have been taken as I meant. If one matters to what you're doing, ask me. Everything I said is in \`${TRANSCRIPT_FILE}\`.`,
  '',
];

/** A note's words, as they were said (D168). Notes kept before that are only known sorted. */
const wordsOf = (n: BatchNote) =>
  (n.spoken?.trim() ||
    [n.works, n.doesNotWork]
      .filter((x) => x.trim())
      .join(' '))
    .replace(/\s*\n\s*/g, ' ');

function manifestOf(found: ReadonlyMap<string, Uint8Array> | null | undefined, b: Batch): unknown {
  const bytes = found?.get(`${b.root}notes.json`);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Every note with its screenshot, marked copy and close-up. `files` is each batch's export read
 * back, by batch id. A note whose files can't be read still goes, as words, and one whose close-up
 * is gone is counted in `missing`.
 */
export function notesPackage(
  c: Collection,
  files: ReadonlyMap<string, ReadonlyMap<string, Uint8Array> | null>,
  stamp: string,
  /** One batch's files at the top of the package, with no folder for the batch. */
  flat = false,
  /** The takes the notes were said in (D188), for their words to go beside the notes. */
  takes: readonly Take[] = [],
): { files: PackageFile[]; notes: number; missing: number } {
  const root = notesPackageRoot(stamp);
  const images: PackageFile[] = [];
  const inWords = c.batches.some((b) => b.notes.some((n) => n.where));
  /** A file of a batch, added to the package: its path there, or null if it can't be read. */
  const placeIn = (i: number, b: Batch) => (path: unknown) => {
    const data = typeof path === 'string' ? files.get(b.id)?.get(b.root + path) : undefined;
    if (!data) return null;
    const name = (flat ? '' : batchFolder(i, b)) + path;
    images.push({ name: root + name, data });
    return name;
  };
  // Each batch's sheets (D193) first: the intro says whether there are any.
  const sheets = c.batches.map((b, i) => {
    const drawn = sheetsOf(manifestOf(files.get(b.id), b));
    const placed = (list: string[]) => list.flatMap((path) => placeIn(i, b)(path) ?? []);
    return { marked: new Set(placed(drawn.marked)), quiet: placed(drawn.quiet) };
  });
  const lines = [...introOf(purposeOf(takes)), inWords ? MARKS_IN_WORDS : MARKS_DRAWN];
  if (sheets.some((s) => s.marked.size)) lines.push('', SHEETS_LINE);
  // Only a note said aloud, with its words kept as they were said, is read for what it is (D195).
  const read = (n: BatchNote) => (inWords && n.spoken?.trim() ? wordsOf(n) : '');
  /** The note a note takes back: the one said before it on its screen, by its number there. */
  const before = new Map<BatchNote, BatchNote>();
  for (const b of c.batches) {
    const last = new Map<string, BatchNote>();
    for (const n of b.notes) {
      const prev = last.get(numberOf(n.ref));
      if (prev && takesBack(read(n))) before.set(n, prev);
      last.set(numberOf(n.ref), n);
    }
  }
  const after = new Map([...before].map(([n, prev]) => [prev, n]));
  const aloud = c.batches.flatMap((b) => b.notes.map(read)).filter(Boolean);
  const kinds = kindsLine(
    aloud.filter((w) => kindOf(w)).length,
    aloud.filter((w) => !kindOf(w) && asks(w)).length,
    before.size,
  );
  if (kinds) lines.push('', kinds);
  const quiet = quietLine(takes);
  const quietSheets = sheets.flatMap((s) => s.quiet);
  const quietCount = takes.reduce((n, t) => n + quietOf(t).quiet.length, 0);
  if (quiet) lines.push('', quiet + drawnOn(quietSheets, quietCount));
  const unsure = unsureLines(takes);
  if (unsure.length) lines.push('', ...UNSURE, ...unsure);
  let notes = 0;
  let missing = 0;
  for (const [i, b] of c.batches.entries()) {
    const found = files.get(b.id);
    const manifest = manifestOf(found, b);
    const place = placeIn(i, b);
    const assets = (manifest as { assets?: unknown } | null)?.assets;
    const numbers = Array.isArray(assets)
      ? assets.map((a) => (a as { number?: unknown } | null)?.number)
      : [];
    /** The sheet a screen is on, as the package names it, or nothing. */
    const sheetOf = (number: string) => {
      const page = markedSheetOf(numbers.indexOf(number), numbers.length);
      const name = page === null ? '' : (flat ? '' : batchFolder(i, b)) + sheetFile('marked', page);
      return sheets[i].marked.has(name) ? `, on \`${name}\`` : '';
    };
    const screens = new Map<string, BatchNote[]>();
    for (const n of b.notes) {
      const number = numberOf(n.ref);
      screens.set(number, [...(screens.get(number) ?? []), n]);
    }
    for (const [number, list] of screens) {
      const asset = assetOf(manifest, number);
      const image = place(asset?.image);
      // With every note about the whole screen, the marked copy is the screenshot again (D188).
      const marked = list.every((n) => n.whole) ? null : place(asset?.marked);
      const about = [
        list[0].source === 'ours' ? 'My own work.' : '',
        list[0].screenTag ? `Tag: ${list[0].screenTag}` : '',
        // In words, the marked copy alone: the screenshot has its name (D192).
        image && !(inWords && marked) ? `Screenshot: \`${image}\`${sheetOf(number)}` : '',
        marked ? `Marked copy: \`${marked}\`${sheetOf(number)}` : '',
      ].filter(Boolean);
      lines.push('', `## ${list[0].image}`, '', ...about, ...(about.length ? [''] : []));
      for (const n of list) {
        // A close-up for each small spot the note points at (D190, D193), none for the whole
        // screen (D188) or for a spot large enough to read on the marked copy.
        const crops = n.whole
          ? []
          : [n, ...(n.also ?? [])].filter((p) => !p.large).map((p) => place(p.crop));
        missing += crops.filter((c) => !c).length;
        // In words, a close-up is found by its note's number, not listed (D192).
        const shown = inWords ? [] : crops.flatMap((c) => (c ? [`\`${c}\``] : []));
        const words = wordsOf(n);
        const where = (line: string) => (speaksOfColour(words) ? line : whereWithoutColours(line));
        // What it is, where its words say so plainly (D195): right, partly right, or a question.
        const kind = kindOf(read(n));
        const start = kind ? KIND_START[kind] : asks(read(n)) ? ASKS_START : '';
        const numberIn = (other: BatchNote) => other.ref.split('.')[1];
        notes++;
        lines.push(
          `- ${numberIn(n)}. ${shown.length ? `(${shown.join(', ')}) ` : ''}${n.best ? 'My best example: ' : ''}${start}${words}`,
        );
        if (n.where) lines.push(`  ${where(n.where)}`);
        for (const p of n.also ?? [])
          if (p.where) lines.push(`  ${where(p.where).replace(/^Where:/, 'Also:')}`);
        const back = before.get(n);
        if (back) lines.push(`  This takes back some of note ${numberIn(back)}.`);
        const taken = after.get(n);
        if (taken) lines.push(`  I took some of this back in note ${numberIn(taken)}.`);
      }
    }
  }
  const text = new TextEncoder().encode(`${lines.join('\n')}\n`);
  const check = { name: root + CHECK_FILE, data: new TextEncoder().encode(CHECK_AGENT) };
  const said = transcriptText(takes, [], { takeFiles: true, quietSheets });
  const transcript = said
    ? [{ name: root + TRANSCRIPT_FILE, data: new TextEncoder().encode(said) }]
    : [];
  return {
    // Each take goes beside the folder (D183), where the transcript says it is (D192).
    files: [
      { name: root + NOTES_FILE, data: text },
      check,
      ...transcript,
      ...images,
      ...takes.map(takeFile),
    ],
    notes,
    missing,
  };
}

/** A take's package (D163): its export, read back, as the only thing in it. */
export function takePackage(
  exp: PinchExport,
  files: ReadonlyMap<string, Uint8Array>,
  stamp: string,
  takes: readonly Take[] = [],
): { files: PackageFile[]; notes: number; missing: number } {
  const batch: Batch = {
    id: 'take',
    name: 'take',
    addedAt: stamp,
    exportedAt: exp.exportedAt,
    root: exp.root,
    images: exp.assets.length,
    notes: batchNotes(exp),
  };
  const take: Collection = {
    id: 'take',
    name: 'take',
    createdAt: stamp,
    updatedAt: stamp,
    batches: [batch],
    rules: [],
    read: [],
  };
  return notesPackage(take, new Map([[batch.id, files]]), stamp, true, takes);
}

/**
 * A take beside the notes folder (D183): the pointer's path, when each screen was shown and the
 * timed words, as the browser kept them, with no audio. It sits beside the folder, as the rules
 * file does (D164), so an agent reading the folder doesn't open it by the way; the transcript's
 * last lines say where it is (D192). It is what the placing of notes is checked and tuned
 * against: `scripts/replay-take.ts` runs it through `applyTake` again.
 */
export const takeFile = (take: Take): PackageFile => ({
  name: takeFileName(take),
  data: new TextEncoder().encode(JSON.stringify(take)),
});

/** Whether a collection holds anything `savedPackage` would give. */
export const hasSaved = (c: Collection) =>
  c.batches.some((b) => b.notes.length > 0) || rulesOf(c).length > 0;

/**
 * What someone who saved notes or rules before takes away (D164): the notes as the package an agent
 * gets, and the rules in a file beside its folder, because an agent reads whatever is in the folder.
 */
export function savedPackage(
  c: Collection,
  files: ReadonlyMap<string, ReadonlyMap<string, Uint8Array> | null>,
  stamp: string,
): { files: PackageFile[]; notes: number; rules: number; missing: number } {
  const made = notesPackage(c, files, stamp);
  const rules = rulesOf(c);
  const text = new TextEncoder().encode(`${rulesText(c, rules)}\n`);
  return {
    ...made,
    files: [
      ...(made.notes ? made.files : []),
      ...(rules.length ? [{ name: `pinch-rules-${toTheMinute(stamp)}.md`, data: text }] : []),
    ],
    rules: rules.length,
  };
}
