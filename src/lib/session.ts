import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Who is signed in (D81): a cookie holding the account's key, email, name,
 * Google picture (D93) and when it runs out, signed with AUTH_SECRET (HMAC-SHA256), so the server
 * keeps no session store. HttpOnly, Secure and SameSite=Lax: no page script
 * reads it, and another site's form can't send it with a write, while the
 * redirect back from Google still carries it.
 */

export type Session = {
  user: string;
  email: string;
  name: string;
  /** The Google profile picture's address, or '' (older sessions have none). */
  picture?: string;
  exp: number;
};

export const SESSION_COOKIE = 'pinch-session';
export const SESSION_DAYS = 30;

const sign = (data: string, secret: string) =>
  createHmac('sha256', secret).update(data).digest('base64url');

export function signSession(s: Omit<Session, 'exp'>, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ ...s, exp: now + SESSION_DAYS * 86_400_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The session a token holds, or null when it is missing, forged, malformed or past its time. */
export function readSession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Session | null {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof s.user !== 'string' || typeof s.email !== 'string' || typeof s.exp !== 'number')
      return null;
    if (s.exp < now) return null;
    return {
      user: s.user,
      email: s.email,
      name: typeof s.name === 'string' ? s.name : '',
      picture: typeof s.picture === 'string' ? s.picture : '',
      exp: s.exp,
    };
  } catch {
    return null;
  }
}

/** One cookie's value from a `Cookie` header. */
export function cookieOf(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** A `Set-Cookie` value Pinch's way: whole site, HttpOnly, Secure, Lax. Max age 0 clears it. */
export const cookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export const sessionCookie = (token: string) =>
  cookie(SESSION_COOKIE, token, SESSION_DAYS * 86_400);

/**
 * The test sign-in (`/api/pin/auth/test`): only with PINCH_TEST_LOGIN=1 and AUTH_SECRET set, and
 * never on Vercel, whatever the variables say.
 */
export const testLoginOn = () =>
  process.env.PINCH_TEST_LOGIN === '1' && Boolean(process.env.AUTH_SECRET) && !process.env.VERCEL;

/**
 * Signing in on this machine without Google (D138): where the test sign-in is on and Google isn't
 * set up, Sign in signs in as PINCH_LOCAL_EMAIL, so one person can keep rules and connect their
 * agent to the Pinch running on their own computer.
 */
export const localEmail = () =>
  testLoginOn()
    ? (process.env.PINCH_LOCAL_EMAIL || 'you@pinch.localhost').trim().toLowerCase()
    : null;

export const sessionOf = (request: Request) =>
  readSession(cookieOf(request.headers.get('cookie'), SESSION_COOKIE), process.env.AUTH_SECRET);
