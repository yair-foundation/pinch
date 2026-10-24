import { accountGate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { dropRun, judgeWork, validId } from '@/lib/cloud';
import { VERDICTS, type Verdict } from '@/lib/pin/runs';
import { sessionOf } from '@/lib/session';

/*
 * One run of the agent (D120): PATCH judges a piece of work in it (`{ report, verdict }`, null
 * to take the verdict back), DELETE removes the run. Same-origin only.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

/** The account the request may change, or the answer that says why not. */
function owner(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const session = sessionOf(request);
  if (!session) return fail(401, 'Sign in first.');
  return accountGate(request) ?? session.user;
}

export async function PATCH(request: Request, ctx: RouteContext<'/api/pin/cloud/runs/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const user = owner(request);
  if (typeof user !== 'string') return user;
  const body = (await request.json().catch(() => null)) as {
    report?: unknown;
    verdict?: unknown;
  } | null;
  const report = typeof body?.report === 'string' ? body.report : '';
  const verdict = body?.verdict ?? null;
  if (!validId(report) || (verdict !== null && !VERDICTS.includes(verdict as Verdict)))
    return fail(400, 'Bad verdict.');
  await judgeWork(user, id, report, verdict as Verdict | null);
  return Response.json({ ok: true }, { headers });
}

export async function DELETE(request: Request, ctx: RouteContext<'/api/pin/cloud/runs/[id]'>) {
  const { id } = await ctx.params;
  if (!validId(id)) return fail(400, 'Bad id.');
  const user = owner(request);
  if (typeof user !== 'string') return user;
  await dropRun(user, id);
  return Response.json({ ok: true }, { headers });
}
