/*
 * Pinch (/pin): tag a batch of screenshots with what works and what
 * doesn't, on a dot, an area or an arrow, and export it all for an agent. Everything
 * here is pure: the browser keeps the images (IndexedDB) and draws the
 * crops; this file decides the data, the crop rectangles, file names and the
 * text an agent reads.
 */


export type Dot = { kind: 'dot'; x: number; y: number };
/** x, y is the top-left corner; all four are fractions of the image (0–1). */
export type Area = { kind: 'area'; x: number; y: number; w: number; h: number };
/**
 * A pointer from one spot to another: x, y is the tail (where the number
 * sits), x2, y2 the head. For "move this there", "align this with that".
 */
export type Arrow = { kind: 'arrow'; x: number; y: number; x2: number; y2: number };
export type Shape = Dot | Area | Arrow;

export type MarkOrigin = 'user' | 'ai';

/**
 * What a note is about, so an agent knows whether "this heading" means how it
 * looks, where it sits or what it says. A note can be about several, or none.
 */
export const TOPIC_KINDS = [
  'visual',
  'layout',
  'copy',
  'interaction',
  'flow',
  'accessibility',
] as const;
export type Topic = (typeof TOPIC_KINDS)[number];

export const TOPICS: { kind: Topic; label: string; hint: string }[] = [
  { kind: 'visual', label: 'Visual', hint: 'How it looks: type, colour, icons, imagery' },
  {
    kind: 'layout',
    label: 'Layout',
    hint: 'Where things sit and what stands out: spacing, alignment, hierarchy, density',
  },
  { kind: 'copy', label: 'Copy', hint: 'The words: labels, headings, tone' },
  {
    kind: 'interaction',
    label: 'Interaction',
    hint: 'How controls behave: states, feedback, motion',
  },
  { kind: 'flow', label: 'Flow', hint: 'Steps, navigation and what happens next' },
  {
    kind: 'accessibility',
    label: 'Accessibility',
    hint: 'Usable by everyone: contrast, target size, keyboard, screen readers',
  },
];

export const topicLabel = (kind: Topic) => TOPICS.find((t) => t.kind === kind)?.label ?? kind;

/** A topic's hint inside a sentence: "how it looks: type, colour, icons, imagery". */
export const topicGloss = (t: { hint: string }) => `${t.hint[0].toLowerCase()}${t.hint.slice(1)}`;

/** Topics in their fixed order, each once; anything that isn't a topic is dropped. */
export const sortTopics = (list: readonly string[]): Topic[] =>
  TOPIC_KINDS.filter((k) => list.includes(k));

/** The topics with one switched on or off. */
export const toggleTopic = (list: readonly Topic[] | undefined, kind: Topic): Topic[] =>
  list?.includes(kind) ? list.filter((k) => k !== kind) : sortTopics([...(list ?? []), kind]);

/** An AI suggestion for an empty note, shown as grey text the user accepts with Tab. */
export type Suggestion = {
  works: string;
  doesNotWork: string;
  /** What the suggested sentences are about; taken with them when the note has no topics yet. */
  topics?: Topic[];
  /** A short name for the spot, two to five words: "revenue headline". Optional. */
  label?: string;
  /** The shape it was written for (`shapeKey`); a moved or resized note gets a new one. */
  shape: string;
};

export type Mark = {
  id: string;
  shape: Shape;
  /** A short name for the spot: "one number, huge". Optional. */
  label: string;
  /** What works here, and why. */
  good: string;
  /** What doesn't, and why. */
  bad: string;
  /**
   * What the note is about. Unset until the author picks one or takes a suggestion with its
   * topics; an empty list means they cleared them.
   */
  topics?: Topic[];
  /** Placed by the user, or by the AI from the asset's note. */
  origin: MarkOrigin;
  /** For an AI mark: the words of the note it came from. */
  quote?: string;
  /** For an AI mark: whether the user has checked where it landed. */
  confirmed?: boolean;
  suggestion?: Suggestion;
  /** The suggestion text accepted into each field, so the export can say which words were the AI's. */
  accepted?: { good?: string; bad?: string };
};

/** Whose design an image is. */
export type SourceKind = 'ours' | 'competitor' | 'other' | 'concept';

