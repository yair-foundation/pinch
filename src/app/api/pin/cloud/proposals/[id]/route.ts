import { accountGate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { dropProposal, validId } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/*
 * One rule the agent proposed (D116): DELETE takes it off the list, once the page has kept it
 * as a rule or the person dropped it. Same-origin only.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function DELETE(request: Request, ctx: RouteContext<'/api/pin/cloud/proposals/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const session = sessionOf(request);
  if (!session) return fail(401, 'Sign in first.');
  const blocked = accountGate(request);
  if (blocked) return blocked;
  await dropProposal(session.user, id);
  return Response.json({ ok: true }, { headers });
}
