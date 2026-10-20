import { del, issueSignedToken, presignUrl } from '@vercel/blob';
import { userFolder } from './account';
import { readZipEntries, TAIL_BYTES } from './pin/zip-range';
import { deleteDocuments, hasBlob, listDocuments, putDocument, readDocument } from './blob-doc';

/*
 * An account's collections in the private Blob store (D81): each collection
 * is one JSON document, `pinch-users/<account>/collections/<id>.json`, and
 * each batch's export is one zip, `pinch-users/<account>/batches/<id>.zip`.
 * Zips are tens of megabytes, more than a function passes, so the browser
 * moves them straight to and from the store on short-lived presigned URLs,
 * scoped to one path. Without Blob credentials (local runs) the zips live in
 * this process's memory and go through the route instead.
 */

export const MAX_COLLECTION_BYTES = 3_000_000;
export const MAX_BATCH_BYTES = 300 * 1024 * 1024;
/** Zips kept in memory when there is no store (local runs): smaller, and lost on restart. */
export const MAX_MEMORY_BATCH_BYTES = 60 * 1024 * 1024;
const URL_MINUTES = 15;

/** Ids are the app's own: lower-case letters and digits. Anything else never reaches a path. */
export const validId = (id: string) => /^[a-z0-9]{6,40}$/.test(id);

export const collectionKey = (user: string, id: string) =>
  `${userFolder(user)}collections/${id}.json`;
export const batchKey = (user: string, id: string) => `${userFolder(user)}batches/${id}.zip`;

/** Whether an upload's path is one of this account's batch zips. */
export function ownBatchPath(user: string, pathname: string): boolean {
  const prefix = `${userFolder(user)}batches/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith('.zip')) return false;
  return validId(pathname.slice(prefix.length, -'.zip'.length));
}

export async function listCollections(user: string): Promise<unknown[]> {
  const keys = await listDocuments(`${userFolder(user)}collections/`);
  const docs = await Promise.all(keys.map(async (k) => (await readDocument<unknown>(k, null)).doc));
  return docs.filter(Boolean);
}

export const saveCollection = (user: string, id: string, doc: unknown) =>
  putDocument(collectionKey(user, id), doc);

/** The collection's document, and the zips of the batches it names. */
export async function deleteCollection(user: string, id: string) {
  const { doc } = await readDocument<{ batches?: { id?: unknown }[] } | null>(
    collectionKey(user, id),
    null,
  );
  const batchIds = (doc?.batches ?? [])
    .map((b) => (typeof b.id === 'string' ? b.id : ''))
    .filter(validId);
  for (const b of batchIds) await deleteBatch(user, b);
  await deleteDocuments([collectionKey(user, id)]);
}

const memory = new Map<string, Uint8Array>();

export async function deleteBatch(user: string, id: string) {
  if (!hasBlob()) {
    memory.delete(batchKey(user, id));
    return;
  }
  await del(batchKey(user, id)).catch(() => undefined);
}

export const memoryBatch = {
  put: (user: string, id: string, bytes: Uint8Array) => memory.set(batchKey(user, id), bytes),
  get: (user: string, id: string) => memory.get(batchKey(user, id)),
};

/** A URL the browser can fetch the batch's zip from for the next few minutes. */
export async function batchDownloadUrl(user: string, id: string): Promise<string> {
  const pathname = batchKey(user, id);
  const validUntil = Date.now() + URL_MINUTES * 60_000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil,
    useCache: false,
  });
  return presignedUrl;
}

/** The signed token an upload of one batch zip needs: put only, that path only, zips only. */
export const uploadToken = (pathname: string) =>
  issueSignedToken({
    pathname,
    operations: ['put'],
    validUntil: Date.now() + URL_MINUTES * 60_000,
    allowedContentTypes: ['application/zip'],
    maximumSizeInBytes: MAX_BATCH_BYTES,
  });

/**
 * Some files of one of the account's batch zips (D94), read by byte ranges: from the store on a
 * presigned URL when it takes ranges (the whole zip once when it doesn't), from memory locally.
 * An empty map when the batch isn't there.
 */
export async function batchFiles(
  user: string,
  id: string,
  paths: string[],
): Promise<Map<string, Uint8Array>> {
  if (!validId(id)) return new Map();
  if (!hasBlob()) {
    const bytes = memoryBatch.get(user, id);
    if (!bytes) return new Map();
    return readZipEntries(async (s, e) => bytes.subarray(s, e), bytes.length, paths);
  }
  const url = await batchDownloadUrl(user, id);
  const tail = await fetch(url, { headers: { Range: `bytes=-${TAIL_BYTES}` } });
  if (tail.status === 404) return new Map();
  if (!tail.ok) throw new Error(`The store answered ${tail.status}.`);
  const first = new Uint8Array(await tail.arrayBuffer());
  const size = Number(tail.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ?? NaN);
  // No ranges: the store sent the whole zip.
  if (tail.status !== 206 || !Number.isFinite(size))
    return readZipEntries(async (s, e) => first.subarray(s, e), first.length, paths);
  const tailStart = size - first.length;
  return readZipEntries(
    async (s, e) => {
      if (s >= tailStart) return first.subarray(s - tailStart, e - tailStart);
      const r = await fetch(url, { headers: { Range: `bytes=${s}-${e - 1}` } });
      if (r.status !== 206) throw new Error(`The store answered ${r.status}.`);
      return new Uint8Array(await r.arrayBuffer());
    },
    size,
    paths,
  );
}
