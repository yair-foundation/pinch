import { createHash, randomBytes } from 'node:crypto';
import { emailKeyOf, type Order, purchasesOf } from './account';
import type { BillingConfig } from './billing';
import { readDocument, updateDocument } from './blob-doc';
import {
  balanceOf,
  FREE_CREDITS,
  FREE_GRANT,
  type Grant,
  PACK_CREDITS,
  type Update,
  updatePrice,
} from './pin/credits';
import { cookie, cookieOf, type Session } from './session';

/*
 * Whose credits pay for an update (D98). A signed-in person's are kept under
 * a hash of their email, beside their purchases, so deleting the account and
 * signing in again doesn't bring the free ones back. A visitor's are kept
 * under a hash of a random id in a cookie of this browser. A ledger holds
 * every update; the balance comes from those, the free 200 and the email's
 * orders (`pin/credits.ts`). On sign-in, what the browser spent moves into
 * the account's ledger, so the free 200 are one allowance, and the browser's
 * ledger is closed. Earlier buyers of the original offer keep what they
 * bought and spend no credits (D98).
 */

export const BROWSER_COOKIE = 'pinch-browser';
const BROWSER_DAYS = 400;

export type Ledger = { updates: Update[]; mergedInto?: string };
const EMPTY: Ledger = { updates: [] };

const hash = (s: string) => createHash('sha256').update(s).digest('base64url').slice(0, 32);
const ledgerKey = (owner: string) => `pinch-credits/${owner}.json`;
const emailOwner = (email: string) => `e-${emailKeyOf(email)}`;
const browserOwner = (id: string) => `b-${hash(`browser:${id}`)}`;

/** This browser's id from its cookie, or a new one with the cookie that keeps it. */
export function browserOf(request: Request): { id: string; setCookie?: string } {
  const id = cookieOf(request.headers.get('cookie'), BROWSER_COOKIE);
  if (id && /^[A-Za-z0-9_-]{22,64}$/.test(id)) return { id };
  const fresh = randomBytes(18).toString('base64url');
  return { id: fresh, setCookie: cookie(BROWSER_COOKIE, fresh, BROWSER_DAYS * 86_400) };
}

/** Orders kept before D98 carry no product and no paid time: the original offer was all there was. */
const productOf = (o: Order, config: BillingConfig) =>
  o.product ?? (o.paidAt ? config.productId : undefined);

/** The packs an email's orders gave: paid orders of the credits product, with their refunds. */
export function grantsOf(orders: Record<string, Order>, config: BillingConfig): Grant[] {
  return Object.entries(orders).flatMap(([id, o]) =>
    productOf(o, config) === config.productId && o.paidAt
      ? [
          {
            id,
            credits: PACK_CREDITS,
            at: o.paidAt,
            ...(o.status === 'refunded' ? { refundedAt: o.at } : {}),
          },
        ]
      : [],
  );
}

/** Whether the email bought the original offer while it was on sale, and keeps it (D98). */
export function keepsOriginal(orders: Record<string, Order>, config: BillingConfig): boolean {
  if (!config.originalProductId) return false;
  return Object.values(orders).some(
    (o) =>
      o.status === 'paid' &&
      (o.product === config.originalProductId || (!o.product && !o.paidAt)),
  );
}

const grantsFor = (orders: Record<string, Order>, config: BillingConfig): Grant[] => [
  { id: FREE_GRANT, credits: FREE_CREDITS, at: '' },
  ...grantsOf(orders, config),
];

export type Credits = {
  owner: string;
  balance: number;
  /** Whether a pack bought stands, not refunded: suggestions are for buyers. */
  bought: boolean;
  /** The original offer's buyers keep it: their updates take no credits. */
  original: boolean;
  /** A browser whose credits moved into an account: sign in to use them. */
  closed: boolean;
  orders: Record<string, Order>;
};

