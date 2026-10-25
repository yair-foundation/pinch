import { del, issueSignedToken, list, presignUrl } from '@vercel/blob';
import { userFolder } from './account';
import { type AgentReading, agentReadingsIn, withAgentReading } from './pin/agent-reading';
import { type Proposal, proposalsIn, withProposal } from './pin/proposals';
import {
  type PilotRow,
  pilotRow,
  type RunEvent,
  type RunsDoc,
  runsDocIn,
  type Verdict,
  withEvents,
  withoutRun,
  withStart,
  withCorrection,
  withVerdict,
} from './pin/runs';
import { readZipEntries, TAIL_BYTES } from './pin/zip-range';
import {
  deleteDocuments,
  hasBlob,
  listDocuments,
  putDocument,
  readDocument,
  updateDocument,
} from './blob-doc';

/*
 * An account's collections in the private Blob store (D81): each collection
 * is one JSON document, `pinch-users/<account>/collections/<id>.json`, and
 * each batch's export is one zip, `pinch-users/<account>/batches/<id>.zip`.
 * Zips are tens of megabytes, more than a function passes, so the browser
 * moves them straight to and from the store on short-lived presigned URLs,
 * scoped to one path. Without Blob credentials (local runs) the zips live in
 * this process's memory and go through the route instead. The rules the
 * agent proposes wait in one more document beside them (D116), and what
 * each of its runs did with the rules in another (D120), and the readings
 * of notes it made itself in a third (D122).
 */

export const MAX_COLLECTION_BYTES = 3_000_000;
export const MAX_BATCH_BYTES = 300 * 1024 * 1024;
/** Zips kept in memory when there is no store (local runs): smaller, and lost on restart. */
export const MAX_MEMORY_BATCH_BYTES = 60 * 1024 * 1024;
/** What an account may keep (D98): 200 MB free, 2 GB once it has bought credits. */
export const STORAGE_FREE_BYTES = 200 * 1024 * 1024;
export const STORAGE_BOUGHT_BYTES = 2 * 1024 * 1024 * 1024;
const URL_MINUTES = 15;

/** Ids are the app's own: lower-case letters and digits. Anything else never reaches a path. */
export const validId = (id: string) => /^[a-z0-9]{6,40}$/.test(id);

export const collectionKey = (user: string, id: string) =>
  `${userFolder(user)}collections/${id}.json`;
export const batchKey = (user: string, id: string) => `${userFolder(user)}batches/${id}.zip`;

