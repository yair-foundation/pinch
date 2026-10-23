import { accountGate } from '@/lib/access';
import { listProposals } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/* The rules the signed-in account's agent proposed, waiting to be kept or dropped (D116). */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request: Request) {
  const session = sessionOf(request);
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  const blocked = accountGate(request);
  if (blocked) return blocked;
  return Response.json({ proposals: await listProposals(session.user) }, { headers });
}
