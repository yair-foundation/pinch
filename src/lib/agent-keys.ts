import { createHash, randomBytes } from 'node:crypto';
import { userFolder } from './account';
import { deleteDocuments, putDocument, readDocument } from './blob-doc';

/*
 * The key an agent connects to Pinch with (D89): one per account, made in the
 * Account dialog and shown once. Only its hash is kept, twice: under
 * `pinch-agent-keys/<hash>.json`, which finds the account a key belongs to,
 * and in the account's own folder, which finds the key to drop when a new one
 * is made or the account goes.
 */

export const AGENT_KEY_PREFIX = 'pk_';

const hashOf = (key: string) => createHash('sha256').update(`agent:${key}`).digest('base64url');
const indexKey = (hash: string) => `pinch-agent-keys/${hash}.json`;
const ownKey = (user: string) => `${userFolder(user)}agent-key.json`;

type Index = { user: string; createdAt: string };
type Own = { hash: string; createdAt: string };

/** Whether the account has a key, and since when. */
export async function agentKeyOf(user: string): Promise<{ createdAt: string } | null> {
  const { doc } = await readDocument<Own | null>(ownKey(user), null);
  return doc?.hash ? { createdAt: doc.createdAt } : null;
}

/** A new key for the account, returned once; the one before stops working. */
export async function makeAgentKey(user: string, now: string): Promise<string> {
  await dropAgentKey(user);
  const key = `${AGENT_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  const hash = hashOf(key);
  await putDocument<Index>(indexKey(hash), { user, createdAt: now });
  await putDocument<Own>(ownKey(user), { hash, createdAt: now });
  return key;
}

/** The account's key stops working. */
export async function dropAgentKey(user: string) {
  const { doc } = await readDocument<Own | null>(ownKey(user), null);
  if (!doc?.hash) return;
  await deleteDocuments([indexKey(doc.hash), ownKey(user)]);
}

/** The account a key belongs to, or null for a key that isn't one. */
export async function userOfAgentKey(key: string): Promise<string | null> {
  if (!key.startsWith(AGENT_KEY_PREFIX) || key.length > 100) return null;
  const { doc } = await readDocument<Index | null>(indexKey(hashOf(key)), null);
  return doc?.user ?? null;
}
