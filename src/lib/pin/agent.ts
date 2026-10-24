import { jpegSize } from '@/lib/image';
import { CHECK_SCRIPT } from './check-script';
import { CHECK_SCRIPT_FILE, checksManifest, checksOf } from './checks';
import {
  type Collection,
  type ExportedNote,
  noteAbout,
  type RulePick,
  rulesOf,
  rulesText,
  screenTagsIn,
  tagsOf,
  waiting,
} from './learnings';
import {
  itemsLine,
  type Shape,
  shapePixels,
  TOPIC_KINDS,
  TOPICS,
  type Topic,
} from './model';
import { type Proposal, proposalOf } from './proposals';
import { reportOf, type RunEvent } from './runs';
import { briefOf, briefsLines, OPEN_CALLS, WORKING_LINES } from './screen-index';

/*
 * Your agent, connected (D89): Pinch as an MCP server an agent such as Claude
 * Code connects to once, with the person's own key, and asks for the rules a
 * task needs, always the current ones. This file is the pure part: the
 * JSON-RPC messages of MCP's Streamable HTTP transport (initialize, ping,
 * tools/list, tools/call), answered from the person's rules. Serving stored
 * rules costs no AI: the agent does the reading, on its own allowance. A
 * rule's notes come with their close-ups on request (D94): each crop as an
 * image, with the note's marker drawn in, and where the spot is as a box in
 * the crop's pixels and in the screenshot's. Asked for `whole`, the answer
 * also carries each screenshot once, its marked copy (D99). What the person
 * settles with the agent in conversation comes back as a proposed rule, to
 * wait for them on Your rules (D116). What each call asked for and got, and the agent's report
 * of what it made with the rules, go into the run's record for the person to judge (D120).
 */