export const SOURCES: { kind: SourceKind; label: string; hint: string }[] = [
  { kind: 'ours', label: 'Ours', hint: 'Our own product' },
  { kind: 'competitor', label: 'Competitor', hint: 'A product in our space' },
  {
    kind: 'other',
    label: 'Other product',
    hint: 'A real product outside our space',
  },
  {
    kind: 'concept',
    label: 'Concept',
    hint: 'A mockup or concept, never shipped',
  },
];

export const sourceLabel = (kind: SourceKind) =>
  SOURCES.find((s) => s.kind === kind)?.label ?? kind;

/**
 * Whose design an image is: the kind only. Sessions saved before the maker
 * and link fields were dropped (D61) may still carry `by` and `link`; they
 * are read and ignored, and nothing exports them.
 */
export type Source = {
  kind: SourceKind;
  /** @deprecated No longer shown or exported; kept so older saved sessions still load. */
  by?: string;
  /** @deprecated No longer shown or exported; kept so older saved sessions still load. */
  link?: string;
};

export type Asset = {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  /** Free text about the whole image; the AI can turn it into marks. */
  note: string;
  /** The note as it was when the AI last placed it, so an unchanged note isn't placed twice. */
  locatedNote?: string;
  /** Parts of the note the AI found no place for (about the whole image). */
  unplaced?: string[];
  /** Whose design it is. Unset until the user picks one. */
  source?: Source;
  marks: Mark[];
};

export type Verdict = 'good' | 'bad' | 'both' | 'empty';

/** A note field's items (D95): one per line, trimmed, the empty ones left out. */
export const itemsOf = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** A note field on one line: its one item as it is, or its items joined, "a; b". */
export const itemsLine = (s: string) => {
  const items = itemsOf(s);
  return items.length < 2
    ? (items[0] ?? '')
    : items.map((x, i) => (i < items.length - 1 ? x.replace(/[.;\s]+$/, '') : x)).join('; ');
};

export const verdictOf = (m: Pick<Mark, 'good' | 'bad'>): Verdict => {
  const good = m.good.trim();
  const bad = m.bad.trim();
  return good && bad ? 'both' : good ? 'good' : bad ? 'bad' : 'empty';
};

export const hasNotes = (a: Asset) =>
  a.note.trim().length > 0 || a.marks.some((m) => verdictOf(m) !== 'empty');

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** An area from two corners in any order, kept inside the image. */
export function areaFrom(x0: number, y0: number, x1: number, y1: number): Area {
  const [l, r] = [clamp01(Math.min(x0, x1)), clamp01(Math.max(x0, x1))];
  const [t, b] = [clamp01(Math.min(y0, y1)), clamp01(Math.max(y0, y1))];
  return { kind: 'area', x: l, y: t, w: r - l, h: b - t };
}

/** A drag smaller than this (in fractions of the image) is a click: a dot. */
export const isTinyArea = (a: Area) => a.w < 0.012 || a.h < 0.012;

/** An arrow from tail to head, both ends kept inside the image. */
export function arrowFrom(x0: number, y0: number, x1: number, y1: number): Arrow {
  return { kind: 'arrow', x: clamp01(x0), y: clamp01(y0), x2: clamp01(x1), y2: clamp01(y1) };
}

/** An arrow shorter than this (in fractions of the image) is a slip of the hand, not an arrow. */
export const isTinyArrow = (a: Arrow) => Math.hypot(a.x2 - a.x, a.y2 - a.y) < 0.02;

/** The arrow moved by dx, dy, both ends kept inside the image so it keeps its length. */
export function moveArrow(a: Arrow, dx: number, dy: number): Arrow {
  const ddx = Math.max(-Math.min(a.x, a.x2), Math.min(1 - Math.max(a.x, a.x2), dx));
  const ddy = Math.max(-Math.min(a.y, a.y2), Math.min(1 - Math.max(a.y, a.y2), dy));
  return { kind: 'arrow', x: a.x + ddx, y: a.y + ddy, x2: a.x2 + ddx, y2: a.y2 + ddy };
}

