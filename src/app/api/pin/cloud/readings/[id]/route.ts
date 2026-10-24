import { accountGate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { dropReading, validId } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/*
 * One reading of notes the agent made (D122): DELETE takes it off the list once the page has
 * applied it. Same-origin only.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function DELETE(request: Request, ctx: RouteContext<'/api/pin/cloud/readings/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const session = sessionOf(request);
  if (!session) return fail(401, 'Sign in first.');
  const blocked = accountGate(request);
  if (blocked) return blocked;
  await dropReading(session.user, id);
  return Response.json({ ok: true }, { headers });
}