/** The protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  `Pinch keeps this person’s design taste as rules drawn from their notes on screenshots. Before designing or building interface for them, call get_design_rules with the topics the task touches (and their own tags when the task belongs to a project or client), and follow what it returns. To narrow them to what the person noted on screenshots of one product, feature or domain, give its screen tag too; list_rule_topics names them. When a rule is unclear, or you need to see what the person marked, call get_rule_evidence with its number for the close-ups it comes from; add whole: true when the rule is about the screen as a whole (layout, hierarchy, spacing) and the close-ups don’t show enough. When you render what you build, call get_render_checks once and run its checks on every render, and on all your earlier work again whenever the rules, a check or a shared part changes. When the person settles something about their taste with you that their rules don’t hold, or holds otherwise (a correction, a choice between two rules), ask whether to keep it, and on a yes call propose_rule: it waits in Pinch for them to keep or drop. Do this even when you also write it into your own notes or files: Pinch is where their rules live, so every agent and session gets it. For the same reason, where your own notes of a rule differ from what get_design_rules returns now, the rule as returned wins: update your notes. ${OPEN_CALLS} Each time you report a piece of work, also call report_work with what you made, the rules you followed and set aside, the checks that failed and those decisions: the person sees it on Your rules beside what you asked Pinch for, and judges it. ${WORKING_LINES.join(' ')}`;

export const TOOLS = [
  {
    name: 'get_design_rules',
    title: 'Get design rules',
    description:
      'The design rules this person keeps in Pinch: their taste, drawn from notes they wrote on screenshots, to follow in design and front-end work. Pick the topics the task touches; leave them out for every rule. Give their own tags (a project, a client) when the task belongs to one, to get those rules along with their general ones. Each rule says where it holds and lists the notes it comes from, with the tag of each note’s screenshot (a product, a feature, a domain). To keep only the rules drawn from screenshots with a tag, give it in screenTags: a narrower list, not a different taste, so leave it out unless the task is about that one. The author’s brief for a product or feature (what it is for and how it should feel) comes first: for the screen tags given, or every one.',
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
        screenTags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Only rules drawn from screenshots with one of these tags (a product, a feature, a domain), as list_rule_topics names them.',
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
      'The notes one rule comes from, each with its close-up: a crop of the screenshot with the note’s marker drawn in (a ring on a dot, a box around an area, an arrow), and where the spot is as numbers, in the crop’s pixels and in the whole screenshot’s. Use it when a rule is unclear or you need to see what the person marked. Give the rule’s number as get_design_rules shows it (R3). With whole: true it also returns each screenshot the notes are on, once, with every marker drawn in: for rules about the screen as a whole (layout, hierarchy, spacing). It costs far more context, so look at the close-ups first.',
    inputSchema: {
      type: 'object',
      properties: {
        rule: {
          type: 'string',
          description: 'The rule’s number, as get_design_rules shows it: R3.',
        },
        whole: {
          type: 'boolean',
          description:
            'Also return the whole screenshots, with the markers drawn in. Leave it out for the close-ups alone.',
        },
      },
      required: ['rule'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_render_checks',
    title: 'Get render checks',
    description:
      'Checks a script can hold on any rendered page, worked out by Pinch from this person’s rules (D109): the smallest text, text contrast, colours to avoid, the fonts allowed, fonts to avoid and how many type sizes, each with the rules it holds by number. The person didn’t set the numbers, and some are estimates (each check’s why says so), so read a failure as a likely break of the rules it names and look at the render before changing it. Returns the checks as JSON, and check-render.js: plain JavaScript to run them in a page (Playwright, Puppeteer, a browser console). Load the script, then pinchChecks.run(checks, { scale }) with scale the size the page is shown at over the size it is rendered at, and pinchChecks.report(result) for one line per failure.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'boolean',
          description: 'Leave out, or true, for check-render.js too; false when you already have it.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'propose_rule',
    title: 'Propose a rule',
    description:
      'Propose a rule the person agreed with you in conversation, so it isn’t lost when this conversation ends: a correction, a choice between two rules, a preference they stated. Call it even when you also write the rule into your own notes or files; only here does it reach their rules. It doesn’t change their rules: it waits on Your rules in Pinch until they keep or drop it, and only a kept one reaches you through get_design_rules. Ask the person first, and propose only what they agreed. To change one of their rules, give its number as get_design_rules shows it (R3) and the whole rule as it should read; leave rule out for a new one. Write the rule as they would keep it, one sentence, without naming products or companies.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The rule, one sentence, as the person would keep it.',
        },
        rule: {
          type: 'string',
          description:
            'The number of the rule this changes, as get_design_rules shows it: R3. Leave out for a new rule.',
        },
        where: {
          type: 'string',
          description: 'Where it holds, a few words ("in AI features"). Leave out for everywhere.',
        },
        topics: {
          type: 'array',
          items: { type: 'string', enum: [...TOPIC_KINDS] },
          description: `What it is about: ${TOPICS.map((t) => t.kind).join(', ')}.`,
        },
        why: {
          type: 'string',
          description: 'What the person said or agreed that this keeps, in a sentence.',
        },
      },
      required: ['text', 'why'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'report_work',
    title: 'Report a piece of work',
    description:
      'Tell Pinch what you made with the person’s rules, each time you report a piece of work to them: what it is, the rules you followed and the ones you set aside with why, the render checks that failed, and the decisions that need their call. It goes on Your rules in Pinch beside what this session asked Pinch for, where the person judges the work, so they see which rules do the work, which get set aside and which never come up. Give rules by their numbers as get_design_rules shows them (R3). Write no file names, links or customer data. It changes no rules.',
    inputSchema: {
      type: 'object',
      properties: {
        work: {
          type: 'string',
          description: 'What you made, a few words ("Agent Hub, feature focus").',
        },
        followed: {
          type: 'array',
          items: { type: 'string' },
          description: 'The rules the work follows, by number: R3.',
        },
        setAside: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rule: { type: 'string', description: 'Its number: R3.' },
              why: { type: 'string', description: 'Why, in a sentence.' },
            },
            required: ['rule', 'why'],
            additionalProperties: false,
          },
          description: 'The rules you set aside, each with why.',
        },
        checksRun: {
          type: 'integer',
          description: 'How many render checks you ran on it. Leave out when you ran none.',
        },
        failedChecks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string', description: 'The check’s name.' },
              rules: {
                type: 'array',
                items: { type: 'string' },
                description: 'The rules it holds, by number.',
              },
            },
            required: ['check'],
            additionalProperties: false,
          },
          description: 'The checks that still fail on it.',
        },
        openCalls: {
          type: 'array',
          items: { type: 'string' },
          description: 'The decisions that need the person’s call, one line each with the options.',
        },
      },
      required: ['work'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
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
    note.works ? `works: "${itemsLine(note.works)}"` : '',
    note.doesNotWork ? `doesn't: "${itemsLine(note.doesNotWork)}"` : '',
  ].filter(Boolean);
  const lines = [
    `Note ${note.ref} on ${note.image}${noteAbout(note)}: ${said.join('; ')}`,
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

/**
 * A screenshot's marked copy, read from its batch's `notes.json`: the path inside the zip's
 * folder ("marked/02-pricing.jpg") and the screenshot's own size. Null when it isn't there.
 */
