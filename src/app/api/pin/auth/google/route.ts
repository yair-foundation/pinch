import {
  authUrl,
  callbackUrl,
  googleConfigured,
  OAUTH_COOKIE,
  pkcePair,
  randomState,
} from '@/lib/google';
import { cookie } from '@/lib/session';

/*
 * Sign in with Google (D81): off to Google with a fresh state and a PKCE
 * challenge; the state and its verifier wait in a ten-minute cookie for the
 * callback. Without GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_SECRET,
 * back to the page, which says sign-in isn't set up.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!googleConfigured()) return Response.redirect(new URL('/?signin=off', request.url), 302);
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
