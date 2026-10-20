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

/** Whether an Origin header names this site: the request's own origin, or the host the platform forwarded. */
function originIsOurs(from: string, origin: string, headers: Headers): boolean {
  if (from === origin) return true;
  let host: string;
  try {
    host = new URL(from).host.toLowerCase();
  } catch {
    return false;
  }
  const served = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return host.length > 0 && host === served;
}

/**
 * Writes come only from the site's own pages. A browser sends the Basic
 * credentials it remembers with any request to this origin, a form posted from
 * another site included, so a write must also prove it is same-origin: by
 * `Sec-Fetch-Site`, which no page can forge, with `Origin` as the fallback
 * for browsers without it. A script can send any header it likes; this
 * can't tell one from a browser, but when it sends both they must agree, so
 * a copied `Sec-Fetch-Site: same-origin` next to a foreign `Origin` fails.
 */
export function isSameOriginWrite(headers: Headers, origin: string): boolean {
  const site = headers.get('sec-fetch-site');
  const from = headers.get('origin');
  if (site) return site === 'same-origin' && (!from || originIsOurs(from, origin, headers));
  return !!from && originIsOurs(from, origin, headers);
}

/** What a request to an owner-only route may do, from its headers and the environment. */
export function adminRequestAccess(request: Request): AdminAccess {
  return adminAccess(
    request.headers.get('authorization'),
    process.env.ADMIN_PASSWORD,
    process.env.NODE_ENV === 'development',
  );
}
