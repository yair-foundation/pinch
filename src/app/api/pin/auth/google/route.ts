import {
  authUrl,
  callbackUrl,
  googleConfigured,
  OAUTH_COOKIE,
  pkcePair,
  randomState,
} from '@/lib/google';
import { touchAccount, userKeyOf } from '@/lib/account';
import { cookie, localEmail, sessionCookie, signSession } from '@/lib/session';

/*
 * Sign in with Google (D81): off to Google with a fresh state and a PKCE
 * challenge; the state and its verifier wait in a ten-minute cookie for the
 * callback. Without GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET,
 * back to the page, which says sign-in isn't set up; or, on this machine with
 * the test sign-in on, signed in as PINCH_LOCAL_EMAIL and back (D138).
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!googleConfigured()) {
    const email = localEmail();
    if (!email) return Response.redirect(new URL('/?signin=off', request.url), 302);
    // The same account the test sign-in makes for this email.
    const user = userKeyOf(`test:${email}`);
    await touchAccount(user, email, 'You', new Date().toISOString());
    const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
    headers.append(
      'Set-Cookie',
      sessionCookie(
        signSession({ user, email, name: 'You', picture: '' }, process.env.AUTH_SECRET as string),
      ),
    );
    return new Response(null, { status: 302, headers });
  }
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const headers = new Headers({
    Location: authUrl({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      redirectUri: callbackUrl(request.url),
      state,
      challenge,
    }),
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', cookie(OAUTH_COOKIE, `${state}.${verifier}`, 600));
  return new Response(null, { status: 302, headers });
}
