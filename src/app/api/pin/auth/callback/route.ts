import { touchAccount, userKeyOf } from '@/lib/account';
import { callbackUrl, claimsOf, exchangeCode, googleConfigured, OAUTH_COOKIE } from '@/lib/google';
import { cookie, cookieOf, sessionCookie, signSession } from '@/lib/session';

/*
 * Back from Google (D81): the state must match the one in the cookie, the
 * code is traded for an ID token, the account is created or touched, and the
 * session cookie is set. Any failure goes back to the page with
 * `?signin=failed`; nothing about it is logged but that it failed.
 */

export const dynamic = 'force-dynamic';

const back = (request: Request, query: string, setCookies: string[]) => {
  const headers = new Headers({
    Location: new URL(`/${query}`, request.url).toString(),
    'Cache-Control': 'no-store',
  });
  for (const c of setCookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
};

export async function GET(request: Request) {
  const clear = cookie(OAUTH_COOKIE, '', 0);
  if (!googleConfigured()) return back(request, '?signin=off', [clear]);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const [kept, verifier] = (cookieOf(request.headers.get('cookie'), OAUTH_COOKIE) ?? '').split('.');
  if (!code || !state || !kept || !verifier || state !== kept)
    return back(request, '?signin=failed', [clear]);
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID as string;
    const idToken = await exchangeCode({
      code,
      verifier,
      clientId,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirectUri: callbackUrl(request.url),
    });
    const google = claimsOf(idToken, clientId);
    const user = userKeyOf(google.sub);
    await touchAccount(user, google.email, google.name, new Date().toISOString());
    const token = signSession(
      { user, email: google.email, name: google.name, picture: google.picture },
      process.env.AUTH_SECRET as string,
    );
    return back(request, '', [clear, sessionCookie(token)]);
  } catch (error) {
    console.error('[pin] sign-in failed', (error as Error).message);
    return back(request, '?signin=failed', [clear]);
  }
}
