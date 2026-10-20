import { BlobPreconditionFailedError, get, put } from '@vercel/blob';

/*
 * Small JSON documents in the private Vercel Blob store, changed by
 * compare-and-swap: read uncached, write with `ifMatch` on the ETag, retry on
 * conflict. Concurrent requests on different server instances then can't lose
 * each other's change. The AI ledgers, the tag ledger and the saved notes
 * share this.
 *
 * Without Blob credentials (local development) the same logic runs on
 * in-memory documents.
 */

const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const memory = new Map<string, unknown>();

export async function readDocument<T>(key: string, empty: T): Promise<{ doc: T; etag?: string }> {
  if (!hasBlob()) return { doc: structuredClone((memory.get(key) as T | undefined) ?? empty) };
  const res = await get(key, { access: 'private', useCache: false });
  if (res?.statusCode !== 200 || !res.stream) return { doc: structuredClone(empty) };
  const text = await new Response(res.stream).text();
  return { doc: JSON.parse(text) as T, etag: res.blob.etag };
}

async function writeDocument<T>(key: string, doc: T, etag?: string) {
  if (!hasBlob()) {
    memory.set(key, doc);
    return;
  }
  await put(key, JSON.stringify(doc), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

/** Read, change, write with the ETag; retry when another request got there first. */
export async function updateDocument<T, R>(
  key: string,
  empty: T,
  change: (doc: T) => R | Promise<R>,
  busy = 'The store is busy. Try again.',
): Promise<R> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { doc, etag } = await readDocument(key, empty);
    const result = await change(doc);
    try {
      await writeDocument(key, doc, etag);
      return result;
    } catch (error) {
      // A first write races too: two requests may both see "no document yet".
      const conflict =
        error instanceof BlobPreconditionFailedError ||
        (!etag && error instanceof Error && /already exists/i.test(error.message));
      if (!conflict) throw error;
      if (attempt === 0)
        console.warn('[pin] blob conflict', key, error instanceof Error ? error.name : '', etag);
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  throw new Error(busy);
}