/** A shape as a short key, so a suggestion knows whether its note has since moved. */
export const shapeKey = (s: Shape) =>
  s.kind === 'arrow'
    ? `arrow:${[s.x, s.y, s.x2, s.y2].map((n) => n.toFixed(3)).join(',')}`
    : (s.kind === 'dot' ? [s.x, s.y] : [s.x, s.y, s.w, s.h]).map((n) => n.toFixed(3)).join(',');

/** The note's suggestion, if it was written for where the note is now. */
export const currentSuggestion = (m: Mark) =>
  m.suggestion && m.suggestion.shape === shapeKey(m.shape) ? m.suggestion : undefined;

/** Whether an empty note still needs a suggestion. */
export const needsSuggestion = (m: Mark) => verdictOf(m) === 'empty' && !currentSuggestion(m);

/** How a field's text relates to the AI suggestion accepted into it. */
export type SuggestionUse = 'as-is' | 'edited';
export function suggestionUse(m: Mark, field: 'good' | 'bad'): SuggestionUse | undefined {
  const accepted = m.accepted?.[field]?.trim();
  const text = m[field].trim();
  if (!accepted || !text) return undefined;
  return text === accepted ? 'as-is' : 'edited';
}

/** Where a mark sits: a dot's position, an area's centre, the middle of an arrow. */
export const centreOf = (s: Shape) =>
  s.kind === 'dot'
    ? { x: s.x, y: s.y }
    : s.kind === 'arrow'
      ? { x: (s.x + s.x2) / 2, y: (s.y + s.y2) / 2 }
      : { x: s.x + s.w / 2, y: s.y + s.h / 2 };

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The part of the image to crop for a mark, in pixels. An area gets a wide
 * margin, so its edges and what sits beside it show; a dot gets a landscape
 * window around it, big enough to see what it sits on; an arrow gets a window
 * around each end, so what each end touches shows. Either way the crop stays
 * inside the image.
 */
export function cropRect(shape: Shape, width: number, height: number): Rect {
  const fit = (cx: number, cy: number, w: number, h: number): Rect => {
    const cw = Math.min(width, Math.round(w));
    const ch = Math.min(height, Math.round(h));
    const x = Math.min(width - cw, Math.max(0, Math.round(cx - cw / 2)));
    const y = Math.min(height - ch, Math.max(0, Math.round(cy - ch / 2)));
    return { x, y, w: cw, h: ch };
  };
  if (shape.kind === 'dot') {
    // A landscape window, wide enough for the lines and controls around the dot, at 1:1 on a small
    // image rather than a tiny square blown up.
    const w = Math.min(1400, Math.max(480, Math.round(width * 0.6)));
    return fit(shape.x * width, shape.y * height, w, Math.max(360, Math.round(w * 0.65)));
  }
  if (shape.kind === 'arrow') {
    // A window around each end, wide enough to show the element it touches (the form an arrow
    // points at, not only its bottom edge), and the two joined.
    const ew = Math.min(1100, Math.max(480, Math.round(width * 0.35)));
    const eh = Math.round(ew * 0.8);
    const xs = [shape.x * width, shape.x2 * width];
    const ys = [shape.y * height, shape.y2 * height];
    const left = Math.min(...xs) - ew / 2;
    const right = Math.max(...xs) + ew / 2;
    const top = Math.min(...ys) - eh / 2;
    const bottom = Math.max(...ys) + eh / 2;
    const cw = right - left;
    const ch = bottom - top;
    // Never a thin strip: a near-vertical or near-horizontal arrow still shows what is beside its ends.
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    return fit(cx, cy, Math.max(cw, ch * 0.6), Math.max(ch, cw * 0.6));
  }
  const w = shape.w * width;
  const h = shape.h * height;
  // A wide margin: a note on an area often compares it with what is next to it.
  const pad = Math.max(48, Math.round(Math.max(w, h) * 0.25));
  return fit(
    (shape.x + shape.w / 2) * width,
    (shape.y + shape.h / 2) * height,
    Math.max(96, w + pad * 2),
    Math.max(96, h + pad * 2),
  );
}

/**
 * An image's luminance sampled in cells of `cell` pixels, row by row:
 * `luma[r * cols + c]` is 0–255 for the cell at column c, row r.
 */
export type LumaGrid = {
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  luma: ArrayLike<number>;
};

