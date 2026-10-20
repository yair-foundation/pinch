import type { Asset } from '@/lib/pin/model';

/*
 * Pinch keeps a session in the browser's IndexedDB: no account, nothing
 * uploaded. Images are stored as Blobs by asset id; the assets and their
 * marks are one record, written after every change.
 *
 * A browser that blocks IndexedDB (private windows, some policies) gets the
 * same interface over memory: the session then lasts until the tab closes,
 * and `inMemory()` lets the app say so.
 */

const DB = 'pin-notes';
const IMAGES = 'images';
const STATE = 'state';

type Memory = { images: Map<string, Blob>; assets: Asset[]; exported?: string };

let opening: Promise<IDBDatabase> | null = null;
let memory: Memory | null = null;

/** Whether the session lives in memory only, because the browser's storage is unavailable. */
export const inMemory = () => memory !== null;

/** Give up on the browser's storage for this visit and keep everything in memory. */
export function forceMemory() {
  memory ??= { images: new Map(), assets: [] };
}

/** Whether a failure means the browser's storage is full, rather than unavailable. */
export const isQuotaError = (e: unknown) =>
  (e instanceof Error || e instanceof DOMException) &&
  (e.name === 'QuotaExceededError' || /quota/i.test(e.message));

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IMAGES);
        req.result.createObjectStore(STATE);
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

/** The database, or null once storage has fallen back to memory. */
async function db(): Promise<IDBDatabase | null> {
  if (memory) return null;
  try {
    return await open();
  } catch {
    forceMemory();
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

export const loadAssets = async () =>
  ((await run(
    STATE,
    'readonly',
    (s) => s.get('assets'),
    (m) => m.assets,
  )) as Asset[] | undefined) ?? [];

export const saveAssets = (assets: Asset[]) =>
  run(
    STATE,
    'readwrite',
    (s) => s.put(assets, 'assets'),
    (m) => {
      m.assets = assets;
      return 'assets' as IDBValidKey;
    },
  );

/** A mark of the session as last exported (a digest of it), kept beside the assets. */
export const loadExported = async () =>
  ((await run(
    STATE,
    'readonly',
    (s) => s.get('exported'),
    (m) => m.exported,
  )) as string | undefined) || undefined;

export const saveExported = (digest: string) =>
  run(
    STATE,
    'readwrite',
    (s) => s.put(digest, 'exported'),
    (m) => {
      m.exported = digest;
      return 'exported' as IDBValidKey;
    },
  );

export const putImage = (id: string, blob: Blob) =>
  run(
    IMAGES,
    'readwrite',
    (s) => s.put(blob, id),
    (m) => {
      m.images.set(id, blob);
      return id as IDBValidKey;
    },
  );

export const getImage = (id: string) =>
  run(
    IMAGES,
    'readonly',
    (s) => s.get(id),
    (m) => m.images.get(id),
  ) as Promise<Blob | undefined>;

export const deleteImage = (id: string) =>
  run(
    IMAGES,
    'readwrite',
    (s) => s.delete(id),
    (m) => {
      m.images.delete(id);
      return undefined;
    },
  );

export async function clearAll() {
  await run(
    IMAGES,
    'readwrite',
    (s) => s.clear(),
    (m) => {
      m.images.clear();
      return undefined;
    },
  );
  await run(
    STATE,
    'readwrite',
    (s) => s.clear(),
    (m) => {
      m.assets = [];
      return undefined;
    },
  );
}
