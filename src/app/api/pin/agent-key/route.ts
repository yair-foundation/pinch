import { accountGate } from '@/lib/access';
import { agentKeyOf, dropAgentKey, makeAgentKey } from '@/lib/agent-keys';
import { isSameOriginWrite } from '@/lib/auth';
import { sessionOf } from '@/lib/session';

/*
 * The account's agent key (D89): GET says whether there is one; POST makes a
 * new one, returned once with the address to connect to, and the one before
 * stops working; DELETE disconnects. For buyers, same-origin only.
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

export async function GET(request: Request) {
  const who = await owner(request, false);
  if (who.error) return who.error;
  return Response.json({ key: await agentKeyOf(who.user) }, { headers });
}

export async function POST(request: Request) {
  const who = await owner(request, true);
  if (who.error) return who.error;
  const key = await makeAgentKey(who.user, new Date().toISOString());
  const url = new URL('/api/pin/mcp', request.url).toString();
  return Response.json({ key, url }, { headers });
}

export async function DELETE(request: Request) {
  const who = await owner(request, true);
  if (who.error) return who.error;
  await dropAgentKey(who.user);
  return Response.json({ ok: true }, { headers });
}
