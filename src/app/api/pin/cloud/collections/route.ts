import { gate } from '@/lib/access';
import { listCollections } from '@/lib/cloud';
import { sessionOf } from '@/lib/session';

/* The signed-in account's collections (D81). */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request: Request) {
  const session = sessionOf(request);
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  const blocked = await gate(request);
  if (blocked) return blocked;
  return Response.json({ collections: await listCollections(session.user) }, { headers });
}
