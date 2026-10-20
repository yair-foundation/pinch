import { type Collection, type RulePick, rulesOf, rulesText, tagsOf, waiting } from './learnings';
import { TOPIC_KINDS, TOPICS, type Topic } from './model';

/*
 * Your agent, connected (D89): Pinch as an MCP server an agent such as Claude
 * Code connects to once, with the person's own key, and asks for the rules a
 * task needs, always the current ones. This file is the pure part: the
 * JSON-RPC messages of MCP's Streamable HTTP transport (initialize, ping,
 * tools/list, tools/call), answered from the person's rules. Serving stored
 * rules costs no AI: the agent does the reading, on its own allowance.
 */

/** The protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Pinch keeps this person’s design taste as rules drawn from their notes on screenshots. Before designing or building interface for them, call get_design_rules with the topics the task touches (and their own tags when the task belongs to a project or client), and follow what it returns.';

export const TOOLS = [
  {
    name: 'get_design_rules',
    title: 'Get design rules',
    description:
      'The design rules this person keeps in Pinch: their taste, drawn from notes they wrote on screenshots, to follow in design and front-end work. Pick the topics the task touches; leave them out for every rule. Give their own tags (a project, a client) when the task belongs to one, to get those rules along with their general ones. Each rule says where it holds and lists the notes it comes from.',
    inputSchema: {
      type: 'object',
      properties: {
        topics: {
          type: 'array',
          items: { type: 'string', enum: [...TOPIC_KINDS] },
          description: `What the task is about: ${TOPICS.map((t) => `${t.kind} (${t.hint})`).join('; ')}.`,
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'The person’s own tags the task belongs to, as list_rule_topics names them.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_rule_topics',
    title: 'List rule topics',
    description:
      'How many of this person’s rules are about each topic and carry each of their own tags, to choose what to ask get_design_rules for.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

type Id = string | number | null;
export type RpcMessage = { jsonrpc?: string; id?: Id; method?: unknown; params?: unknown };
export type RpcReply =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

const reply = (id: Id, result: unknown): RpcReply => ({ jsonrpc: '2.0', id, result });
const failure = (id: Id, code: number, message: string): RpcReply => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});
const text = (s: string, isError = false) => ({
  content: [{ type: 'text', text: s }],
  ...(isError ? { isError: true } : {}),
});

/** The pick a call asks for: known topics only; tags with the general rules (no tag) too. */
export function pickOf(args: unknown): RulePick {
  const a = (args && typeof args === 'object' ? args : {}) as { topics?: unknown; tags?: unknown };
  const topics = Array.isArray(a.topics)
    ? a.topics.filter((t): t is Topic => (TOPIC_KINDS as readonly string[]).includes(t))
    : [];
  const tags = Array.isArray(a.tags)
    ? a.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    : [];
  return {
    ...(topics.length ? { topics: [...topics, null] } : {}),
    ...(tags.length ? { tags: [...tags, null] } : {}),
  };
}

/** What the rules are about, counted: the answer to list_rule_topics. */
export function topicsText(c: Collection | null): string {
  const live = (c?.rules ?? []).filter(
    (r) => r.status === 'approved' && !r.locked && !waiting(r) && r.text,
  );
  if (!live.length) return 'No rules yet.';
  const lines = [`${live.length} ${live.length === 1 ? 'rule' : 'rules'}.`, 'Topics:'];
  for (const t of TOPICS) {
    const n = live.filter((r) => r.topics.includes(t.kind)).length;
    if (n) lines.push(`- ${t.kind}: ${n}`);
  }
  const tags = tagsOf(live);
  if (tags.length) {
    lines.push('Their own tags:');
    for (const t of tags) lines.push(`- ${t}: ${live.filter((r) => r.tags.includes(t)).length}`);
  }
  return lines.join('\n');
}

/**
 * One JSON-RPC message answered: a reply for a request, nothing for a notification. `rules`
 * reads the person's one collection when a tool needs it.
 */
export async function answer(
  m: RpcMessage,
  rules: () => Promise<Collection | null>,
): Promise<RpcReply | null> {
  const id = m.id ?? null;
  if (m.id === undefined) return null;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string')
    return failure(id, -32600, 'Invalid request');
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as {
    protocolVersion?: unknown;
    name?: unknown;
    arguments?: unknown;
  };
  switch (m.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return reply(id, {
        protocolVersion:
          typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pinch', title: 'Pinch', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      if (params.name === 'list_rule_topics') return reply(id, text(topicsText(await rules())));
      if (params.name !== 'get_design_rules')
        return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      const c = await rules();
      const picked = c ? rulesOf(c, pickOf(params.arguments)) : [];
      if (!c || !picked.length)
        return reply(
          id,
          text(
            c?.rules.length
              ? 'No rules about that. Call list_rule_topics to see what the rules cover, or ask again without topics for every rule.'
              : 'No rules yet. They come from the notes this person writes on screenshots in Pinch.',
          ),
        );
      return reply(id, text(rulesText(c, picked)));
    }
    default:
      return failure(id, -32601, `Method not found: ${m.method}`);
  }
}
