import {
  type Batch,
  type BatchNote,
  type Collection,
  noteKey,
  withoutBatch,
} from './learnings';
import { cleanScreenTag, SHEET_FILE, type SourceKind } from './model';
import { screenGroup } from './screen-index';
import type { ZipEntry } from './zip';

/*
 * The library of references (D124): every screenshot the author has noted, across their
 * batches, as one pool to browse, sort by product and source, retag and prune. A reference is
 * one image of one batch, by its number there ("02"), with the notes written on it and the rules
 * they feed. Its picture is the batch export's marked copy, read from the zip Your rules already
 * opens for the close-ups. Removing one takes its notes, the rules that came from them alone, and
 * its files from the batch's zip; the batch's last one takes the batch (D115). Pure.
 */

export type Reference = {
  /** `batch/02`. */
  key: string;
  batch: Batch;
  /** Its number in the batch's export: "02". */
  number: string;
  /** The image's file name. */
  image: string;
  source: SourceKind | null;
  /** Its screen tag (a product, a feature), as written on its notes; empty when none. */
  tag: string;
  notes: BatchNote[];
  /** Rules drawing on its notes. */
  rules: number;
  /** Its notes not read into rules yet. */
  unread: number;
  /** Whether one of its notes is a best example (D108). */
  best: boolean;
};

export const numberOf = (ref: string) => ref.split('.')[0];

/** Every reference, the newest batch first, each batch's in its order. */
export function referencesOf(c: Collection): Reference[] {
  const read = new Set(c.read);
  const live = c.rules.filter((r) => r.status !== 'dismissed' && !r.locked);
  const batches = [...c.batches].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return batches.flatMap((batch) => {
    const by = new Map<string, BatchNote[]>();
    for (const n of batch.notes) by.set(numberOf(n.ref), [...(by.get(numberOf(n.ref)) ?? []), n]);
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([number, notes]) => {
        const keys = new Set(notes.map((n) => noteKey({ batchId: batch.id, note: n.ref })));
        return {
          key: `${batch.id}/${number}`,
          batch,
          number,
          image: notes[0].image,
          source: notes.find((n) => n.source)?.source ?? null,
          tag: cleanScreenTag(notes.find((n) => cleanScreenTag(n.screenTag))?.screenTag),
          notes,
          rules: live.filter((r) => r.evidence.some((e) => keys.has(noteKey(e)))).length,
          unread: [...keys].filter((k) => !read.has(k)).length,
          best: notes.some((n) => n.best),
        };
      });
  });
}

/** What the library shows: one product (its tag, or '' for untagged), one source, or all. */
export type LibraryFilter = { tag?: string; source?: SourceKind | 'none' };

export function filterReferences(list: Reference[], f: LibraryFilter): Reference[] {
  return list.filter(
    (r) =>
      (f.tag === undefined ||
        (f.tag === '' ? !r.tag : r.tag && screenGroup(r.tag) === screenGroup(f.tag))) &&
      (f.source === undefined || (f.source === 'none' ? !r.source : r.source === f.source)),
  );
}

const isOf = (batchId: string, number: string) => (b: Batch, n: BatchNote) =>
  b.id === batchId && numberOf(n.ref) === number;

/** The collection with a reference's screen tag written on all its notes, or taken off. */
export function withReferenceTag(
  c: Collection,
  batchId: string,
  number: string,
  tag: string,
  now: string,
): Collection {
  const of = isOf(batchId, number);
  const clean = cleanScreenTag(tag);
  return {
    ...c,
    updatedAt: now,
    batches: c.batches.map((b) =>
      b.id !== batchId
        ? b
        : {
            ...b,
            notes: b.notes.map((n) => {
              if (!of(b, n)) return n;
              const { screenTag: _, ...rest } = n;
              return clean ? { ...rest, screenTag: clean } : rest;
            }),
          },
    ),
  };
}

/** What removing a reference takes with it, for the author to confirm. */
export function referenceReach(c: Collection, batchId: string, number: string) {
  const gone = goneKeys(c, batchId, number);
  const live = c.rules.filter((r) => r.status !== 'dismissed' && !r.locked);
  const alone = live.filter(
    (r) => r.evidence.length && r.evidence.every((e) => gone.has(noteKey(e))),
  ).length;
  const fewer = live.filter(
    (r) =>
      r.evidence.some((e) => gone.has(noteKey(e))) &&
      !r.evidence.every((e) => gone.has(noteKey(e))),
  ).length;
  const batch = c.batches.find((b) => b.id === batchId);
  const last = !batch?.notes.some((n) => numberOf(n.ref) !== number);
  return { notes: gone.size, rules: alone, fewer, last };
}

