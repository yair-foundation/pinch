import { jpegSize } from '@/lib/image';
import {
  type AgentReading,
  agentReadingOf,
  notesToRead,
  READING_GUIDE,
  readingInputSchema,
  readingPrompt,
  tidyPrompt,
  withReadings,
} from './agent-reading';
import { type Changes, changesLines, changesSince } from './changes';
import { CHECK_SCRIPT } from './check-script';
import { CHECK_SCRIPT_FILE, checksManifest, checksOf } from './checks';
import { CLOSE_UPS } from './learn';
import {
  type Collection,
  type ExportedNote,
  noteAbout,
  type RulePick,
  rulesOf,
  rulesText,
  rulesVersion,
  tagsOf,
  tidyDue,
  unreadNotes,
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
import { gapsLines, readinessLine, readinessOf } from './readiness';
import { correctionsLines, type Run, type RunEvent } from './runs';
import { briefsLines, linkedTags, OPEN_CALLS, REVIEW_LINE, WORKING_LINES } from './screen-index';

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
 * also carries each screenshot once, its marked copy (D99). What each call
 * asked for and got goes into the run's record (D120). The agent no longer
 * proposes rules or reports its work: Your rules doesn't show either (D144).
 * The agent can also read the person's new notes into rules itself, on its
 * own allowance (D122).
 */

/** The protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  `Pinch keeps this person’s design taste as rules drawn from their notes on screenshots. Before designing or building interface for them, call get_design_rules with the topics the task touches (and their own tags when the task belongs to a project or client), and follow what it returns. To narrow them to what the person noted on screenshots of one product, feature or domain, give its screen tag too; list_rule_topics names them. When a rule is unclear, or you need to see what the person marked, call get_rule_evidence with its number for the close-ups it comes from; add whole: true when the rule is about the screen as a whole (layout, hierarchy, spacing) and the close-ups don’t show enough. When you render what you build, call get_render_checks once and run its checks on every render, and on all your earlier work again whenever the rules, a check or a shared part changes. ${REVIEW_LINE} Pinch is where their rules live, for every agent and session, so where your own notes of a rule differ from what get_design_rules returns now, the rule as returned wins: update your notes. When you also work from a copy of the rules (a package's design-rules.md or rules.json), give its version to list_rule_topics, which says whether the copy is current and what changed since. ${OPEN_CALLS} When the person asks you to read their notes into rules, or list_rule_topics says notes are waiting, call get_notes_to_read and follow it: you read them as Pinch would, and submit_reading hands your reading back. ${WORKING_LINES.join(' ')}`;

export const TOOLS = [
  {
    name: 'get_design_rules',
    title: 'Get design rules',
    description:
      'The design rules this person keeps in Pinch: their taste, drawn from notes they wrote on screenshots, to follow in design and front-end work. Pick the topics the task touches; leave them out for every rule. Give their own tags (a project, a client) when the task belongs to one, to get those rules along with their general ones. Each rule says where it holds and lists the notes it comes from, with the tag of each note’s screenshot (a product, a feature, a domain). To keep only the rules drawn from screenshots with a tag, give it in screenTags: a narrower list, not a different taste, so leave it out unless the task is about that one. A tag brings the other sets of its product too (its screens as they are today and its target style), each with the role the author gave it. The author’s brief for a product or feature (what it is for and how it should feel) comes first: for the screen tags given, or every one.',
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
    name: 'get_notes_to_read',
    title: 'Get notes to read into rules',
    description:
      'The person’s notes that haven’t been read into rules yet, as many as fit in one answer with their close-ups, the rules they have so far, and the method Pinch’s own reading follows, so you can read them into rules on your own allowance instead of Pinch’s credits. Read them as it says, then call submit_reading. Once every note is read, it asks you once to tidy the rules. Call it when the person asks you to read their notes, or list_rule_topics says notes are waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'boolean',
          description:
            'false once an earlier call in this conversation gave you the method: it is left out, so more notes and close-ups fit.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'submit_reading',
    title: 'Submit a reading of notes',
    description:
      'Your reading of the notes get_notes_to_read gave you, in the shape it describes: every note you read, the rules they strengthen and the new rules they teach; or, when it asked you to tidy the rules, the tidy alone. It waits in Pinch and becomes part of the person’s rules when they next open Your rules, as Pinch’s own reading does; rules read from vague words, or with a question, wait for them to confirm. Use the ids exactly as given.',
    inputSchema: readingInputSchema(),
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
      'How many of this person’s rules are about each topic and carry each of their own tags, to choose what to ask get_design_rules for, and how ready each product is for your work: its rules, how many a render check holds, its best examples and whether it has a brief. Also the rules’ version: give the version a copy of the rules names (design-rules.md, rules.json) to learn whether that copy is current and, when it isn’t, which rules are new, changed or gone since.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description:
            'The version your copy of the rules names, to check it is current and learn what changed since. Leave out when you have none.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

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

/** A version as an agent gives it, quotes and spaces off. */
export const versionArg = (v: unknown) =>
  typeof v === 'string' ? v.trim().replace(/^"|"$/g, '') : '';

/**
 * Whether a copy of the rules is current (D125): the rules' version now, and the one the
 * agent's copy names when it gave one; for a copy behind, what changed since, when Pinch kept
 * that export (D128).
 */
export function versionLine(now: string, copy?: string, changes?: Changes | null): string {
  const asked = versionArg(copy);
  if (!asked)
    return `Rules version ${now}. A copy of the rules (design-rules.md, rules.json) names its version: where it differs, the copy is behind.`;
  if (asked === now) return `Rules version ${now}: your copy is current.`;
  if (!changes)
    return `Rules version ${now}: your copy (${asked}) is behind, so the author changed rules since. Call get_design_rules for the current ones: where they differ from your copy, they win.`;
  const lines = changesLines(changes);
  return [
    `Rules version ${now}: your copy (${asked}, exported ${changes.at.slice(0, 10)}) is behind. ${lines.length ? 'What changed since, by the numbers get_design_rules gives now; these win over your copy, and the rest of your copy holds:' : 'No rule changed since; only their order or notes did, so your copy holds.'}`,
    ...lines,
  ].join('\n');
}

/** What the rules are about, counted: the answer to list_rule_topics. */
export function topicsText(
  c: Collection | null,
  version?: { now: string; copy?: string; changes?: Changes | null },
  /** The notes no reading has taken yet, the agent's waiting ones included (D146). */
  unreadCount?: number,
): string {
  const live = (c?.rules ?? []).filter(
    (r) => r.status === 'approved' && !r.locked && !waiting(r) && r.text,
  );
  // Notes not read into rules yet can be read by the agent (D122).
  const unread = unreadCount ?? (c ? unreadNotes(c).length : 0);
  const waitingLine = unread
    ? `${unread} ${unread === 1 ? 'note waits' : 'notes wait'} to be read into rules: call get_notes_to_read when the person asks you to read them.`
    : '';
  const versioned = version ? versionLine(version.now, version.copy, version.changes) : '';
  if (!live.length) return ['No rules yet.', waitingLine, versioned].filter(Boolean).join('\n');
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
  // How ready each product is (D125): where the agent decides alone, it should say so.
  const ready = c ? readinessOf(c, live) : [];
  if (ready.length) {
    lines.push(
      'Screen tags, the tags of the screenshots rules are drawn from (screenTags), each with its rules, how many a render check holds, the author’s best examples and whether they wrote its brief:',
    );
    for (const r of ready) lines.push(`- ${readinessLine(r)}`);
  }
  if (waitingLine) lines.push(waitingLine);
  if (versioned) lines.push(versioned);
  return lines.join('\n');
}

/**
 * Where the agent's readings wait for the page (D122): a fresh id, the store's write, and, when
 * the agent gets fewer rules than there are (the free plan, D123), all of them to read against;
 * and the readings already waiting, which the agent reads on from (D146).
 */
export type ReadingStore = {
  id: () => string;
  save: (r: AgentReading) => Promise<void>;
  rules?: () => Promise<Collection | null>;
  waiting?: () => Promise<AgentReading[]>;
};

/**
 * The next notes to read (D122): Pinch's method, the library and the notes as its own reading
 * gets them, then each close-up after its note's id, within what one answer carries.
 */
export async function notesContent(
  c: Collection | null,
  files?: BatchFiles,
  method = true,
): Promise<{ content: Content[] }> {
  const todo = c ? notesToRead(c) : [];
  // Every note read: the rules are tidied once (D149), then there's nothing to do.
  if (c && !todo.length && tidyDue(c))
    return text(tidyPrompt(c, REPLY_TOKENS * 3.5)) as { content: Content[] };
  if (!c || !todo.length) return text('No notes are waiting to be read.') as { content: Content[] };
  const left = unreadNotes(c).length;
  const byBatch = new Map<string, typeof todo>();
  for (const x of todo) byBatch.set(x.batch.id, [...(byBatch.get(x.batch.id) ?? []), x]);
  const got = new Map<string, Map<string, Uint8Array>>();
  if (files)
    await Promise.all(
      [...byBatch.entries()].map(async ([id, xs]) =>
        got.set(
          id,
          await files(
            id,
            xs.map((x) => x.batch.root + x.note.crop),
          ).catch(() => new Map<string, Uint8Array>()),
        ),
      ),
    );
  // As many notes as fit in one answer with their close-ups (D147): an agent cuts an answer past
  // its limit, close-ups and all, and the rest come in the next call (D146).
  const cropOf = (x: (typeof todo)[number]) => got.get(x.batch.id)?.get(x.batch.root + x.note.crop);
  const head = method ? READING_GUIDE : READ_ON;
  let room = REPLY_TOKENS - tokensOf(`${head}\n\n${readingPrompt(c, todo)}\n\n${CLOSE_UPS}`);
  let bytes = MAX_EVIDENCE_BYTES;
  const sent: { x: (typeof todo)[number]; crop?: Uint8Array }[] = [];
  for (const x of todo) {
    const crop = cropOf(x);
    const cost = crop ? imageTokens(crop) : 0;
    if (sent.length && (cost > room || (crop?.length ?? 0) > bytes)) break;
    room -= cost;
    bytes -= crop?.length ?? 0;
    sent.push({ x, crop });
  }
  const content: Content[] = [
    {
      type: 'text',
      text: `${head}\n\n${sent.length} of ${left} ${left === 1 ? 'note' : 'notes'} waiting.\n\n${readingPrompt(
        c,
        sent.map((s) => s.x),
      )}\n\n${CLOSE_UPS}`,
    },
  ];
  for (const { x, crop } of sent) {
    if (crop)
      content.push(
        { type: 'text', text: `${x.key}:` },
        { type: 'image', data: Buffer.from(crop).toString('base64'), mimeType: 'image/jpeg' },
      );
    else content.push({ type: 'text', text: `${x.key}: no close-up; read it from its words.` });
  }
  return { content };
}

/** Where an agent cuts a tool's answer, with room to spare (D147). */
export const REPLY_TOKENS = 20_000;
/** What the next notes are read by, once the method came with an earlier call (D147). */
const READ_ON =
  'Read these notes by the method an earlier get_notes_to_read gave you in this conversation, then call submit_reading. Call it without method: false if you no longer have the method.';
/** About how many tokens text takes. */
const tokensOf = (s: string) => Math.ceil(s.length / 3.5);
/** About how many tokens a close-up takes, as a model scales it to 1568px at most. */
function imageTokens(jpeg: Uint8Array): number {
  const size = jpegSize(jpeg);
  if (!size) return Math.ceil(jpeg.length / 50);
  const scale = Math.min(1, 1568 / Math.max(size.width, size.height));
  return Math.ceil((size.width * scale * (size.height * scale)) / 750);
}

/** The agent's reading, checked and kept to wait for the page (D122), and counted in its run. */
async function readingContent(
  c: Collection | null,
  args: unknown,
  store: ReadingStore,
  log?: RunLog,
) {
  const out = agentReadingOf(args, c, new Date().toISOString(), store.id());
  if ('error' in out) return text(out.error, true);
  await store.save(out.reading);
  const { read, reading, tidy } = out.reading;
  if (tidy) {
    const folded = tidy.fold.reduce((n, f) => n + f.rules.length, 0);
    return text(
      `Kept your tidy: ${folded} ${folded === 1 ? 'rule' : 'rules'} folded into others, ${tidy.drop.length} dropped. It joins the person’s rules when they next open Your rules. The reading is done.`,
    );
  }
  log?.add({ kind: 'reading', notes: read.length });
  const left = c ? unreadNotes(c).length - read.length : 0;
  const then =
    left > 0
      ? ` ${left} more ${left === 1 ? 'note waits' : 'notes wait'}: call get_notes_to_read again.`
      : c && tidyDue(withReadings(c, [out.reading]))
        ? ' Every note is read: call get_notes_to_read once more to tidy the rules.'
        : '';
  return text(
    `Kept: ${read.length} ${read.length === 1 ? 'note' : 'notes'} read, ${reading.propose.length} new ${reading.propose.length === 1 ? 'rule' : 'rules'}, ${reading.strengthen.length} strengthened. It joins the person’s rules when they next open Your rules.${then}`,
  );
}

/**
 * Where a run's calls go (D120): what each call adds; and the account's runs so far, for the
 * author's corrections on work their agents reported before (D125).
 */
export type RunLog = {
  add: (e: RunEvent) => void;
  runs?: () => Promise<Run[]>;
};

/**
 * One JSON-RPC message answered: a reply for a request, nothing for a notification. `rules`
 * reads the person's one collection when a tool needs it, `files` its batches' close-ups,
 * `log` the run's record, `readings` where the agent's reading of notes waits.
 */
export async function answer(
  m: RpcMessage,
  rules: () => Promise<Collection | null>,
  files?: BatchFiles,
  log?: RunLog,
  readings?: ReadingStore,
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
      // What the agent reads on from: the rules with its readings still waiting applied, as the
      // page will apply them (D146), so it never gets the same notes twice.
      const ahead = async () => {
        const c = await (readings?.rules ?? rules)();
        const waiting = (await readings?.waiting?.().catch(() => [])) ?? [];
        return c && withReadings(c, waiting);
      };
      if (params.name === 'list_rule_topics') {
        // The version is of every rule, as the author's package has them, whatever the plan.
        const whole = await (readings?.rules ?? rules)();
        const args = (params.arguments ?? {}) as { version?: unknown };
        const copy = versionArg(args.version);
        // What changed since the copy, from the export Pinch kept of it (D128).
        const changes = whole && copy ? changesSince(whole, copy) : null;
        const next = readings ? await ahead() : null;
        return reply(
          id,
          text(
            topicsText(
              await rules(),
              whole ? { now: rulesVersion(whole), copy, changes } : undefined,
              next ? unreadNotes(next).length : undefined,
            ),
          ),
        );
      }
      if (params.name === 'get_notes_to_read')
        return reply(
          id,
          await notesContent(
            await ahead(),
            files,
            (params.arguments as { method?: unknown } | undefined)?.method !== false,
          ),
        );
      if (params.name === 'submit_reading') {
        if (!readings) return reply(id, text('Reading notes isn’t available here.', true));
        return reply(id, await readingContent(await ahead(), params.arguments, readings, log));
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
      // A product asked for comes with all its sets, its target style beside its screens today (D130).
      const linked =
        c && pick.screen ? { ...pick, screen: linkedTags(c, pick.screen) } : pick;
      const picked = c ? numberedRules(c, linked) : [];
      log?.add({
        kind: 'rules',
        topics: (pick.topics ?? []).filter((t): t is Topic => t !== null),
        tags: (pick.tags ?? []).filter((t): t is string => t !== null),
        screen: [...(pick.screen ?? [])],
        rules: picked.map((r) => r.rule.id),
      });
      // What the products asked for lack, and the author's corrections on earlier work (D125).
      const corrections = correctionsLines((await log?.runs?.().catch(() => [])) ?? []);
      const more = [...(c ? gapsLines(c, rulesOf(c).map((r) => r.rule), pick.screen) : []), ...corrections];
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
              ...more,
            ].join('\n'),
          ),
        );
      }
      return reply(
        id,
        text(
          `${rulesText(c, picked, linked.screen, more)}\nTo see the notes a rule comes from, with their close-ups and where each spot is, call get_rule_evidence with its number.\n`,
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
