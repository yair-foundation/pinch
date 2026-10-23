import { z } from 'zod';
import { sniffImage } from '@/lib/image';
import type { BatchNote } from './learnings';
import { type Asset, cleanScreenTag, type Mark, SOURCES, type SourceKind, sortTopics } from './model';

/*
 * Reading a Pinch export back: its `notes.json` (version 2) says which image
 * each note is on, where, and what it says, so the export is also the way to
 * carry a batch to another browser and the way a collection keeps a batch.
 * Only what the app itself writes is read; anything else in the folder is
 * ignored. Pure: the files come in as bytes (`unzip.ts`), ids from the caller.
 */

const unit = z.number().min(0).max(1);
const shapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dot'), x: unit, y: unit }),
  z.object({ kind: z.literal('area'), x: unit, y: unit, w: unit, h: unit }),
  z.object({ kind: z.literal('arrow'), x: unit, y: unit, x2: unit, y2: unit }),
]);
const use = z.enum(['as-is', 'edited']);
const noteSchema = z.object({
  number: z.number().int().positive(),
  label: z.string().max(200).optional(),
  works: z.string().max(5000).default(''),
  doesNotWork: z.string().max(5000).default(''),
  best: z.boolean().optional(),
  topics: z.array(z.string().max(40)).max(20).optional(),
  shape: shapeSchema,
  crop: z.string().max(300),
  aiSuggested: z.object({ works: use.optional(), doesNotWork: use.optional() }).optional(),
});
const assetSchema = z.object({
  number: z.string().max(4),
  name: z.string().max(300),
  image: z.string().max(300),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  note: z.string().max(10000).optional(),
  source: z
    .object({ kind: z.enum(SOURCES.map((s) => s.kind) as [SourceKind, ...SourceKind[]]) })
    .nullable()
    .optional(),
  tag: z.string().max(200).optional().catch(undefined),
  notes: z.array(noteSchema).max(500),
});
export const exportSchema = z.object({
  tool: z.literal('Pinch'),
  version: z.literal(2),
  exportedAt: z.string().max(40),
  assets: z.array(assetSchema).max(1000),
});

export type PinchExport = z.infer<typeof exportSchema> & {
  /** The folder the export sits in inside the zip, with its slash: "pinch-2026-10-20/". */
  root: string;
};

/** The export in a zip's files, or an error that says why it isn't one. */
export function readExport(files: Map<string, Uint8Array>): PinchExport {
  // The notes.json nearest the top: a folder zipped again may sit one level deeper.
  const key = [...files.keys()]
    .filter((k) => k === 'notes.json' || k.endsWith('/notes.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!key) throw new Error('It has no notes.json, so it isn’t a Pinch export.');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(files.get(key)));
  } catch {
    throw new Error('Its notes.json can’t be read.');
  }
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) throw new Error('Its notes.json isn’t one this version of Pinch reads.');
  return { ...parsed.data, root: key.slice(0, -'notes.json'.length) };
}

/** A note of the export as a mark of the app. Accepted suggestions kept as is stay marked so. */
function markOf(n: PinchExport['assets'][number]['notes'][number], id: string): Mark {
  const topics = sortTopics(n.topics ?? []);
  const accepted = {
    ...(n.aiSuggested?.works === 'as-is' && n.works.trim() ? { good: n.works } : {}),
    ...(n.aiSuggested?.doesNotWork === 'as-is' && n.doesNotWork.trim()
      ? { bad: n.doesNotWork }
      : {}),
  };
  return {
    id,
    shape: n.shape,
    label: n.label ?? '',
    good: n.works,
    bad: n.doesNotWork,
    origin: 'user',
    ...(n.best && n.works.trim() ? { best: true } : {}),
    ...(topics.length ? { topics } : {}),
    ...(accepted.good || accepted.bad ? { accepted } : {}),
  };
}

export type ImportedAsset = { asset: Asset; image: Blob };

/**
 * The export's images with their notes, as the app's assets: new ids, the
 * image's own file (its type read from its bytes), and every note as a mark.
 * An image whose file is missing or isn't an image is left out and counted.
 */
export function assetsOf(
  exp: PinchExport,
  files: Map<string, Uint8Array>,
  newId: () => string,
): { assets: ImportedAsset[]; missing: number } {
  const assets: ImportedAsset[] = [];
  let missing = 0;
  for (const a of exp.assets) {
    const bytes = files.get(exp.root + a.image);
    const type = bytes && sniffImage(bytes);
    if (!bytes || !type) {
      missing++;
      continue;
    }
    const asset: Asset = {
      id: newId(),
      name: a.name,
      type,
      width: a.width,
      height: a.height,
      note: a.note ?? '',
      marks: a.notes.map((n) => markOf(n, newId())),
      ...(a.source ? { source: { kind: a.source.kind } } : {}),
      ...(cleanScreenTag(a.tag) ? { screenTag: cleanScreenTag(a.tag) } : {}),
    };
    assets.push({ asset, image: new Blob([bytes as BlobPart], { type }) });
  }
  return { assets, missing };
}

/** The export's notes as a collection keeps them. */
export const batchNotes = (exp: PinchExport): BatchNote[] =>
  exp.assets.flatMap((a) =>
    a.notes.map((n) => ({
      ref: `${a.number}.${n.number}`,
      image: a.name,
      source: a.source?.kind ?? null,
      topics: sortTopics(n.topics ?? []),
      works: n.works.trim(),
      doesNotWork: n.doesNotWork.trim(),
      ...(n.label?.trim() ? { label: n.label.trim() } : {}),
      ...(cleanScreenTag(a.tag) ? { screenTag: cleanScreenTag(a.tag) } : {}),
      crop: n.crop,
      ...(n.best && n.works.trim() ? { best: true as const } : {}),
    })),
  );