export function markedOf(
  manifest: unknown,
  assetNumber: string,
): { path: string; width: number; height: number } | null {
  const assets = (manifest as { assets?: unknown })?.assets;
  if (!Array.isArray(assets)) return null;
  const a = assets.find((x) => x?.number === assetNumber) as
    | { marked?: unknown; width?: unknown; height?: unknown }
    | undefined;
  const width = num(a?.width);
  const height = num(a?.height);
  if (typeof a?.marked !== 'string' || !a.marked || !width || !height) return null;
  return { path: a.marked, width, height };
}

/** One screenshot's part of the answer: which notes are on it, its size and scale, and the image. */
function screenshotContent(
  notes: ExportedNote[],
  files: Map<string, Uint8Array>,
  manifest: unknown,
  budget: { left: number },
): Content[] {
  const { batch, note } = notes[0];
  const refs = notes.map((x) => x.note.ref).join(', ');
  const marked = markedOf(manifest, note.ref.split('.')[0]);
  const bytes = marked ? files.get(batch.root + marked.path) : undefined;
  const size = bytes ? jpegSize(bytes) : null;
  const head = `Screenshot ${note.image}, with ${notes.length === 1 ? 'note' : 'notes'} ${refs}`;
  if (!marked || !bytes || !size) return [{ type: 'text', text: `${head}: no screenshot kept.` }];
  if (bytes.length > budget.left)
    return [{ type: 'text', text: `${head}: left out to keep this answer small.` }];
  budget.left -= bytes.length;
  const scale = round4(size.width / marked.width);
  return [
    {
      type: 'text',
      text: `${head}: the whole screen with every marker drawn in, ${size.width}×${size.height} pixels${scale === 1 ? '' : `, the screenshot scaled by ${scale} (multiply a note’s screenshot box by it)`}.`,
    },
    { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/jpeg' },
  ];
}

const EVIDENCE_GUIDE =
  'Each close-up is a crop of the screenshot with the note’s marker drawn in: a ring on a dot, a box around an area, an arrow from its tail to its head, with the note’s number on a disc beside it (the spot is the ring, box or arrow, never the disc). Boxes are in pixels from the top-left corner, x across and y down: a dot is {x, y}, an area {x, y, w, h}, an arrow {x, y} at its tail to {x2, y2} at its head. `closeUp` is in the crop’s own pixels, `screenshot` in the whole screenshot’s (`fraction`: the same as fractions of it, 0 to 1). Screenshot pixels are not CSS pixels: a screenshot from a high-density screen is two or three times larger.';

/**
 * A rule's close-ups, as tool content: the rule, how to read the boxes, then each note; with
 * `whole`, then each screenshot the notes are on, once, in what the close-ups leave of the budget.
 */
export async function evidenceContent(
  c: Collection,
  ruleArg: unknown,
  files: BatchFiles,
  whole = false,
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
  if (!whole) return { content };
  const screens = new Map<string, ExportedNote[]>();
  for (const x of shown) {
    const key = `${x.batch.id}/${x.note.ref.split('.')[0]}`;
    screens.set(key, [...(screens.get(key) ?? []), x]);
  }
  await Promise.all(
    [...byBatch.entries()].map(async ([id, notes]) => {
      const got = read.get(id);
      if (!got?.manifest) return;
      const paths = new Set<string>();
      for (const x of notes) {
        const marked = markedOf(got.manifest, x.note.ref.split('.')[0]);
        if (marked) paths.add(notes[0].batch.root + marked.path);
      }
      if (!paths.size) return;
      const more = await files(id, [...paths]).catch(() => new Map<string, Uint8Array>());
      for (const [k, v] of more) got.files.set(k, v);
    }),
  );
  for (const notes of screens.values()) {
    const got = read.get(notes[0].batch.id);
    content.push(
      ...screenshotContent(notes, got?.files ?? new Map(), got?.manifest ?? null, budget),
    );
  }
  return { content };
}

/** The pick a call asks for: known topics only; tags with the general rules (no tag) too. */
export function pickOf(args: unknown): RulePick {
  const a = (args && typeof args === 'object' ? args : {}) as {
    topics?: unknown;
    tags?: unknown;
    screenTags?: unknown;
  };
  const topics = Array.isArray(a.topics)
    ? a.topics.filter((t): t is Topic => (TOPIC_KINDS as readonly string[]).includes(t))
    : [];
  const tags = Array.isArray(a.tags)
    ? a.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    : [];
  const screen = (Array.isArray(a.screenTags) ? a.screenTags : [a.screenTags]).filter(
    (x): x is string => typeof x === 'string' && x.trim() !== '',
  );
  return {
    ...(topics.length ? { topics: [...topics, null] } : {}),
    ...(tags.length ? { tags: [...tags, null] } : {}),
    ...(screen.length ? { screen } : {}),
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
  const screens = c ? screenTagsIn(c, live) : [];
  if (screens.length) {
    lines.push(
      'Screen tags, the tags of the screenshots rules are drawn from (screenTags), with a brief where the author wrote one:',
    );
    for (const v of screens)
      lines.push(`- ${v.value}: ${v.n}${c && briefOf(c, v.value) ? ', with a brief' : ''}`);
  }
  return lines.join('\n');
}

/** Where a proposed rule goes to wait (D116): a fresh id for it, and the store's write. */
export type ProposalStore = { id: () => string; save: (p: Proposal) => Promise<void> };

/** Where a run's calls go (D120): a fresh id for a report, and what each call adds. */
export type RunLog = { id: () => string; add: (e: RunEvent) => void };

/** A rule proposed by the agent, checked and stored to wait for the person (D116). */
async function proposeContent(
  c: Collection | null,
  args: unknown,
  store: ProposalStore,
  log?: RunLog,
) {
  const out = proposalOf(args, c, new Date().toISOString(), store.id());
  if ('error' in out) return text(out.error, true);
  await store.save(out.proposal);
  log?.add({ kind: 'proposal', id: out.proposal.id });
  const number = out.proposal.rule
    ? rulesOf(c as Collection).find((r) => r.rule.id === out.proposal.rule)?.id
    : undefined;
  return text(
    number
      ? `Proposed a change to ${number}. It waits on Your rules in Pinch for the person to keep or drop; until then ${number} stays as it was.`
      : 'Proposed. It waits on Your rules in Pinch for the person to keep or drop; it isn’t one of their rules until they keep it.',
  );
}

/** The agent's report of a piece of work, checked and added to its run (D120). */
function reportContent(c: Collection | null, args: unknown, log: RunLog) {
  const out = reportOf(args, c, new Date().toISOString(), log.id());
  if ('error' in out) return text(out.error, true);
  log.add({ kind: 'report', report: out.report });
  return text(
    `Reported. It shows on Your rules in Pinch for the person to judge.${out.unknown.length ? ` Left out, not rules: ${out.unknown.join(', ')}.` : ''}`,
  );
}

/**
 * One JSON-RPC message answered: a reply for a request, nothing for a notification. `rules`
 * reads the person's one collection when a tool needs it, `files` its batches' close-ups,
 * `proposals` where a rule the agent proposes waits, `log` the run's record.
 */
export async function answer(
  m: RpcMessage,
  rules: () => Promise<Collection | null>,
  files?: BatchFiles,
  proposals?: ProposalStore,
  log?: RunLog,
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
      if (params.name === 'propose_rule') {
        if (!proposals) return reply(id, text('Proposing rules isn’t available here.', true));
        return reply(id, await proposeContent(await rules(), params.arguments, proposals, log));
      }
      if (params.name === 'report_work') {
        if (!log) return reply(id, text('Reporting work isn’t available here.', true));
        return reply(id, reportContent(await rules(), params.arguments, log));
      }
      if (params.name === 'get_render_checks') {
        const c = await rules();
        log?.add({ kind: 'checks' });
        const args = (params.arguments ?? {}) as { script?: unknown };
        return reply(id, renderChecksContent(c, args.script !== false));
      }
      if (params.name === 'get_rule_evidence') {
        const c = await rules();
        if (!c || !files)
          return reply(id, text(c ? 'Close-ups aren’t available here.' : 'No rules yet.', true));
        const args = (params.arguments ?? {}) as { rule?: unknown; whole?: unknown };
        const shown = await evidenceContent(c, args.rule, files, args.whole === true);
        const n = Number(String(args.rule ?? '').trim().replace(/^r/i, ''));
        const r = !shown.isError && Number.isInteger(n) ? rulesOf(c)[n - 1] : undefined;
        if (r) log?.add({ kind: 'evidence', rule: r.rule.id });
        return reply(id, shown);
      }
      if (params.name !== 'get_design_rules')
        return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      const c = await rules();
      const pick = pickOf(params.arguments);
      const picked = c ? numberedRules(c, pick) : [];
      log?.add({
        kind: 'rules',
        topics: (pick.topics ?? []).filter((t): t is Topic => t !== null),
        tags: (pick.tags ?? []).filter((t): t is string => t !== null),
        screen: [...(pick.screen ?? [])],
        rules: picked.map((r) => r.rule.id),
      });
      if (!c || !picked.length) {
        // A product with no rules yet may still have its brief (D121).
        const briefs = c && pick.screen ? briefsLines(c, pick.screen) : [];
        return reply(
          id,
          text(
            [
              c?.rules.length
                ? 'No rules about that. Call list_rule_topics to see what the rules cover, or ask again without topics for every rule.'
                : 'No rules yet. They come from the notes this person writes on screenshots in Pinch.',
              ...briefs,
            ].join('\n'),
          ),
        );
      }
      return reply(
        id,
        text(
          `${rulesText(c, picked, pick.screen)}\nTo see the notes a rule comes from, with their close-ups and where each spot is, call get_rule_evidence with its number.\n`,
        ),
      );
    }
    default:
      return failure(id, -32601, `Method not found: ${m.method}`);
  }
}

/**
 * The render checks for an agent (D109, D110): the same `checks.json` the package carries, and
 * the script that runs them unless the agent says it has it.
 */
export function renderChecksContent(c: Collection | null, withScript: boolean) {
  if (!c || !checksOf(c).length)
    return text(
      'No render checks yet. Pinch works them out from the rules while the person has Your rules open; call get_design_rules and follow the rules meanwhile.',
    );
  const spec = JSON.stringify(checksManifest(c, rulesOf(c), new Date().toISOString()), null, 2);
  return {
    content: [
      { type: 'text', text: `checks.json:\n${spec}` },
      ...(withScript ? [{ type: 'text', text: `${CHECK_SCRIPT_FILE}:\n${CHECK_SCRIPT}` }] : []),
    ],
  };
}
