import { type BillingConfig, billingConfig } from './billing';
import { browserOf, type Credits, creditsOf } from './credits';
import { googleConfigured } from './google';
import { type Session, sessionOf } from './session';

/*
 * Who may use what (D81, D98). Once Google sign-in and Lemon Squeezy are both
 * set up, reading notes into rules takes credits: 200 free for anyone, then
 * one offer, 2,000 for $19.99. Keeping rules in an account and connecting an
 * agent need only a sign-in; suggestions are for buyers with credits left, and
 * for those who bought the original offer. Until both are set up, nothing is
 * gated and nothing is counted, as before.
 */

export const paywallOn = () => googleConfigured() && billingConfig() !== null;

export type Access = {
  paywall: boolean;
  session: Session | null;
  browser: { id: string; setCookie?: string };
  /** Whose credits pay, and how many are left; null when nothing is counted. */
  credits: Credits | null;
  /** Whether the buyers' extras (suggestions) are open to them. */
  allowed: boolean;
};

export async function accessOf(request: Request): Promise<Access> {
  const paywall = paywallOn();
  const session = sessionOf(request);
  const browser = browserOf(request);
  if (!paywall) return { paywall, session, browser, credits: null, allowed: true };
  const credits = await creditsOf(session, browser.id, billingConfig() as BillingConfig);
  const allowed =
    Boolean(session) && (credits.original || (credits.bought && credits.balance > 0));
  return { paywall, session, browser, credits, allowed };
}

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** A buyers' extra (suggestions): null when the request may go on; else sign in first, or buy. */
export async function gate(request: Request): Promise<Response | null> {
  const a = await accessOf(request);
  if (a.allowed) return null;
  return a.session
    ? Response.json({ error: 'Get Pinch to use this.' }, { status: 402, headers })
    : Response.json({ error: 'Sign in to use Pinch.' }, { status: 401, headers });
}

/** What an account keeps (its rules, its agent key): a free account is enough (D98). */
export function accountGate(request: Request): Response | null {
  if (!paywallOn() || sessionOf(request)) return null;
  return Response.json({ error: 'Sign in to use Pinch.' }, { status: 401, headers });
}
