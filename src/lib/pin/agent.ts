import { jpegSize } from '@/lib/image';
import {
  type Collection,
  type ExportedNote,
  type RulePick,
  rulesOf,
  rulesText,
  tagsOf,
  waiting,
} from './learnings';
import { type Shape, shapePixels, sourceLabel, TOPIC_KINDS, TOPICS, type Topic } from './model';

/*
 * Your agent, connected (D89): Pinch as an MCP server an agent such as Claude
 * Code connects to once, with the person's own key, and asks for the rules a
 * task needs, always the current ones. This file is the pure part: the
 * JSON-RPC messages of MCP's Streamable HTTP transport (initialize, ping,
 * tools/list, tools/call), answered from the person's rules. Serving stored
 * rules costs no AI: the agent does the reading, on its own allowance. A
 * rule's notes come with their close-ups on request (D94): each crop as an
 * image, with the note's marker drawn in, and where the spot is as a box in
 * the crop's pixels and in the screenshot's.
 */

/** The protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Pinch keeps this person’s design taste as rules drawn from their notes on screenshots. Before designing or building interface for them, call get_design_rules with the topics the task touches (and their own tags when the task belongs to a project or client), and follow what it returns. When a rule is unclear, or you need to see what the person marked, call get_rule_evidence with its number for the close-ups it comes from.';

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
    name: 'get_rule_evidence',
    title: 'Get a rule’s close-ups',
    description:
      'The notes one rule comes from, each with its close-up: a crop of the screenshot with the note’s marker drawn in (a ring on a dot, a box around an area, an arrow), and where the spot is as numbers, in the crop’s pixels and in the whole screenshot’s. Use it when a rule is unclear or you need to see what the person marked. Give the rule’s number as get_design_rules shows it (R3).',
    inputSchema: {
      type: 'object',
      properties: {
        rule: {
          type: 'string',
          description: 'The rule’s number, as get_design_rules shows it: R3.',
        },
      },
      required: ['rule'],
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

/**
 * The rules a pick takes, numbered as among all of them, so a rule keeps its number whatever
 * the pick and get_rule_evidence finds it by that number.
 */
export function numberedRules(c: Collection, pick: RulePick) {
  const taken = new Set(rulesOf(c, pick).map((r) => r.rule.id));
  return rulesOf(c).filter((r) => taken.has(r.rule.id));
}

/** A batch's files by their paths inside its zip; the ones it doesn't have are left out. */
export type BatchFiles = (batchId: string, paths: string[]) => Promise<Map<string, Uint8Array>>;

/** Close-ups in one answer: enough to see a rule, little enough for an agent's context. */
export const MAX_EVIDENCE = 8;
/**
 * The crops' bytes one answer carries: base64 adds a third, and a function's answer must stay
 * under 4.5 MB. A crop past it is left out as an image; its numbers still come.
 */
export const MAX_EVIDENCE_BYTES = 3_000_000;

type Rect = { x: number; y: number; w: number; h: number };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Where a note sits, read from its batch's `notes.json`: the screenshot's size, the note's
 * shape (fractions of the screenshot) and the part of the screenshot its crop shows. Null when
 * the note isn't there.
 */
