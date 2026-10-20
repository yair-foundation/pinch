import { deleteAccount } from '@/lib/account';
import { isSameOriginWrite } from '@/lib/auth';
import { cookie, SESSION_COOKIE, sessionOf } from '@/lib/session';

/*
 * Delete my account (D81): the account, its collections and their batches'
 * exports go from the store, and the session ends. The purchase stays, kept
 * under a hash of the email, so signing in again later still finds it.
 */

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const session = sessionOf(request);
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  await deleteAccount(session.user);
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
  return Response.json({ ok: true }, { headers });
}
