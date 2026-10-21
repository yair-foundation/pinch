import { get } from '@vercel/blob';
import { accountGate, storageRoom } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { hasBlob } from '@/lib/blob-doc';
import {
  batchDownloadUrl,
  batchKey,
  deleteBatch,
  MAX_MEMORY_BATCH_BYTES,
  memoryBatch,
  validId,
} from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/*
 * One of the account's batch zips (D81). GET answers with a URL to fetch it
 * from: a presigned URL into the store, good for a few minutes, or (without a
 * store, in local runs) this route with `?raw=1`, which sends the bytes; with
 * a store, `?raw=1` streams them too, for a page that couldn't fetch the
 * presigned URL. PUT
 * takes the bytes only in local runs; with a store the browser uploads
 * through `/api/pin/cloud/upload`. DELETE removes it.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

async function owner(request: Request, write: boolean) {
  if (write && !isSameOriginWrite(request.headers, new URL(request.url).origin))
    return { error: fail(403, 'Forbidden') };
  const session = sessionOf(request);
  if (!session) return { error: fail(401, 'Sign in first.') };
  const blocked = accountGate(request);
  if (blocked) return { error: blocked };
  return { user: session.user };
}

export async function GET(request: Request, ctx: RouteContext<'/api/pin/cloud/batches/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const who = await owner(request, false);
  if (who.error) return who.error;
  const raw = new URL(request.url).searchParams.get('raw') === '1';
  if (hasBlob() && !raw)
    return Response.json({ url: await batchDownloadUrl(who.user, id) }, { headers });
  if (!raw) return Response.json({ url: `/api/pin/cloud/batches/${id}?raw=1` }, { headers });
  // The bytes through this route: always in local runs, and with a store only when the page
  // couldn't fetch the presigned URL, streamed rather than held.
  if (hasBlob()) {
    const found = await get(batchKey(who.user, id), { access: 'private', useCache: false });
    if (found?.statusCode !== 200 || !found.stream) return fail(404, 'Not found.');
    return new Response(found.stream, {
      headers: { ...headers, 'Content-Type': 'application/zip' },
    });
  }
  const bytes = memoryBatch.get(who.user, id);
  if (!bytes) return fail(404, 'Not found.');
  return new Response(bytes as BodyInit, {
    headers: { ...headers, 'Content-Type': 'application/zip' },
  });
}

export async function PUT(request: Request, ctx: RouteContext<'/api/pin/cloud/batches/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  if (hasBlob()) return fail(405, 'Upload through /api/pin/cloud/upload.');
  const who = await owner(request, true);
  if (who.error) return who.error;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_MEMORY_BATCH_BYTES) return fail(413, 'Too large for a local run.');
  if (bytes.length > (await storageRoom(request, who.user, batchKey(who.user, id))))
    return fail(413, 'Your account is full. Remove rules you no longer need.');
  memoryBatch.put(who.user, id, bytes);
  return Response.json({ ok: true }, { headers });
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/pin/cloud/batches/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const who = await owner(request, true);
  if (who.error) return who.error;
  await deleteBatch(who.user, id);
  return Response.json({ ok: true }, { headers });
}