export function placeOf(
  manifest: unknown,
  ref: string,
): { width: number; height: number; shape: Shape; crop?: Rect } | null {
  const [assetNumber, noteNumber] = ref.split('.');
  const assets = (manifest as { assets?: unknown })?.assets;
  if (!Array.isArray(assets)) return null;
  const a = assets.find((x) => x?.number === assetNumber) as
    | { width?: unknown; height?: unknown; notes?: unknown }
    | undefined;
  const width = num(a?.width);
  const height = num(a?.height);
  if (!a || !width || !height || !Array.isArray(a.notes)) return null;
  const n = a.notes.find((x) => x?.number === Number(noteNumber)) as
    | { shape?: Record<string, unknown>; cropPixels?: Record<string, unknown> }
    | undefined;
  const sh = n?.shape;
  const unit = (k: string) => {
    const v = num(sh?.[k]);
    return v !== undefined && v >= 0 && v <= 1 ? v : undefined;
  };
  let shape: Shape | null = null;
  if (sh?.kind === 'dot' && [unit('x'), unit('y')].every((v) => v !== undefined))
    shape = { kind: 'dot', x: unit('x') as number, y: unit('y') as number };
  else if (sh?.kind === 'area' && ['x', 'y', 'w', 'h'].every((k) => unit(k) !== undefined))
    shape = {
      kind: 'area',
      x: unit('x') as number,
      y: unit('y') as number,
      w: unit('w') as number,
      h: unit('h') as number,
    };
  else if (sh?.kind === 'arrow' && ['x', 'y', 'x2', 'y2'].every((k) => unit(k) !== undefined))
    shape = {
      kind: 'arrow',
      x: unit('x') as number,
      y: unit('y') as number,
      x2: unit('x2') as number,
      y2: unit('y2') as number,
    };
  if (!shape) return null;
  const cp = n?.cropPixels;
  const crop =
    cp && ['x', 'y', 'w', 'h'].every((k) => num(cp[k]) !== undefined) && (num(cp.w) as number) > 0
      ? { x: cp.x as number, y: cp.y as number, w: cp.w as number, h: cp.h as number }
      : undefined;
  return { width, height, shape, ...(crop ? { crop } : {}) };
}

/** A box in the crop's own pixels: the screenshot's box moved to the crop and scaled as it was. */
export function boxInCrop(
  px: Record<string, number>,
  crop: Rect,
  size: { width: number; height: number },
): Record<string, number> {
  const sx = size.width / crop.w;
  const sy = size.height / crop.h;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(px))
    out[k] =
      k === 'x' || k === 'x2'
        ? Math.round((v - crop.x) * sx)
        : k === 'y' || k === 'y2'
          ? Math.round((v - crop.y) * sy)
          : Math.round(v * (k === 'w' ? sx : sy));
  return out;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const shapeFractions = (s: Shape) =>
  Object.fromEntries(
    Object.entries(s)
      .filter(([k]) => k !== 'kind')
      .map(([k, v]) => [k, round4(v as number)]),
  );

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** One note's part of the answer: what it says, where its spot is, and its close-up. */
function noteContent(
  n: ExportedNote,
  files: Map<string, Uint8Array>,
  manifest: unknown,
  budget: { left: number },
): Content[] {
  const { note, batch } = n;
  const place = placeOf(manifest, note.ref);
  const crop = files.get(batch.root + note.crop);
  const size = crop ? jpegSize(crop) : null;
  const said = [
    note.label ? `named "${note.label}"` : '',
    note.works ? `works: "${note.works}"` : '',
    note.doesNotWork ? `doesn't: "${note.doesNotWork}"` : '',
  ].filter(Boolean);
  const lines = [
    `Note ${note.ref} on ${note.image}${note.source ? ` (${sourceLabel(note.source)})` : ''}: ${said.join('; ')}`,
  ];
  if (place) {
    const px: Record<string, number> = Object.fromEntries(
      Object.entries(shapePixels(place.shape, place.width, place.height)),
    );
    const where: Record<string, unknown> = {
      shape: place.shape.kind,
      screenshot: {
        width: place.width,
        height: place.height,
        box: px,
        fraction: shapeFractions(place.shape),
      },
    };
    if (size && place.crop)
      where.closeUp = {
        width: size.width,
        height: size.height,
        box: boxInCrop(px, place.crop, size),
        showsScreenshotPixels: place.crop,
      };
    lines.push(JSON.stringify(where));
  }
  const content: Content[] = [{ type: 'text', text: lines.join('\n') }];
  if (crop && size && crop.length <= budget.left) {
    budget.left -= crop.length;
    content.push({
      type: 'image',
      data: Buffer.from(crop).toString('base64'),
      mimeType: 'image/jpeg',
    });
  } else
    content.push({
      type: 'text',
      text:
        crop && size
          ? 'Close-up left out to keep this answer small.'
          : 'No close-up for this note.',
    });
  return content;
}