/** A cell with an edge in it (text, a border, an icon): its luminance differs from its neighbour's. */
const EDGE = 24;
/**
 * A line is quiet when at most this share of its cells (and at least one) are
 * busy: a panel edge crossing it doesn't count, the cap tops of a short
 * heading on a wide crop do.
 */
const QUIET_SHARE = 0.02;

/** Whether the cell at column c, row r has an edge in it: its luminance differs from its neighbour's. */
export function busyCell(grid: LumaGrid): (c: number, r: number) => boolean {
  const { cols, rows, luma } = grid;
  const at = (c: number, r: number) => luma[r * cols + c];
  return (c, r) => {
    const l = at(c, r);
    const right = c + 1 < cols ? at(c + 1, r) : at(c - 1, r);
    const below = r + 1 < rows ? at(c, r + 1) : at(c, r - 1);
    return Math.abs(l - right) >= EDGE || Math.abs(l - below) >= EDGE;
  };
}

/**
 * The share of busy cells in a rectangle of the image (pixels, any size), 0
 * to 1: how much text or control a marker drawn there would cover. 0 for a
 * rectangle outside the image.
 */
export function busyShare(grid: LumaGrid, rect: Rect): number {
  const { cell, cols, rows } = grid;
  if (cols < 1 || rows < 1 || cell <= 0) return 0;
  const busy = busyCell(grid);
  const c0 = Math.max(0, Math.floor(rect.x / cell));
  const c1 = Math.min(cols - 1, Math.floor((rect.x + rect.w) / cell));
  const r0 = Math.max(0, Math.floor(rect.y / cell));
  const r1 = Math.min(rows - 1, Math.floor((rect.y + rect.h) / cell));
  let n = 0;
  let b = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      n++;
      if (busy(c, r)) b++;
    }
  return n ? b / n : 0;
}

/**
 * The share of a rectangle (pixels) covered by ink, 0 to 1: cells whose
 * luminance differs from the background around it, the median of a window
 * seven times the rectangle's size, so a disc inside a big glyph still finds the page around it. Unlike `busyShare`, which counts edges
 * only, this sees the inside of large type and a filled badge, so a number
 * disc measured with it doesn't land on a big figure. 0 outside the image.
 */
export function inkShare(grid: LumaGrid, rect: Rect): number {
  const { cell, cols, rows, luma } = grid;
  if (cols < 1 || rows < 1 || cell <= 0) return 0;
  const span = (lo: number, hi: number, size: number) =>
    [Math.max(0, Math.floor(lo / cell)), Math.min(size - 1, Math.floor(hi / cell))] as const;
  const [c0, c1] = span(rect.x, rect.x + rect.w, cols);
  const [r0, r1] = span(rect.y, rect.y + rect.h, rows);
  if (c0 > c1 || r0 > r1) return 0;
  const [b0, b1] = span(rect.x - 3 * rect.w, rect.x + 4 * rect.w, cols);
  const [t0, t1] = span(rect.y - 3 * rect.h, rect.y + 4 * rect.h, rows);
  const around: number[] = [];
  for (let r = t0; r <= t1; r++) for (let c = b0; c <= b1; c++) around.push(luma[r * cols + c]);
  around.sort((a, b) => a - b);
  const background = around[Math.floor(around.length / 2)];
  let n = 0;
  let ink = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      n++;
      if (Math.abs(luma[r * cols + c] - background) >= EDGE) ink++;
    }
  return n ? ink / n : 0;
}

/**
 * Move a crop's edges outward until each sits on a quiet band of the image
 * (a row or column with no edges in it), so the crop never cuts through text
 * or a control. Each edge grows by at most `grow` of the crop's size and
 * stays inside the image; an edge that finds no quiet band stays where it
 * was. After Scrawl's autocrop, which moves crop edges into white space.
 */