/** Whether an upload's path is one of this account's batch zips. */
export function ownBatchPath(user: string, pathname: string): boolean {
  const prefix = `${userFolder(user)}batches/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith('.zip')) return false;
  return validId(pathname.slice(prefix.length, -'.zip'.length));
}

export async function listCollections(user: string): Promise<unknown[]> {
  const keys = await listDocuments(`${userFolder(user)}collections/`);
  const docs = await Promise.all(keys.map(async (k) => (await readDocument<unknown>(k, null)).doc));
  return docs.filter(Boolean);
}

export const saveCollection = (user: string, id: string, doc: unknown) =>
  putDocument(collectionKey(user, id), doc);

/** The collection's document, and the zips of the batches it names. */
export async function deleteCollection(user: string, id: string) {
  const { doc } = await readDocument<{ batches?: { id?: unknown }[] } | null>(
    collectionKey(user, id),
    null,
  );
  const batchIds = (doc?.batches ?? [])
    .map((b) => (typeof b.id === 'string' ? b.id : ''))
    .filter(validId);
  for (const b of batchIds) await deleteBatch(user, b);
  await deleteDocuments([collectionKey(user, id)]);
}

/**
 * The rules the agent proposed, waiting for the person (D116): one document beside the
 * collections, `pinch-users/<account>/proposals.json`, changed by compare-and-swap, since the
 * agent adds to it and the page takes from it. Never part of the collection, which the page
 * writes whole.
 */
const proposalsKey = (user: string) => `${userFolder(user)}proposals.json`;
type Proposals = { proposals: Proposal[] };

export async function listProposals(user: string): Promise<Proposal[]> {
  return proposalsIn((await readDocument<Proposals>(proposalsKey(user), { proposals: [] })).doc);
}

export const addProposal = (user: string, p: Proposal) =>
  updateDocument<Proposals, void>(proposalsKey(user), { proposals: [] }, (doc) => {
    doc.proposals = withProposal(proposalsIn(doc), p);
  });

export const dropProposal = (user: string, id: string) =>
  updateDocument<Proposals, void>(proposalsKey(user), { proposals: [] }, (doc) => {
    doc.proposals = proposalsIn(doc).filter((p) => p.id !== id);
  });

/**
 * What the agent's runs did with the rules (D120): `pinch-users/<account>/runs.json`, changed by
 * compare-and-swap, since the agent's calls add to it and the page judges and removes.
 */
const runsKey = (user: string) => `${userFolder(user)}runs.json`;
const noRuns = (): RunsDoc => ({ runs: [], agents: [] });

export async function listRuns(user: string) {
  return runsDocIn((await readDocument<unknown>(runsKey(user), noRuns())).doc).runs;
}

const changeRuns = (user: string, fn: (doc: RunsDoc) => RunsDoc) =>
  updateDocument<RunsDoc, void>(runsKey(user), noRuns(), (doc) => {
    const next = fn(runsDocIn(doc));
    doc.runs = next.runs;
    doc.agents = next.agents;
  });

/** A run's calls, and the agent's name when this is it connecting. */
export const recordRun = (
  user: string,
  id: string,
  events: RunEvent[],
  now: string,
  agent = '',
) => changeRuns(user, (doc) => withEvents(withStart(doc, id, agent, now), id, events, now));

export const judgeWork = (user: string, run: string, report: string, verdict: Verdict | null) =>
  changeRuns(user, (doc) => withVerdict(doc, run, report, verdict));

export const correctWork = (user: string, run: string, report: string, text: string) =>
  changeRuns(user, (doc) => withCorrection(doc, run, report, text));

export const dropRun = (user: string, id: string) =>
  changeRuns(user, (doc) => withoutRun(doc, id));

/**
 * Every account's use of its agent, for the pilot (D123): counts from each account's runs, by
 * the account's hashed key, newest use first. Nothing an agent made or said.
 */
export async function pilotRows(now: string): Promise<({ user: string } & PilotRow)[]> {
  const keys = (await listDocuments('pinch-users/')).filter((k) => k.endsWith('/runs.json'));
  const rows = await Promise.all(
    keys.map(async (k) => {
      const user = k.slice('pinch-users/'.length, -'/runs.json'.length);
      return { user, ...pilotRow(runsDocIn((await readDocument<unknown>(k, null)).doc).runs, now) };
    }),
  );
  return rows.sort((a, b) => (b.lastRun ?? '').localeCompare(a.lastRun ?? ''));
}

/**
 * The agent's readings of notes (D122), waiting for the page to apply them:
 * `pinch-users/<account>/readings.json`, changed by compare-and-swap, since the agent adds and
 * the page takes.
 */
const readingsKey = (user: string) => `${userFolder(user)}readings.json`;
type Readings = { readings: AgentReading[] };

export async function listReadings(user: string): Promise<AgentReading[]> {
  return agentReadingsIn((await readDocument<Readings>(readingsKey(user), { readings: [] })).doc);
}

export const addReading = (user: string, r: AgentReading) =>
  updateDocument<Readings, void>(readingsKey(user), { readings: [] }, (doc) => {
    doc.readings = withAgentReading(agentReadingsIn(doc), r);
  });

export const dropReading = (user: string, id: string) =>
  updateDocument<Readings, void>(readingsKey(user), { readings: [] }, (doc) => {
    doc.readings = agentReadingsIn(doc).filter((r) => r.id !== id);
  });

const memory = new Map<string, Uint8Array>();

export async function deleteBatch(user: string, id: string) {
  if (!hasBlob()) {
    memory.delete(batchKey(user, id));
    return;
  }
  await del(batchKey(user, id)).catch(() => undefined);
}

export const memoryBatch = {
  put: (user: string, id: string, bytes: Uint8Array) => memory.set(batchKey(user, id), bytes),
  get: (user: string, id: string) => memory.get(batchKey(user, id)),
};

/** A URL the browser can fetch the batch's zip from for the next few minutes. */
export async function batchDownloadUrl(user: string, id: string): Promise<string> {
  const pathname = batchKey(user, id);
  const validUntil = Date.now() + URL_MINUTES * 60_000;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil,
    useCache: false,
  });
  return presignedUrl;
}

/**
 * The signed token an upload of one batch zip needs: put only, that path only, zips only, and no
 * bigger than a batch may be or than the account has room for.
 */
export const uploadToken = (pathname: string, room = MAX_BATCH_BYTES) =>
  issueSignedToken({
    pathname,
    operations: ['put'],
    validUntil: Date.now() + URL_MINUTES * 60_000,
    allowedContentTypes: ['application/zip'],
    maximumSizeInBytes: Math.min(MAX_BATCH_BYTES, room),
  });

/** The bytes an account keeps, but for one path: the one about to be written over. */
export async function keptBytes(user: string, except = ''): Promise<number> {
  const prefix = userFolder(user);
  if (!hasBlob())
    return [...memory]
      .filter(([k]) => k.startsWith(prefix) && k !== except)
      .reduce((n, [, b]) => n + b.length, 0);
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) if (b.pathname !== except) total += b.size;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return total;
}

/**
 * Some files of one of the account's batch zips (D94), read by byte ranges: from the store on a
 * presigned URL when it takes ranges (the whole zip once when it doesn't), from memory locally.
 * An empty map when the batch isn't there.
 */
export async function batchFiles(
  user: string,
  id: string,
  paths: string[],
): Promise<Map<string, Uint8Array>> {
  if (!validId(id)) return new Map();
  if (!hasBlob()) {
    const bytes = memoryBatch.get(user, id);
    if (!bytes) return new Map();
    return readZipEntries(async (s, e) => bytes.subarray(s, e), bytes.length, paths);
  }
  const url = await batchDownloadUrl(user, id);
  const tail = await fetch(url, { headers: { Range: `bytes=-${TAIL_BYTES}` } });
  if (tail.status === 404) return new Map();
  if (!tail.ok) throw new Error(`The store answered ${tail.status}.`);
  const first = new Uint8Array(await tail.arrayBuffer());
  const size = Number(tail.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] ?? NaN);
  // No ranges: the store sent the whole zip.
  if (tail.status !== 206 || !Number.isFinite(size))
    return readZipEntries(async (s, e) => first.subarray(s, e), first.length, paths);
  const tailStart = size - first.length;
  return readZipEntries(
    async (s, e) => {
      if (s >= tailStart) return first.subarray(s - tailStart, e - tailStart);
      const r = await fetch(url, { headers: { Range: `bytes=${s}-${e - 1}` } });
      if (r.status !== 206) throw new Error(`The store answered ${r.status}.`);
      return new Uint8Array(await r.arrayBuffer());
    },
    size,
    paths,
  );
}
