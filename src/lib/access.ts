import { isPaid, purchasesOf } from './account';
import { billingConfig } from './billing';
import { googleConfigured } from './google';
import { type Session, sessionOf } from './session';

/*
 * Who may use Pinch (D79). Pinch is one paid tool: once Google sign-in and
 * Lemon Squeezy are both set up, every step that costs or keeps something
 * (suggestions, rule drafts, the account's collections) needs a signed-in
 * account that has paid. Until then, nothing is gated, as before.
 */

export const paywallOn = () => googleConfigured() && billingConfig() !== null;

/** A purchase looked up stays good this long on one server instance, to spare a read per call. */
const CACHE_MS = 60_000;
const cache = new Map<string, { paid: boolean; until: number }>();

export async function paidEmail(email: string, fresh = false): Promise<boolean> {
  const hit = cache.get(email);
  if (!fresh && hit && hit.until > Date.now()) return hit.paid;
  const paid = isPaid(await purchasesOf(email));
  if (cache.size > 5000) cache.clear();
  cache.set(email, { paid, until: Date.now() + CACHE_MS });
  return paid;
}

export const forgetPaid = (email: string) => cache.delete(email);

export type Access = { paywall: boolean; session: Session | null; allowed: boolean };

export async function accessOf(request: Request, fresh = false): Promise<Access> {
  const paywall = paywallOn();
  const session = sessionOf(request);
  if (!paywall) return { paywall, session, allowed: true };
  if (!session) return { paywall, session, allowed: false };
  return { paywall, session, allowed: await paidEmail(session.email, fresh) };
}

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Null when the request may go on; otherwise the answer to send: sign in first, or buy first. */
export async function gate(request: Request): Promise<Response | null> {
  const a = await accessOf(request);
  if (a.allowed) return null;
  return a.session
    ? Response.json({ error: 'Get Pinch to use this.' }, { status: 402, headers })
    : Response.json({ error: 'Sign in to use Pinch.' }, { status: 401, headers });
}
