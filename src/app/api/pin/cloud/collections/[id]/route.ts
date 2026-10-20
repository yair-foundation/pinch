import { gate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { deleteCollection, MAX_COLLECTION_BYTES, saveCollection, validId } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/*
 * One of the account's collections (D79): PUT writes it whole (the page keeps
 * the latest and sends it a moment after each change), DELETE removes it with
 * its batches' zips. Same-origin only.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

async function owner(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return { error: fail(403, 'Forbidden') };
  const session = sessionOf(request);
  if (!session) return { error: fail(401, 'Sign in first.') };
  const blocked = await gate(request);
  if (blocked) return { error: blocked };
  return { user: session.user };
}

export async function PUT(request: Request, ctx: RouteContext<'/api/pin/cloud/collections/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const who = await owner(request);
  if (who.error) return who.error;
  const body = await request.text();
  if (body.length > MAX_COLLECTION_BYTES) return fail(413, 'The collection is too large to save.');
  let doc: { id?: unknown };
  try {
    doc = JSON.parse(body);
  } catch {
    return fail(400, 'Bad request.');
  }
  if (!doc || typeof doc !== 'object' || doc.id !== id) return fail(400, 'Bad request.');
  await saveCollection(who.user, id, doc);
  return Response.json({ ok: true }, { headers });
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/pin/cloud/collections/[id]'>,
) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const who = await owner(request);
  if (who.error) return who.error;
  await deleteCollection(who.user, id);
  return Response.json({ ok: true }, { headers });
}
