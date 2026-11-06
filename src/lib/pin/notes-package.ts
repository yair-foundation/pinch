import {
  type Batch,
  type BatchNote,
  batchFolder,
  type Collection,
  type PackageFile,
} from './learnings';
import { assetOf, numberOf } from './library';

/*
 * The package an agent gets (D157): the author's words, what they pointed at, and nothing else.
 * In the author's trial this beat the same words in a plain file and beat the package of rules
 * (docs/hand-vs-pinch.md). An agent reads whatever is in the folder, so labels, rules, checks and
 * instructions stay out: `rulesPackage` still makes the full backup. Pure: the files come in as
 * bytes.
 */

/**
 * Whether the reading of notes into rules, and the credits that pay for it, are on the page (D157).
 * Off, they are hidden and nothing is taken away: rules, balances and the agent's tools stay.
 */
export const READING_SHOWN: boolean = false;

export const NOTES_FILE = 'notes.md';

/** The package's folder: "pinch-notes-2026-11-05/". */
export const notesPackageRoot = (stamp: string) => `pinch-notes-${stamp.slice(0, 10)}/`;

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
      const name = batchFolder(i, b) + path;
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