const goneKeys = (c: Collection, batchId: string, number: string) =>
  new Set(
    (c.batches.find((b) => b.id === batchId)?.notes ?? [])
      .filter((n) => numberOf(n.ref) === number)
      .map((n) => noteKey({ batchId, note: n.ref })),
  );

/**
 * The collection without a reference: its notes, the rules drawn from them alone, and their
 * place in the rest. The batch's last reference takes the batch, as removing it would.
 */
export function withoutReference(
  c: Collection,
  batchId: string,
  number: string,
  now: string,
): Collection {
  const { last } = referenceReach(c, batchId, number);
  if (last) return withoutBatch(c, batchId, now);
  const gone = goneKeys(c, batchId, number);
  if (!gone.size) return c;
  const alone = new Set(
    c.rules
      .filter((r) => !r.taste && r.evidence.length && r.evidence.every((e) => gone.has(noteKey(e))))
      .map((r) => r.id),
  );
  return {
    ...c,
    updatedAt: now,
    batches: c.batches.map((b) =>
      b.id !== batchId
        ? b
        : {
            ...b,
            images: Math.max(0, b.images - 1),
            notes: b.notes.filter((n) => numberOf(n.ref) !== number),
          },
    ),
    read: c.read.filter((k) => !gone.has(k)),
    rules: c.rules.flatMap((r) => {
      if (alone.has(r.id)) return [];
      const evidence = r.evidence.filter((e) => !gone.has(noteKey(e)));
      const pullGone = r.conflict !== undefined && alone.has(r.conflict.ruleId);
      if (evidence.length === r.evidence.length && !pullGone) return [r];
      const { conflict, ...rest } = r;
      return [{ ...rest, evidence, ...(conflict && !pullGone ? { conflict } : {}) }];
    }),
  };
}

type ManifestAsset = { number?: unknown; marked?: unknown; image?: unknown; width?: unknown; height?: unknown };

/** An asset of a batch's `notes.json`, by its number. */
export function assetOf(manifest: unknown, number: string): ManifestAsset | undefined {
  const assets = (manifest as { assets?: unknown })?.assets;
  return Array.isArray(assets)
    ? (assets.find((a) => a && (a as ManifestAsset).number === number) as ManifestAsset | undefined)
    : undefined;
}

/** A reference's marked copy inside the zip, with the screenshot's size when it is known. */
export function markedOf(
  manifest: unknown,
  root: string,
  number: string,
): { path: string; width?: number; height?: number } | null {
  const a = assetOf(manifest, number);
  if (typeof a?.marked !== 'string') return null;
  const size = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  return { path: root + a.marked, width: size(a.width), height: size(a.height) };
}

/**
 * A batch's zip without one reference: its image, marked copy and close-ups gone, its entry gone
 * from `notes.json`, and the contact sheet, which drew it, gone too.
 */
export function zipWithout(
  files: ReadonlyMap<string, Uint8Array>,
  root: string,
  number: string,
): ZipEntry[] {
  const raw = files.get(`${root}notes.json`);
  let manifest: { assets?: unknown[] } | null = null;
  try {
    manifest = raw ? JSON.parse(new TextDecoder().decode(raw)) : null;
  } catch {
    manifest = null;
  }
  const a = assetOf(manifest, number);
  const stem = typeof a?.marked === 'string' ? a.marked.replace(/^marked\//, '').replace(/\.jpg$/, '') : '';
  const own = (path: string) =>
    Boolean(stem) &&
    (path === `${root}marked/${stem}.jpg` ||
      path.startsWith(`${root}images/${stem}.`) ||
      path.startsWith(`${root}crops/${stem}-note-`));
  const out: ZipEntry[] = [];
  for (const [name, data] of files) {
    if (own(name) || name === `${root}${SHEET_FILE}`) continue;
    if (name === `${root}notes.json` && manifest && Array.isArray(manifest.assets))
      out.push({
        name,
        data: new TextEncoder().encode(
          JSON.stringify({ ...manifest, assets: manifest.assets.filter((x) => x !== a) }, null, 2),
        ),
      });
    else out.push({ name, data });
  }
  return out;
}