export function settleCrop(rect: Rect, grid: LumaGrid, grow = 0.4): Rect {
  const { cell, cols, rows } = grid;
  if (cols < 2 || rows < 2 || cell <= 0) return rect;
  const busy = busyCell(grid);
  const countBusy = (line: number, from: number, to: number, column: boolean) => {
    let n = 0;
    for (let i = from; i < to; i++) if (column ? busy(line, i) : busy(i, line)) n++;
    return n;
  };
  // A line (column or row) is quiet when few of its cells across the span are busy.
  const quiet = (line: number, from: number, to: number, column: boolean, size: number) => {
    if (line < 0 || line >= size) return true;
    const span = Math.max(1, to - from);
    return countBusy(line, from, to, column) <= Math.max(1, Math.floor(span * QUIET_SHARE));
  };
  /**
   * One edge. `pos` is the boundary (the first line inside for a low edge,
   * one past the last for a high one), `dir` -1 for a low edge and +1 for a
   * high one. `gap` quiet lines must sit just inside a clean boundary, so
   * nothing straddles it and the crop keeps a little space at that edge.
   */
  const settle = (
    pos: number,
    dir: -1 | 1,
    limit: number,
    size: number,
    gap: number,
    isQuiet: (line: number) => boolean,
  ) => {
    const clean = (b: number) => {
      for (let k = 0; k < gap; k++) if (!isQuiet(dir < 0 ? b + k : b - 1 - k)) return false;
      return true;
    };
    if (clean(pos)) return pos;
    for (let d = 1; d <= limit; d++) {
      const o = pos + dir * d;
      if (o < 0) return 0;
      if (o > size) return size;
      if (clean(o)) return o;
    }
    return pos;
  };

  let c0 = Math.floor(rect.x / cell);
  let c1 = Math.ceil((rect.x + rect.w) / cell);
  let r0 = Math.floor(rect.y / cell);
  let r1 = Math.ceil((rect.y + rect.h) / cell);
  const limitX = Math.round((grow * rect.w) / cell);
  const limitY = Math.round((grow * rect.h) / cell);
  // A word space, not the gap between two letters: scaled to the image so big type isn't cut either.
  const gapX = Math.max(1, Math.round(Math.max(8, 0.008 * Math.max(grid.width, grid.height)) / cell));
  const gapY = Math.max(1, Math.round(4 / cell));

  const colQuiet = (c: number) => quiet(c, Math.max(0, r0), Math.min(rows, r1), true, cols);
  c0 = settle(c0, -1, limitX, cols, gapX, colQuiet);
  c1 = settle(c1, 1, limitX, cols, gapX, colQuiet);
  const rowQuiet = (r: number) => quiet(r, Math.max(0, c0), Math.min(cols, c1), false, rows);
  r0 = settle(r0, -1, limitY, rows, gapY, rowQuiet);
  r1 = settle(r1, 1, limitY, rows, gapY, rowQuiet);

  const x = Math.max(0, c0 * cell);
  const y = Math.max(0, r0 * cell);
  const right = Math.min(grid.width, c1 * cell);
  const bottom = Math.min(grid.height, r1 * cell);
  // Never smaller than where it started.
  return {
    x: Math.min(x, rect.x),
    y: Math.min(y, rect.y),
    w: Math.max(right, rect.x + rect.w) - Math.min(x, rect.x),
    h: Math.max(bottom, rect.y + rect.h) - Math.min(y, rect.y),
  };
}

/** The shape in pixels, for the export. */
export function shapePixels(shape: Shape, width: number, height: number) {
  if (shape.kind === 'dot')
    return { x: Math.round(shape.x * width), y: Math.round(shape.y * height) };
  if (shape.kind === 'arrow')
    return {
      x: Math.round(shape.x * width),
      y: Math.round(shape.y * height),
      x2: Math.round(shape.x2 * width),
      y2: Math.round(shape.y2 * height),
    };
  return {
    x: Math.round(shape.x * width),
    y: Math.round(shape.y * height),
    w: Math.round(shape.w * width),
    h: Math.round(shape.h * height),
  };
}

/** A file-safe name from what the user called the image: "Pricing page (v2).png" → "pricing-page-v2". */
export function slug(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'image';
}

export const extensionOf = (type: string) =>
  ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  })[type] ?? 'png';

/** The image's name with the extension of the file that ships: a scaled copy can change type. */
export function exportName(asset: Pick<Asset, 'name' | 'type'>): string {
  const want = extensionOf(asset.type);
  const match = asset.name.match(/\.([a-z0-9]{2,5})$/i);
  if (!match) return `${asset.name}.${want}`;
  const have = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  return have === want ? asset.name : `${asset.name.slice(0, -match[0].length)}.${want}`;
}

