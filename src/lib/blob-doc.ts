import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob';

/*
 * Small JSON documents in the private Vercel Blob store, changed by
 * compare-and-swap: read uncached, write with `ifMatch` on the ETag, retry on
 * conflict. Concurrent requests on different server instances then can't lose
 * each other's change. The AI ledgers, the tag ledger and the saved notes
 * share this.
 *
 * Without Blob credentials (local development) the same logic runs on
 * in-memory documents.
 *
 * Accounts keep their collections here too (D81): one document per
 * collection under the account's folder, listed by prefix, written whole and
 * deleted with the account.
 */

/**
 * The ETag as `put` wants it in `ifMatch`. `get` can hand it back weak
 * (`W/"abc"`, after the CDN compresses the body); `put` compares strongly and
 * refuses a weak one every time, so every update after the first would fail.
 */
export const strongEtag = (etag: string) => etag.replace(/^W\//, '');

export const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const memory = new Map<string, unknown>();

export async function readDocument<T>(key: string, empty: T): Promise<{ doc: T; etag?: string }> {
  if (!hasBlob()) return { doc: structuredClone((memory.get(key) as T | undefined) ?? empty) };
  const res = await get(key, { access: 'private', useCache: false });
  if (res?.statusCode !== 200 || !res.stream) return { doc: structuredClone(empty) };
  const text = await new Response(res.stream).text();
  return { doc: JSON.parse(text) as T, etag: strongEtag(res.blob.etag) };
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
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
    }
  }
  throw new Error(busy);
}

/** Write a document whole, over whatever was there: for documents only their owner writes. */
export async function putDocument<T>(key: string, doc: T) {
  await writeDocument(key, doc);
}

/** The keys of every document under a prefix ("pinch-users/u1/collections/"). */
export async function listDocuments(prefix: string): Promise<string[]> {
  if (!hasBlob()) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    keys.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function deleteDocuments(keys: string[]) {
  if (!keys.length) return;
  if (!hasBlob()) {
    for (const k of keys) memory.delete(k);
    return;
  }
  await del(keys);
}
