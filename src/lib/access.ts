import { proOf, purchasesOf, readAccount } from './account';
import { type BillingConfig, billingConfig } from './billing';
import { keptBytes, STORAGE_BOUGHT_BYTES, STORAGE_FREE_BYTES } from './cloud';
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
 *
 * Plans (D123), once Pro is set up too: a free account's agent gets the rules
 * of one product, and Pro every product, with the storage of a buyer. Until
 * Pro is set up, everyone has what Pro gives.
 */

export const paywallOn = () => googleConfigured() && billingConfig() !== null;

/** Whether plans are on (D123): the paywall, and Pro set up in Lemon Squeezy. */
export const plansOn = () => paywallOn() && Boolean(billingConfig()?.pro);

export type Access = {
  paywall: boolean;
  session: Session | null;
  browser: { id: string; setCookie?: string };
  /** Whose credits pay, and how many are left; null when nothing is counted. */
  credits: Credits | null;
  /** Whether the buyers' extras (suggestions) are open to them. */
  allowed: boolean;
  /** Whether they have what Pro gives (D123): always, until plans are on. */
  pro: boolean;
};

/** Who is asking and what they may use; `browser` once worked out, so a new id is made once. */
export async function accessOf(
  request: Request,
  browser = browserOf(request),
): Promise<Access> {
  const paywall = paywallOn();
  const session = sessionOf(request);
  if (!paywall) return { paywall, session, browser, credits: null, allowed: true, pro: true };
  const config = billingConfig() as BillingConfig;
  const credits = await creditsOf(session, browser.id, config);
  const allowed =
    Boolean(session) && (credits.original || (credits.bought && credits.balance > 0));
  const pro = config.pro
    ? Boolean(session) && proOf(await purchasesOf(session?.email ?? ''), config.pro.since)
    : true;
  return { paywall, session, browser, credits, allowed, pro };
}

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * An email known to be allowed the buyers' extras stays so this long on one instance, to spare
 * two reads a suggestion. Only yes is kept: a purchase opens them at once, and a refund or an
 * empty balance closes them within a minute.
 */
const CACHE_MS = 60_000;
const allowedUntil = new Map<string, number>();

/** A buyers' extra (suggestions): null when the request may go on; else sign in first, or buy. */
export async function gate(request: Request): Promise<Response | null> {
  const session = paywallOn() ? sessionOf(request) : null;
  if (session && (allowedUntil.get(session.email) ?? 0) > Date.now()) return null;
  const { allowed } = await accessOf(request);
  if (allowed && session) {
    if (allowedUntil.size > 5000) allowedUntil.clear();
    allowedUntil.set(session.email, Date.now() + CACHE_MS);
  }
  if (allowed) return null;
  return session
    ? Response.json({ error: 'Get Pinch to use this.' }, { status: 402, headers })
    : Response.json({ error: 'Sign in to use Pinch.' }, { status: 401, headers });
}

/**
 * The room an account has left to keep screenshots in (D98): 200 MB free, 2 GB once it has
 * bought credits or the original offer; no limit of its own until billing is on.
 */
export async function storageRoom(request: Request, user: string, path: string) {
  const a = await accessOf(request);
  if (!a.credits) return Number.POSITIVE_INFINITY;
  const paid = billingConfig()?.pro ? a.pro : a.credits.bought || a.credits.original;
  const cap = paid ? STORAGE_BOUGHT_BYTES : STORAGE_FREE_BYTES;
  return cap - (await keptBytes(user, path));
}

/** What an account keeps (its rules, its agent key): a free account is enough (D98). */
export function accountGate(request: Request): Response | null {
  if (!paywallOn() || sessionOf(request)) return null;
  return Response.json({ error: 'Sign in to use Pinch.' }, { status: 401, headers });
}

/** Whether an account's agent gets every product (D123): yes until plans are on, then Pro only. */
export async function agentHasPro(user: string): Promise<boolean> {
  const since = plansOn() ? billingConfig()?.pro?.since : undefined;
  if (!since) return true;
  const account = await readAccount(user);
  return account ? proOf(await purchasesOf(account.email), since) : false;
}
