import type { Asset } from '@/lib/pin/model';

/*
 * Pinch keeps a session in the browser's IndexedDB: no account, nothing
 * uploaded. Images are stored as Blobs by asset id; the assets and their
 * marks are one record, written after every change.
 */

const DB = 'pin-notes';
const IMAGES = 'images';
const STATE = 'state';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMAGES);
      req.result.createObjectStore(STATE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  act: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = act(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The browser refused to save.'));
  });
}

export const loadAssets = async () =>
  ((await run(STATE, 'readonly', (s) => s.get('assets'))) as Asset[] | undefined) ?? [];

export const saveAssets = (assets: Asset[]) =>
  run(STATE, 'readwrite', (s) => s.put(assets, 'assets'));

export const putImage = (id: string, blob: Blob) =>
  run(IMAGES, 'readwrite', (s) => s.put(blob, id));

export const getImage = (id: string) =>
  run(IMAGES, 'readonly', (s) => s.get(id)) as Promise<Blob | undefined>;

export const deleteImage = (id: string) => run(IMAGES, 'readwrite', (s) => s.delete(id));

export async function clearAll() {
  await run(IMAGES, 'readwrite', (s) => s.clear());
  await run(STATE, 'readwrite', (s) => s.clear());
}
