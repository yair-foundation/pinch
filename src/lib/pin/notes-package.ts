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

/*
 * The package an agent gets (D157): the author's words, what they pointed at, and nothing else.
 * In the author's trial this beat the same words in a plain file and beat the package of rules
 * (docs/hand-vs-pinch.md). An agent reads whatever is in the folder, so labels, rules, checks and
 * instructions stay out: `rulesPackage` still makes the full backup. Pure: the files come in as
 * bytes.
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

/*
 * The first line is what the trial's prompt told its builds, which nobody will say in a real
 * project. Marks drawn before D157 are coloured by a label that was often wrong, hence the last.
 */
const INTRO = [
  '# My notes on these screenshots',
  '',
  'When you design for me, read all of this first and open the images: it is everything you know about my taste.',
  '',
  "Each note has a number. Each marked copy has those numbers on the spots I pointed at while saying the notes, and each close-up shows one spot. A mark's colour means nothing.",
];

/** A note's words, as they were said. */
const wordsOf = (n: BatchNote) =>
  [n.works, n.doesNotWork]
    .filter((x) => x.trim())
    .join(' ')
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
): { files: PackageFile[]; notes: number; missing: number } {
  const root = notesPackageRoot(stamp);
  const images: PackageFile[] = [];
  const lines = [...INTRO];
  let notes = 0;
  let missing = 0;
  for (const [i, b] of c.batches.entries()) {
    const found = files.get(b.id);
    const manifest = manifestOf(found, b);
    /** A file of this batch, added to the package: its path there, or null if it can't be read. */
    const place = (path: unknown) => {
      const data = typeof path === 'string' ? found?.get(b.root + path) : undefined;
      if (!data) return null;
      const name = (flat ? '' : batchFolder(i, b)) + path;
      images.push({ name: root + name, data });
      return name;
    };
    const screens = new Map<string, BatchNote[]>();
    for (const n of b.notes) {
      const number = numberOf(n.ref);
      screens.set(number, [...(screens.get(number) ?? []), n]);
    }
    for (const [number, list] of screens) {
      const asset = assetOf(manifest, number);
      const image = place(asset?.image);
      const marked = place(asset?.marked);
      const about = [
        list[0].source === 'ours' ? 'My own work.' : '',
        list[0].screenTag ? `Tag: ${list[0].screenTag}` : '',
        image ? `Screenshot: \`${image}\`` : '',
        marked ? `Marked copy: \`${marked}\`` : '',
      ].filter(Boolean);
      lines.push('', `## ${list[0].image}`, '', ...about, ...(about.length ? [''] : []));
      for (const n of list) {
        const crop = place(n.crop);
        if (!crop) missing++;
        notes++;
        lines.push(
          `- ${n.ref.split('.')[1]}. ${crop ? `(\`${crop}\`) ` : ''}${n.best ? 'My best example: ' : ''}${wordsOf(n)}`,
        );
      }
    }
  }
  const text = new TextEncoder().encode(`${lines.join('\n')}\n`);
  return { files: [{ name: root + NOTES_FILE, data: text }, ...images], notes, missing };
}

/** A take's package (D163): its export, read back, as the only thing in it. */
export function takePackage(
  exp: PinchExport,
  files: ReadonlyMap<string, Uint8Array>,
  stamp: string,
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
  return notesPackage(take, new Map([[batch.id, files]]), stamp, true);
}

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
