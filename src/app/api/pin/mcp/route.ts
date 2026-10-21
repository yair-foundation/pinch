import { userOfAgentKey } from '@/lib/agent-keys';
import { batchFiles, listCollections } from '@/lib/cloud';
import { answer, type RpcMessage } from '@/lib/pin/agent';
import { type Collection, mergeCollection, upgradeCollection } from '@/lib/pin/learnings';

/*
 * Pinch for agents (D89): an MCP server on the Streamable HTTP transport, one
 * JSON-RPC message (or a batch) per POST, answered as JSON. The agent sends
 * the account's key as `Authorization: Bearer pk_…`; any account, bought or
 * free, at any balance (D98). Its tools hand over the account's rules, read from the store
 * at each call, so the agent always has the current ones, and a rule's
 * close-ups from the account's own batch zips (D94). No AI runs here, and
 * nothing about the call is logged but its method.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 100_000;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const rpcError = (status: number, code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers });

/** The account's one collection, as the page would show it (D86, D87). */
async function rulesOf(user: string): Promise<Collection | null> {
  const list = ((await listCollections(user)) as Collection[])
    .map((c) => upgradeCollection(c, () => Math.random().toString(36).slice(2)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [first, ...rest] = list;
  if (!first) return null;
  return rest.reduce((one, c) => mergeCollection(one, c, first.updatedAt), first);
}

export async function POST(request: Request) {
  const key = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  const user = key ? await userOfAgentKey(key) : null;
  if (!user)
    return rpcError(401, -32001, 'Connect with your Pinch key: Account, then Connect your agent.');
  const body = await request.text().catch(() => '');
  if (!body || body.length > MAX_BODY) return rpcError(400, -32700, 'Parse error');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return rpcError(400, -32700, 'Parse error');
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as RpcMessage[];
  let cached: Promise<Collection | null> | null = null;
  const rules = () => {
    cached ??= rulesOf(user);
    return cached;
  };
  const replies = [];
  for (const m of messages.slice(0, 20)) {
    if (m && typeof m === 'object' && typeof m.method === 'string')
      console.log(`[pin] mcp ${m.method}`);
    const r = await answer(m && typeof m === 'object' ? m : {}, rules, (id, paths) =>
      batchFiles(user, id, paths),
    );
    if (r) replies.push(r);
  }
  // Notifications only: accepted, nothing to say.
  if (!replies.length) return new Response(null, { status: 202, headers });
  return Response.json(Array.isArray(parsed) ? replies : replies[0], { headers });
}

/** No server-sent stream: every answer comes back on its POST. */
export function GET() {
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...headers, Allow: 'POST' },
  });
}
