import type { Collection } from '@/lib/pin/learnings';

/*
 * Collections live in their own IndexedDB database, beside the session's
 * (`pin-notes`, `store.ts`), so adding them changed nothing a saved session
 * depends on. Each collection is one record; each batch's export zip is kept
 * by the batch's id, so it can be opened again and its close-ups shown. Like
 * the session, nothing here leaves the browser.
 *
 * A browser that blocks IndexedDB gets the same interface over memory, and
 * `inMemory()` lets the page say so.
 */

const DB = 'pinch-collections';
const COLLECTIONS = 'collections';
const BATCHES = 'batches';

type Memory = { collections: Map<string, Collection>; batches: Map<string, Blob> };

let opening: Promise<IDBDatabase> | null = null;
let memory: Memory | null = null;

export const inMemory = () => memory !== null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(COLLECTIONS);
        req.result.createObjectStore(BATCHES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The browser’s storage is in use elsewhere.'));
    } catch (e) {
      reject(e);
    }
  });
  return opening;
}

async function db(): Promise<IDBDatabase | null> {
  if (memory) return null;
  try {
    return await open();
  } catch {
    memory = { collections: new Map(), batches: new Map() };
    return null;
  }
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  act: (s: IDBObjectStore) => IDBRequest<T>,
  fallback: (m: Memory) => T,
) {
  const d = await db();
  if (!d) return fallback(memory as Memory);
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = act(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The browser refused to save.'));
  });
}

/** Every collection, the most recently changed first. */
export async function listCollections(): Promise<Collection[]> {
  const all = (await run(
    COLLECTIONS,
    'readonly',
    (s) => s.getAll(),
    (m) => [...m.collections.values()],
  )) as Collection[];
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const saveCollection = (c: Collection) =>
  run(
    COLLECTIONS,
    'readwrite',
    (s) => s.put(c, c.id),
    (m) => {
      m.collections.set(c.id, c);
      return c.id as IDBValidKey;
    },
  );

export const putBatch = (id: string, zip: Blob) =>
  run(
    BATCHES,
    'readwrite',
    (s) => s.put(zip, id),
    (m) => {
      m.batches.set(id, zip);
      return id as IDBValidKey;
    },
  );

export const getBatch = (id: string) =>
  run(
    BATCHES,
    'readonly',
    (s) => s.get(id),
    (m) => m.batches.get(id),
  ) as Promise<Blob | undefined>;

export const deleteBatch = (id: string) =>
  run(
    BATCHES,
    'readwrite',
    (s) => s.delete(id),
    (m) => {
      m.batches.delete(id);
      return undefined;
    },
  );

/** A collection and every batch it holds. */
export async function deleteCollection(c: Collection) {
  for (const b of c.batches) await deleteBatch(b.id);
  await run(
    COLLECTIONS,
    'readwrite',
    (s) => s.delete(c.id),
    (m) => {
      m.collections.delete(c.id);
      return undefined;
    },
  );
}
