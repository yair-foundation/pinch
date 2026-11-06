import { type Collection, mergeCollection, upgradeCollection } from '@/lib/pin/learnings';
import { hasSaved, savedPackage } from '@/lib/pin/notes-package';
import { unzip } from '@/lib/pin/unzip';
import type { CollectionsBackend } from './collections-backend';

/*
 * Notes and rules saved before Pinch became export-only (D163, D164). Nothing new is kept and the
 * page that showed them is gone: their owner gets one export, read from wherever they are, the
 * account and this browser alike. Nothing here deletes or moves anything.
 */

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');

/** Everything saved in these places as one collection, or null when there is nothing to export. */
export async function readSaved(places: CollectionsBackend[]): Promise<Collection | null> {
  const lists = await Promise.all(places.map((p) => p.list()));
  const [first, ...rest] = lists
    .flat()
    .map((c) => upgradeCollection(c, newId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!first) return null;
  const now = new Date().toISOString();
  const one = rest.reduce((into, c) => mergeCollection(into, c, now), first);
  return hasSaved(one) ? one : null;
}

async function batchFiles(places: CollectionsBackend[], id: string) {
  for (const place of places) {
    const blob = await place.getBatch(id).catch(() => undefined);
    if (blob) return unzip(await blob.arrayBuffer());
  }
  return null;
}

/** The zip's files for all of it, or null when there is nothing to export. */
export async function savedNotesPackage(
  places: CollectionsBackend[],
  onProgress: (done: number, total: number) => void,
) {
  const saved = await readSaved(places);
  if (!saved) return null;
  const found = new Map<string, Map<string, Uint8Array> | null>();
  for (const [i, b] of saved.batches.entries()) {
    onProgress(i + 1, saved.batches.length);
    found.set(b.id, await batchFiles(places, b.id).catch(() => null));
  }
  return savedPackage(saved, found, new Date().toISOString());
}