/** The files one asset contributes to the export, named by its place in the batch. */
export function assetFiles(asset: Asset, index: number, total: number) {
  const n = String(index + 1).padStart(total > 99 ? 3 : 2, '0');
  const stem = `${n}-${slug(asset.name)}`;
  return {
    number: n,
    image: `images/${stem}.${extensionOf(asset.type)}`,
    marked: `marked/${stem}.jpg`,
    crop: (markIndex: number) => `crops/${stem}-note-${markIndex + 1}.jpg`,
  };
}

/** Files at the root of the export, next to README.md and notes.json. */
export const SHEET_FILE = 'contact-sheet.jpg';
export const GUIDE_FILE = 'AGENTS.md';

/** The assets an export carries: those with something written on them. */
export const exportable = (assets: Asset[]) => assets.filter(hasNotes);

/** The crop an image's note ended up with, in pixels of the original image. */
export type CropOf = (asset: Asset, mark: Mark) => Rect;
const plainCrop: CropOf = (a, m) => cropRect(m.shape, a.width, a.height);

/** How an agent should read the export: the same words in the README and in AGENTS.md. */
const HOW_TO_USE = [
  `Start with \`${SHEET_FILE}\`: thumbnails of the whole batch, numbered 01, 02, … in the order below, each with its notes drawn on and numbered, to see what is in it and roughly where each note sits. Take exact positions from the notes below.`,
  'For each note, read its crop in `crops/` first. Open the marked copy in `marked/` when the crop seems cut off or you need to see where the spot sits on the screen, and the original in `images/` only when you need more detail. Each image costs context; the crop is usually enough. When a note compares its spot with something else, check the crop shows both; if not, open the marked copy.',
  "The notes say what the author saw and why. Don't ask the author to explain again what a note already says; when one is unclear, look closer at its crop and the marked copy first.",
  'Refer to notes by number, "02.3" for the third note on image 02, so the author can find them.',
  'An arrow points from its tail (where its number sits) to its head. The note is about the two spots and how they relate: "move this there", "align this with that", "this should point to that". Read the tail as "this" and the head as "that". An arrow can also show an order or a relation without asking for a change ("this reads before that", "this sits under that"): the note says which, so move nothing the note doesn\'t ask to move.',
];

/** Each topic as the README names it: "Visual (how it looks: type, colour, icons, imagery)". */
const TOPIC_LEGEND = TOPICS.map((t) => `${t.label} (${topicGloss(t)})`).join(', ');

const FILES = [
  `\`${SHEET_FILE}\`: every image on one sheet with its notes drawn on, each with its number.`,
  '`images/`: each image as it was added; screenshots over 16 megapixels were scaled down to fit. `marked/`: the same image, scaled down to 1800 px on its long side when it is larger, with every note drawn on it (positions are always in the pixels of `images/`): a small ring on a dot, a box around an area, an arrow from its tail to its head, each with its number on a disc beside it. The spot the author means is the ring, the box or the two ends of the arrow, never the numbered disc: it sits nearby on a short line, and can overlap neighbouring content. `crops/`: each note with what is around it and its marker drawn in, at most 1200 px on its long side; for a big area or a long arrow it can show much of the image. Its edges are moved to nearby white space where there is some, but a crop can still cut through text, and a small one is scaled up (`cropPixels` in `notes.json` is the part of the original it shows).',
  'Every note below names its crop and says exactly where it sits: x from the left edge and y from the top, as a percentage of the image and in pixels of the image in `images/`. An arrow gives its tail, then its head. When the picture and the numbers seem to disagree, trust the numbers: they are the exact spot the author pointed at.',
  "Marker colours: green means what works, red what doesn't, amber both.",
  '"What works" and "What doesn\'t" are the author\'s words.',
  `About says what a note is about, as the author tagged it: ${TOPIC_LEGEND}. Read a note through its topics: one about Copy is about the words, not how the text looks; one about Visual is about how it looks, not what it says; one with several is about each. A note with no About line was not tagged: go by its words.`,
  'A field marked "AI suggestion" was written by an AI and accepted by the author: as is, or edited. Treat it as the author\'s view.',
  "Source says whose design an image is: Ours (the author's own product: keep what works, fix what doesn't), Competitor (a product in the same space), Other product (a real product outside it), Concept (a mockup, never shipped or tested with users). Source: not set means the author did not say; don't assume it is Ours, and ask before changing it. Never copy an outside design; take its principle.",
  '`notes.json` has all of this as data.',
];

