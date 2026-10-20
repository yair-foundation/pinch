import type { Collection } from '@/lib/pin/learnings';

/*
 * Where collections are kept: in this browser (`collections-store.ts`), or in
 * the signed-in account (`cloud-store.ts`, D79). The collections view works
 * the same on either; it only says which.
 */
export type CollectionsBackend = {
  kind: 'browser' | 'account';
  list(): Promise<Collection[]>;
  save(c: Collection): Promise<void>;
  /** The collection and every batch it holds. */
  remove(c: Collection): Promise<void>;
  /** A batch's export zip, by the batch's id. */
  putBatch(id: string, zip: Blob): Promise<void>;
  getBatch(id: string): Promise<Blob | undefined>;
  deleteBatch(id: string): Promise<void>;
};
