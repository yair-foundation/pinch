import { createHash } from 'node:crypto';
import { deleteDocuments, listDocuments, readDocument, updateDocument } from './blob-doc';

/*
 * Accounts and purchases (D81), as small documents in the private Blob store.
 * An account is keyed by a hash of its Google id and keeps the email and name
 * Google gave; its collections sit under `pinch-users/<key>/`. Purchases are
 * keyed by a hash of the buyer's email, so a payment that arrives before the
 * buyer ever signs in, or from a checkout that didn't carry the account,
 * still finds them. No IP address, no payment details: Lemon Squeezy keeps
 * those.
 */

const hash = (s: string) => createHash('sha256').update(s).digest('base64url');

/** The account's key: a hash of its Google id, so the id itself is never stored. */
export const userKeyOf = (googleSub: string) => `g${hash(`google:${googleSub}`).slice(0, 26)}`;
export const emailKeyOf = (email: string) =>
  hash(`email:${email.trim().toLowerCase()}`).slice(0, 32);

export type Account = { email: string; name: string; createdAt: string; seenAt: string };

/**
 * Each order Lemon Squeezy reported for an email, as last reported, with its
 * product and when it was first reported paid (D98). Orders kept before D98
 * have neither: they are of the original offer, the only product then.
 */
export type Order = { status: 'paid' | 'refunded'; at: string; product?: string; paidAt?: string };
export type Purchases = { orders: Record<string, Order> };

const accountKey = (user: string) => `pinch-accounts/${user}.json`;
const purchaseKey = (email: string) => `pinch-purchases/${emailKeyOf(email)}.json`;
/** Where an account's own documents live: its collections and its batches' exports. */
export const userFolder = (user: string) => `pinch-users/${user}/`;

export async function touchAccount(user: string, email: string, name: string, now: string) {
  const empty: Account = { email: '', name: '', createdAt: '', seenAt: '' };
  await updateDocument<Account, void>(accountKey(user), empty, (doc) => {
    doc.email = email;
    doc.name = name;
    doc.seenAt = now;
    doc.createdAt ||= now;
  });
}

export async function readAccount(user: string): Promise<Account | null> {
  const { doc } = await readDocument<Account | null>(accountKey(user), null);
  return doc?.email ? doc : null;
}

/** Whether any order for the email stands paid. */
export const isPaid = (p: Purchases | null) =>
  Boolean(p && Object.values(p.orders).some((o) => o.status === 'paid'));

/**
 * One order's report applied to an email's purchases: a report older than the
 * one kept is ignored, so webhooks arriving out of order can't undo a refund.
 * The product and the first time it was paid are kept whatever comes later.
 * Pure, for tests.
 */
export function applyOrder(
  p: Purchases,
  order: string,
  status: 'paid' | 'refunded',
  at: string,
  product?: string,
): Purchases {
  const kept = p.orders[order];
  const paidAt =
    status === 'paid' && (!kept?.paidAt || at < kept.paidAt) ? at : kept?.paidAt;
  const known = {
    ...((product ?? kept?.product) ? { product: product ?? kept?.product } : {}),
    ...(paidAt ? { paidAt } : {}),
  };
  if (kept && (kept.at > at || (kept.at === at && kept.status === 'refunded')))
    return { orders: { ...p.orders, [order]: { ...kept, ...known } } };
  return { orders: { ...p.orders, [order]: { status, at, ...known } } };
}

export async function purchasesOf(email: string): Promise<Purchases | null> {
  return (await readDocument<Purchases | null>(purchaseKey(email), null)).doc;
}

export async function recordOrder(
  email: string,
  order: string,
  status: 'paid' | 'refunded',
  at: string,
  product?: string,
) {
  await updateDocument<Purchases, void>(purchaseKey(email), { orders: {} }, (doc) => {
    doc.orders = applyOrder(doc, order, status, at, product).orders;
  });
}

/** The account, its collections and their batches; its purchases stay, should they come back. */
export async function deleteAccount(user: string) {
  await deleteDocuments(await listDocuments(userFolder(user)));
  await deleteDocuments([accountKey(user)]);
}