/** AGENTS.md at the root of the export: a pointer, so the rules live in one place (README.md). */
export function agentGuide(): string {
  return `${[
    '# Pinch export',
    '',
    "A batch of screenshots a designer tagged in Pinch: on each, dots, areas and arrows with a note on what works and what doesn't. Read `README.md` first: it says how to read this folder and lists every image and note.",
  ].join('\n')}\n`;
}

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function describeShape(shape: Shape, width: number, height: number) {
  const px = shapePixels(shape, width, height);
  if (shape.kind === 'dot') {
    return `dot at x ${percent(shape.x)}, y ${percent(shape.y)} (pixel ${px.x}, ${px.y})`;
  }
  if (shape.kind === 'arrow') {
    const l = px as { x: number; y: number; x2: number; y2: number };
    return `arrow from x ${percent(shape.x)}, y ${percent(shape.y)} to x ${percent(shape.x2)}, y ${percent(shape.y2)} (pixels ${l.x},${l.y} to ${l.x2},${l.y2})`;
  }
  const a = px as { x: number; y: number; w: number; h: number };
  return `area from x ${percent(shape.x)}–${percent(shape.x + shape.w)}, y ${percent(shape.y)}–${percent(shape.y + shape.h)} (pixels ${a.x},${a.y} to ${a.x + a.w},${a.y + a.h})`;
}

const originText = (m: Mark) =>
  m.origin === 'user'
    ? ''
    : m.confirmed
      ? " · placed by AI from the author's note, position checked by the author"
      : " · placed by AI from the author's note, position not checked";

const sourceData = (s: Source) => ({ kind: s.kind, label: sourceLabel(s.kind) });

/** A note's topics as exported: in their fixed order, none when unset. */
const topicsOf = (m: Mark) => sortTopics(m.topics ?? []);

function suggestedData(m: Mark) {
  const works = suggestionUse(m, 'good');
  const doesNotWork = suggestionUse(m, 'bad');
  if (!works && !doesNotWork) return {};
  return {
    aiSuggested: {
      ...(works ? { works } : {}),
      ...(doesNotWork ? { doesNotWork } : {}),
    },
  };
}

const suggestedText = (m: Mark, field: 'good' | 'bad') => {
  const use = suggestionUse(m, field);
  return use === 'as-is'
    ? ' (AI suggestion, accepted as is)'
    : use === 'edited'
      ? ' (AI suggestion, edited by the author)'
      : '';
};

/** One line naming whose design an image is. */
export const sourceLine = (s: Source) => `Source: ${sourceLabel(s.kind)}`;

/** Fractions to four places: a pixel on any image under 10,000 wide, without float noise. */
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const roundShape = (s: Shape): Shape =>
  s.kind === 'dot'
    ? { kind: 'dot', x: round4(s.x), y: round4(s.y) }
    : s.kind === 'arrow'
      ? { kind: 'arrow', x: round4(s.x), y: round4(s.y), x2: round4(s.x2), y2: round4(s.y2) }
      : { kind: 'area', x: round4(s.x), y: round4(s.y), w: round4(s.w), h: round4(s.h) };