/** The credits of whoever is asking: the signed-in email's, else this browser's. */
export async function creditsOf(
  session: Session | null,
  browser: string,
  config: BillingConfig,
  now = Date.now(),
): Promise<Credits> {
  const owner = session ? emailOwner(session.email) : browserOwner(browser);
  const [{ doc }, purchases] = await Promise.all([
    readDocument<Ledger>(ledgerKey(owner), EMPTY),
    session ? purchasesOf(session.email) : null,
  ]);
  const orders = purchases?.orders ?? {};
  const grants = grantsFor(orders, config);
  return {
    owner,
    balance: doc.mergedInto ? 0 : balanceOf(grants, doc.updates, now),
    bought: grants.some((g) => g.id !== FREE_GRANT && !g.refundedAt),
    original: keepsOriginal(orders, config),
    closed: Boolean(doc.mergedInto),
    orders,
  };
}

export type Begun = { ok: true } | { ok: false; status: 400 | 402; error: string };

/**
 * Starts an update of `notes` notes, or goes on with one already started, for
 * a call reading `chunk` of them. A new update needs its whole price; a call
 * can't read more notes than its update was priced for. Pure, for tests.
 */
export function begin(
  ledger: Ledger,
  grants: Grant[],
  id: string,
  notes: number,
  chunk: number,
  now: number,
): Begun {
  if (ledger.mergedInto)
    return { ok: false, status: 402, error: 'Sign in to use your credits.' };
  const known = ledger.updates.find((u) => u.id === id);
  if (known) {
    if (known.done) return { ok: false, status: 400, error: 'That update has finished.' };
    if (known.read + chunk > known.notes)
      return { ok: false, status: 400, error: 'More notes than the update was priced for.' };
    return { ok: true };
  }
  if (chunk > notes)
    return { ok: false, status: 400, error: 'More notes than the update was priced for.' };
  if (updatePrice(notes) > balanceOf(grants, ledger.updates, now))
    return { ok: false, status: 402, error: 'Not enough credits for this update.' };
  ledger.updates.push({ id, at: new Date(now).toISOString(), notes, read: 0, done: false });
  return { ok: true };
}

export async function beginUpdate(
  c: Credits,
  config: BillingConfig,
  id: string,
  notes: number,
  chunk: number,
  now = Date.now(),
): Promise<Begun> {
  const grants = grantsFor(c.orders, config);
  return updateDocument<Ledger, Begun>(ledgerKey(c.owner), EMPTY, (doc) =>
    begin(doc, grants, id, notes, chunk, now),
  );
}

/** A call of the update read `count` notes; the update is done when it has read them all. */
export async function noteRead(owner: string, id: string, count: number) {
  await updateDocument<Ledger, void>(ledgerKey(owner), EMPTY, (doc) => {
    const u = doc.updates.find((x) => x.id === id);
    if (!u || u.done) return;
    u.read = Math.min(u.notes, u.read + count);
    u.done = u.read >= u.notes;
  });
}

/** The author's update stopped: it takes what it read, and the rest comes back. */
export async function finishUpdate(owner: string, id: string) {
  await updateDocument<Ledger, void>(ledgerKey(owner), EMPTY, (doc) => {
    const u = doc.updates.find((x) => x.id === id);
    if (u) u.done = true;
  });
}

/**
 * On sign-in: what this browser spent moves into the account's ledger, once,
 * and the browser's ledger is closed, so the free 200 are one allowance
 * whichever way they were spent.
 */
export async function mergeBrowser(browser: string, email: string) {
  const from = browserOwner(browser);
  const to = emailOwner(email);
  const { doc } = await readDocument<Ledger>(ledgerKey(from), EMPTY);
  if (doc.mergedInto) return;
  // Closed even when it spent nothing, or signing out would open a second free 200.
  if (doc.updates.length)
    await updateDocument<Ledger, void>(ledgerKey(to), EMPTY, (account) => {
      const known = new Set(account.updates.map((u) => u.id));
      for (const u of doc.updates)
        if (!known.has(u.id)) account.updates.push({ ...u, done: true });
    });
  await updateDocument<Ledger, void>(ledgerKey(from), EMPTY, (browserLedger) => {
    browserLedger.mergedInto = to;
  });
}
