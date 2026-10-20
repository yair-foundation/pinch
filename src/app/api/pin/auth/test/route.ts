import { touchAccount, userKeyOf } from '@/lib/account';
import { isSameOriginWrite } from '@/lib/auth';
import { pictureOf } from '@/lib/google';
import { sessionCookie, signSession, testLoginOn } from '@/lib/session';

/*
 * A sign-in without Google, for running Pinch's own tests on this machine:
 * POST { email, name?, picture? } signs in as that email. It exists only with
 * PINCH_TEST_LOGIN=1 and AUTH_SECRET set, and never on Vercel, whatever the
 * variables say; everywhere else it is a 404.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!testLoginOn()) return new Response('Not found', { status: 404 });
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    name?: unknown;
    picture?: unknown;
  };
  if (typeof body.email !== 'string' || !body.email.includes('@'))
    return Response.json({ error: 'Send an email.' }, { status: 400 });
  const email = body.email.trim().toLowerCase();
  const name = typeof body.name === 'string' ? body.name : 'Test';
  const user = userKeyOf(`test:${email}`);
  await touchAccount(user, email, name, new Date().toISOString());
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  headers.append(
    'Set-Cookie',
    sessionCookie(
      signSession(
        { user, email, name, picture: pictureOf(body.picture) },
        process.env.AUTH_SECRET as string,
      ),
    ),
  );
  return Response.json({ ok: true, user }, { headers });
}