const EVIDENCE_GUIDE =
  'Each close-up is a crop of the screenshot with the note’s marker drawn in: a ring on a dot, a box around an area, an arrow from its tail to its head, with the note’s number on a disc beside it (the spot is the ring, box or arrow, never the disc). Boxes are in pixels from the top-left corner, x across and y down: a dot is {x, y}, an area {x, y, w, h}, an arrow {x, y} at its tail to {x2, y2} at its head. `closeUp` is in the crop’s own pixels, `screenshot` in the whole screenshot’s (`fraction`: the same as fractions of it, 0 to 1). Screenshot pixels are not CSS pixels: a screenshot from a high-density screen is two or three times larger.';

/** A rule's close-ups, as tool content: the rule, how to read the boxes, then each note. */
export async function evidenceContent(
  c: Collection,
  ruleArg: unknown,
  files: BatchFiles,
): Promise<{ content: Content[]; isError?: boolean }> {
  const all = rulesOf(c);
  const n = typeof ruleArg === 'string' ? Number(ruleArg.trim().replace(/^r/i, '')) : NaN;
  const r = Number.isInteger(n) ? all[n - 1] : undefined;
  if (!r)
    return {
      ...text(
        all.length
          ? `No rule ${String(ruleArg)}. Rules are numbered ${all[0].id} to ${all[all.length - 1].id}; get_design_rules shows them.`
          : 'No rules yet.',
        true,
      ),
    } as { content: Content[]; isError: boolean };
  const shown = r.notes.slice(0, MAX_EVIDENCE);
  const byBatch = new Map<string, ExportedNote[]>();
  for (const x of shown) byBatch.set(x.batch.id, [...(byBatch.get(x.batch.id) ?? []), x]);
  const read = new Map<string, { files: Map<string, Uint8Array>; manifest: unknown }>();
  await Promise.all(
    [...byBatch.entries()].map(async ([id, notes]) => {
      const root = notes[0].batch.root;
      const got = await files(id, [
        `${root}notes.json`,
        ...notes.map((x) => root + x.note.crop),
      ]).catch(() => new Map<string, Uint8Array>());
      let manifest: unknown = null;
      try {
        const json = got.get(`${root}notes.json`);
        if (json) manifest = JSON.parse(new TextDecoder().decode(json));
      } catch {
        manifest = null;
      }
      read.set(id, { files: got, manifest });
    }),
  );
  const content: Content[] = [
    {
      type: 'text',
      text: [
        `${r.id}. ${r.rule.text.trim()}`,
        `${r.notes.length} ${r.notes.length === 1 ? 'note' : 'notes'}${r.notes.length > shown.length ? `, the first ${shown.length} here` : ''}.`,
        EVIDENCE_GUIDE,
      ].join('\n'),
    },
  ];
  const budget = { left: MAX_EVIDENCE_BYTES };
  for (const x of shown) {
    const got = read.get(x.batch.id);
    content.push(...noteContent(x, got?.files ?? new Map(), got?.manifest ?? null, budget));
  }
  return { content };
}

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
 * reads the person's one collection when a tool needs it, `files` its batches' close-ups.
 */
export async function answer(
  m: RpcMessage,
  rules: () => Promise<Collection | null>,
  files?: BatchFiles,
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
      if (params.name === 'get_rule_evidence') {
        const c = await rules();
        if (!c || !files)
          return reply(id, text(c ? 'Close-ups aren’t available here.' : 'No rules yet.', true));
        const args = (params.arguments ?? {}) as { rule?: unknown };
        return reply(id, await evidenceContent(c, args.rule, files));
      }
      if (params.name !== 'get_design_rules')
        return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      const c = await rules();
      const picked = c ? numberedRules(c, pickOf(params.arguments)) : [];
      if (!c || !picked.length)
        return reply(
          id,
          text(
            c?.rules.length
              ? 'No rules about that. Call list_rule_topics to see what the rules cover, or ask again without topics for every rule.'
              : 'No rules yet. They come from the notes this person writes on screenshots in Pinch.',
          ),
        );
      return reply(
        id,
        text(
          `${rulesText(c, picked)}\nTo see the notes a rule comes from, with their close-ups and where each spot is, call get_rule_evidence with its number.\n`,
        ),
      );
    }
    default:
      return failure(id, -32601, `Method not found: ${m.method}`);
  }
}
