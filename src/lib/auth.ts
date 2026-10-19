import { createHash, timingSafeEqual } from 'node:crypto';

/*
 * The owner's read of the saved notes (GET /api/pin/notes) is behind HTTP
 * Basic auth, checked against ADMIN_PASSWORD (any user name). Without the
 * variable, production answers 404 and only `next dev` lets the request in.
 */

export const adminRealm = 'Pinch admin';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** True when an `Authorization: Basic …` header carries the password. */
export function isAuthorized(header: string | null, password: string): boolean {
  if (!password || !header?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  // Compare fixed-length digests in constant time, so neither the password nor its length leaks.
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

export type AdminAccess = 'allow' | 'ask' | 'hide';

export function adminAccess(
  header: string | null,
  password: string | undefined,
  development: boolean,
): AdminAccess {
  if (!password) return development ? 'allow' : 'hide';
  return isAuthorized(header, password) ? 'allow' : 'ask';
}

/**
 * Writes come only from Pinch's own page. A browser sends the Basic
 * credentials it remembers with any request to this origin, a form posted from
 * another site included, so a write must also prove it is same-origin.
 */
export function isSameOriginWrite(headers: Headers, origin: string): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  return headers.get('origin') === origin;
}

/** What a request to an owner-only route may do, from its headers and the environment. */
export function adminRequestAccess(request: Request): AdminAccess {
  return adminAccess(
    request.headers.get('authorization'),
    process.env.ADMIN_PASSWORD,
    process.env.NODE_ENV === 'development',
  );
}
