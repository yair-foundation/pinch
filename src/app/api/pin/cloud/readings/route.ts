import { accountGate } from '@/lib/access';
import { listReadings } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/* The readings of notes the signed-in account's agent made, waiting for the page (D122). */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request: Request) {
  const session = sessionOf(request);
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  const blocked = accountGate(request);
  if (blocked) return blocked;
  return Response.json({ readings: await listReadings(session.user) }, { headers });
}
