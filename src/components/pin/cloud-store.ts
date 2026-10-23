import { uploadPresigned } from '@vercel/blob/client';
import type { Collection } from '@/lib/pin/learnings';
import { saveQueue } from '@/lib/pin/save-queue';
import type { CollectionsBackend } from './collections-backend';

/*
 * Collections in the signed-in account (D81), through Pinch's own routes:
 * each collection's document is read and written as JSON; a batch's export
 * zip goes straight to the store on a presigned URL (`uploadPresigned`) and
 * comes back the same way, or through the route when there is no store
 * (local runs) or the browser couldn't fetch the store's URL.
 */

const MULTIPART_BYTES = 80 * 1024 * 1024;

async function ok(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? 'The account didn’t answer. Try again.');
}

const json = { 'Content-Type': 'application/json' };

/** `folder` is the account's own folder in the store, as `/api/pin/me` gives it. */
export function cloudBackend(folder: string, mode: 'blob' | 'memory'): CollectionsBackend {
  const route = (id: string) => `/api/pin/cloud/batches/${encodeURIComponent(id)}`;
  // A collection's saves go one at a time, the newest waiting one only (D113).
  const saves = saveQueue<Collection>(async (id, c) => {
    await ok(
      await fetch(`/api/pin/cloud/collections/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify(c),
      }),
    );
  });
  return {
    kind: 'account',
    async list() {
      const res = await ok(await fetch('/api/pin/cloud/collections', { cache: 'no-store' }));
      const { collections } = (await res.json()) as { collections: Collection[] };
      return collections.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    save: (c) => saves.write(c.id, c),
    async remove(c) {
      await saves.idle(c.id);
      await ok(
        await fetch(`/api/pin/cloud/collections/${encodeURIComponent(c.id)}`, {
          method: 'DELETE',
        }),
      );
    },
    async putBatch(id, zip) {
      if (mode === 'memory') {
        await ok(await fetch(route(id), { method: 'PUT', body: zip }));
        return;
      }
      await uploadPresigned(`${folder}batches/${id}.zip`, zip, {
        access: 'private',
        handleUploadUrl: '/api/pin/cloud/upload',
        contentType: 'application/zip',
        multipart: zip.size > MULTIPART_BYTES,
      });
    },
    async getBatch(id) {
      const res = await fetch(route(id), { cache: 'no-store' });
      if (res.status === 404) return undefined;
      const { url } = (await (await ok(res)).json()) as { url: string };
      try {
        return await (await ok(await fetch(url, { cache: 'no-store' }))).blob();
      } catch (error) {
        if (mode === 'memory') throw error;
        // The store's URL didn't load here; the route streams the same bytes.
        return await (await ok(await fetch(`${route(id)}?raw=1`, { cache: 'no-store' }))).blob();
      }
    },
    async deleteBatch(id) {
      await ok(await fetch(route(id), { method: 'DELETE' }));
    },
  };
}
