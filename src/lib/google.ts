import { createHash, randomBytes } from 'node:crypto';

/*
 * Sign-in with Google (D81): the authorization-code flow with PKCE. The page
 * goes to Google with a random state and a code challenge kept in a short
 * cookie; Google sends it back with a code, which the server trades, with the
 * verifier and the client secret, for an ID token. That token comes straight
 * from Google's token endpoint over TLS, so its claims are read without
 * checking its signature (OpenID Connect Core 3.1.3.7), but the issuer, the
 * audience, the expiry and a verified email are all checked.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const OAUTH_COOKIE = 'pinch-oauth';

export const googleConfigured = () =>
  Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET,
  );

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export const randomState = () => randomBytes(18).toString('base64url');

/** Where Google sends the browser back: this site's callback, the same for the way out and back. */
export const callbackUrl = (requestUrl: string) =>
  new URL('/api/pin/auth/callback', requestUrl).toString();

export function authUrl(o: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export type GoogleUser = { sub: string; email: string; name: string };

/** Who the ID token says signed in, after checking it is Google's, for us, current and verified. */
export function claimsOf(idToken: string, clientId: string, now = Date.now()): GoogleUser {
  const part = idToken.split('.')[1];
  if (!part) throw new Error('Google sent no ID token.');
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Google’s ID token can’t be read.');
  }
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com')
    throw new Error('The ID token isn’t from Google.');
  const audience = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!audience.includes(clientId)) throw new Error('The ID token isn’t for Pinch.');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now - 60_000)
    throw new Error('The sign-in took too long. Try again.');
  if (typeof c.sub !== 'string' || !c.sub) throw new Error('Google sent no account id.');
  if (typeof c.email !== 'string' || (c.email_verified !== true && c.email_verified !== 'true'))
    throw new Error('That Google account’s email isn’t verified.');
  return {
    sub: c.sub,
    email: c.email.trim().toLowerCase(),
    name: typeof c.name === 'string' ? c.name.slice(0, 100) : '',
  };
}

/** Trade the code Google sent back for an ID token. */
export async function exchangeCode(
  o: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: o.code,
      code_verifier: o.verifier,
      client_id: o.clientId,
      client_secret: o.clientSecret,
      redirect_uri: o.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Google didn’t accept the sign-in. Try again.');
  const body = (await res.json()) as { id_token?: unknown };
  if (typeof body.id_token !== 'string') throw new Error('Google sent no ID token.');
  return body.id_token;
}
