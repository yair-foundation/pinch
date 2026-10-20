import { isSameOriginWrite } from '@/lib/auth';
import { cookie, SESSION_COOKIE } from '@/lib/session';

/* Sign out (D79): the session cookie goes. Same-origin only, like every write. */

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  return Response.json({ ok: true }, { headers });
}