/** The structured export: everything the README says, as data. */
export function manifest(assets: Asset[], exportedAt: string, cropOf: CropOf = plainCrop) {
  const list = exportable(assets);
  return {
    tool: 'Pinch',
    version: 2,
    exportedAt,
    coordinates:
      'Fractions of the image: x from the left edge, y from the top, 0 to 1. Pixels are of the image in images/.',
    contactSheet: SHEET_FILE,
    guide: 'README.md',
    topics: Object.fromEntries(TOPICS.map((t) => [t.kind, t.hint])),
    assets: list.map((a, i) => {
      const files = assetFiles(a, i, list.length);
      return {
        number: files.number,
        name: exportName(a),
        image: files.image,
        marked: files.marked,
        width: a.width,
        height: a.height,
        ...(a.note.trim() ? { note: a.note.trim() } : {}),
        source: a.source ? sourceData(a.source) : null,
        notes: a.marks
          .filter((m) => verdictOf(m) !== 'empty')
          .map((m, j) => ({
            number: j + 1,
            verdict: verdictOf(m),
            ...(m.label.trim() ? { label: m.label.trim() } : {}),
            works: itemsOf(m.good).join('\n'),
            doesNotWork: itemsOf(m.bad).join('\n'),
            ...(topicsOf(m).length ? { topics: topicsOf(m) } : {}),
            shape: roundShape(m.shape),
            pixels: shapePixels(m.shape, a.width, a.height),
            crop: files.crop(j),
            cropPixels: cropOf(a, m),
            ...(m.origin === 'ai'
              ? { origin: 'ai', fromNote: m.quote ?? '', checked: Boolean(m.confirmed) }
              : {}),
            ...suggestedData(m),
          })),
      };
    }),
  };
}

/**
 * The README an agent reads first. Every note names its crop and where it
 * sits on the image, so a model that sees the files can match words to pixels.
 */
export function readme(assets: Asset[], exportedAt: string): string {
  const list = exportable(assets);
  const written = (a: Asset) => a.marks.filter((m) => verdictOf(m) !== 'empty');
  const all = list.flatMap(written);
  const count = (v: Verdict) => all.filter((m) => verdictOf(m) === v).length;
  const byTopic = TOPICS.map((t) => ({
    label: t.label,
    n: all.filter((m) => topicsOf(m).includes(t.kind)).length,
  })).filter((t) => t.n > 0);
  const untagged = all.filter((m) => !topicsOf(m).length).length;
  const topicCounts = byTopic.length
    ? ` Notes by topic: ${[...byTopic.map((t) => `${t.label} ${t.n}`), ...(untagged ? [`${untagged} not tagged`] : [])].join(', ')}.`
    : '';
  const lines = [
    `# Design notes: ${list.length} ${list.length === 1 ? 'image' : 'images'}, ${all.length} ${all.length === 1 ? 'note' : 'notes'}`,
    '',
    `Exported from Pinch on ${exportedAt.slice(0, 10)}. Notes by kind: ${count('good')} only what works, ${count('bad')} only what doesn't, ${count('both')} both.${topicCounts}`,
    '',
    '## How to use this',
    '',
    ...HOW_TO_USE.map((l) => `- ${l}`),
    '',
    '## Files',
    '',
    ...FILES.map((l) => `- ${l}`),
  ];
  list.forEach((a, i) => {
    const files = assetFiles(a, i, list.length);
    lines.push(
      '',
      `## ${files.number} · ${exportName(a)}`,
      '',
      `Image: \`${files.image}\` (${a.width}×${a.height}) · With markers: \`${files.marked}\``,
    );
    lines.push(a.source ? sourceLine(a.source) : 'Source: not set');
    if (a.note.trim()) lines.push('', `Overall: ${oneLine(a.note)}`);
    written(a).forEach((m, j) => {
      const v = verdictOf(m);
      lines.push(
        '',
        `### Note ${files.number}.${j + 1}${m.label.trim() ? ` · ${oneLine(m.label)}` : ''} · ${v === 'both' ? "works and doesn't" : v === 'good' ? 'works' : "doesn't work"}`,
        '',
        `Where: ${describeShape(m.shape, a.width, a.height)}${originText(m)}`,
        `Crop: \`${files.crop(j)}\``,
      );
      if (topicsOf(m).length) lines.push(`About: ${topicsOf(m).map(topicLabel).join(', ')}`);
      if (m.good.trim()) lines.push(`What works${suggestedText(m, 'good')}: ${itemsLine(m.good)}`);
      if (m.bad.trim()) lines.push(`What doesn't${suggestedText(m, 'bad')}: ${itemsLine(m.bad)}`);
      if (m.origin === 'ai' && m.quote) lines.push(`From the note: "${oneLine(m.quote)}"`);
    });
  });
  return `${lines.join('\n')}\n`;
}
