import type { LumaGrid, Rect, Shape } from './model';

/*
 * Spacing for a note: the element at a dot (or inside an area) and the gap
 * from it to the nearest element edge on each side, measured on the image's
 * pixels, not guessed by a model. Pure: the browser samples the image into a
 * luma grid (render.ts) and this finds edges in it.
 *
 * The element is found by ink: cells whose luminance differs from the colour
 * the spot sits on, joined across letter and word gaps so a line of text or a
 * button reads as one element. On a photo or a gradient there is no such
 * background, and the measurement says so instead of inventing a gap.
 */

export type Side = 'above' | 'below' | 'left' | 'right';
export const SIDES: Side[] = ['above', 'below', 'left', 'right'];

/** Gaps in pixels of the image; a side is absent when nothing is within reach. */
export type Gaps = Partial<Record<Side, number>>;

/** A measurement kept on a note. */
export type Spacing = {
  /** The element measured from, in pixels of the image. */
  element: Rect;
  gaps: Gaps;
  /** How far off a gap can be, in pixels of the image: the grid's cell. */
  precision: number;
  /** The shape it was measured for (`shapeKey`); a moved note has to be measured again. */
  shape: string;
};

export type Measured =
  | { ok: true; element: Rect; gaps: Gaps; precision: number }
  | { ok: false; reason: 'empty' | 'busy' | 'arrow' };

/**
 * Luminance difference that counts as ink against the background. Low on purpose: a white card
 * on a near-white page differs by about 10, a pale icon tile on a card by about 8, and their
 * edges are what a gap is measured to.
 */
export const INK = 6;
/**
 * A gap this wide or narrower, as a share of the image's long side, is inside one element:
 * between the letters and words of a line.
 */
export const JOIN = 0.006;
/**
 * How far a gap is looked for, as a share of the image's width or height: half, so a label in a
 * wide button still finds the button's far edge.
 */
export const REACH = 0.5;
/**
 * Around the spot, at least this share must be flat colour, its few most common colours
 * together (a card and the page around it are two): something to measure on. A photo or a
 * gradient spreads over many, and is not measured.
 */
export const FLAT_SHARE = 0.5;
/**
 * Ink this far from the background is strong: letters and controls, not a card's faint edge or a
 * pale divider. Its own level, not a multiple of INK: lowering INK to see pale surfaces must not
 * let a faint line join a headline's words.
 */
const STRONG = 24;
/** An element whose ink covers less of its box than this is text (letters are mostly gaps). */
const TEXT_DENSITY = 0.5;
/** How many of the most common colours count as flat. */
const FLAT_COLOURS = 3;
/**
 * A region of the dot's own colour smaller than this share of the image is an element (a
 * letter, a list row, a button, a chip); a larger one is open space (a card's, the page's).
 */
const ELEMENT_AREA = 0.02;
/** The window the background is read from, as a share of the image's long side either way. */
const AROUND = 0.12;

/**
 * The background: the most common colour, in steps of 4. The mode, not the median: a dot on one
 * row of a list sits among rows that may cover half the window, and the median would then be a
 * row's colour.
 */
export function backgroundOf(values: number[]) {
  const counts = new Uint32Array(64);
  for (const v of values) counts[v >> 2]++;
  let best = 0;
  for (let i = 1; i < 64; i++) if (counts[i] > counts[best]) best = i;
  // The mean of the values in the winning step and its two neighbours, against step edges.
  let sum = 0;
  let n = 0;
  for (const v of values)
    if (Math.abs((v >> 2) - best) <= 1) {
      sum += v;
      n++;
    }
  return n ? sum / n : best * 4 + 2;
}

/** The share of values on the few most common colours (each a step of 4 and its neighbours). */
export function flatShare(values: number[]) {
  const counts = new Uint32Array(64);
  for (const v of values) counts[v >> 2]++;
  const taken = new Uint8Array(64);
  let flat = 0;
  for (let k = 0; k < FLAT_COLOURS; k++) {
    let best = -1;
    for (let i = 0; i < 64; i++) if (!taken[i] && (best < 0 || counts[i] > counts[best])) best = i;
    for (let i = Math.max(0, best - 1); i <= Math.min(63, best + 1); i++)
      if (!taken[i]) {
        taken[i] = 1;
        flat += counts[i];
      }
  }
  return values.length ? flat / values.length : 0;
}

/**
 * Measure the spacing around a dot or an area. A dot measures the shape or
 * the line of text under it (or the nearest one within a short reach); an
 * area measures what its box encloses, fitted tight to the ink inside it, so
 * a block of several lines is measured with an area. Arrows are not measured.
 */
export function measureSpacing(grid: LumaGrid, shape: Shape): Measured {
  if (shape.kind === 'arrow') return { ok: false, reason: 'arrow' };
  const { cell, cols, rows, luma, width, height } = grid;
  if (cols < 3 || rows < 3 || cell <= 0) return { ok: false, reason: 'empty' };
  const at = (c: number, r: number) => luma[r * cols + c];
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
  const join = Math.max(1, Math.round((JOIN * Math.max(width, height)) / cell));
  const joinY = Math.max(1, Math.ceil(join / 2));

  // The colour the spot sits on: around a dot, from filling its own colour (`colourAround`);
  // around an area, from a band outside the box, so a filled button inside it is the element.
  const sample = (
    c0: number,
    c1: number,
    r0: number,
    r1: number,
    skip?: (c: number, r: number) => boolean,
  ) => {
    const out: number[] = [];
    const step = Math.max(1, Math.round(Math.max(c1 - c0, r1 - r0) / 300));
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r += step)
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c += step)
        if (!skip?.(c, r)) out.push(at(c, r));
    return out;
  };
  const around = Math.max(8 * join, Math.round((AROUND * Math.max(width, height)) / cell));

  /**
   * The colour a dot sits on. Fill the dot's own colour outward: a small, closed region (a
   * letter, a list row, a button) is an element, and the background is the colour around it;
   * a large or open one (the space of a card or the page) is the background itself.
   */
  const colourAround = (c0: number, r0: number) => {
    const own = at(c0, r0);
    const same = (c: number, r: number) => Math.abs(at(c, r) - own) < INK;
    const limit = Math.round((0.35 * Math.max(width, height)) / cell);
    const most = Math.round(ELEMENT_AREA * cols * rows);
    const inside = new Uint8Array(cols * rows);
    const stack: number[] = [r0 * cols + c0];
    inside[stack[0]] = 1;
    let size = 0;
    let [left, right, top, bottom] = [c0, c0, r0, r0];
    while (stack.length) {
      const i = stack.pop() as number;
      const c = i % cols;
      const r = (i - c) / cols;
      if (++size > most || Math.abs(c - c0) >= limit || Math.abs(r - r0) >= limit) return own;
      left = Math.min(left, c);
      right = Math.max(right, c);
      top = Math.min(top, r);
      bottom = Math.max(bottom, r);
      for (const [nc, nr] of [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ]) {
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return own;
        const j = nr * cols + nc;
        if (inside[j]) continue;
        inside[j] = 1;
        if (same(nc, nr)) stack.push(j);
      }
    }
    // The band a little outside the region's box, past its anti-aliased edge (an edge is a ring
    // of in-between colours, never the background).
    const from = Math.max(2, Math.ceil(3 / cell));
    const to = from + Math.max(2, join);
    const band = sample(left - to, right + to, top - to, bottom + to, (c, r) =>
      c > left - from && c < right + from && r > top - from && r < bottom + from,
    );
    return band.length ? backgroundOf(band) : own;
  };
  let box: { c0: number; c1: number; r0: number; r1: number } | undefined;
  let cx: number;
  let cy: number;
  let near: number[];
  let dotBackground: number | undefined;
  if (shape.kind === 'dot') {
    cx = col(shape.x * width);
    cy = row(shape.y * height);
    near = sample(cx - around, cx + around, cy - around, cy + around);
    dotBackground = colourAround(cx, cy);
  } else {
    box = {
      c0: col(shape.x * width),
      c1: col((shape.x + shape.w) * width),
      r0: row(shape.y * height),
      r1: row((shape.y + shape.h) * height),
    };
    const b = box;
    cx = (b.c0 + b.c1) >> 1;
    cy = (b.r0 + b.r1) >> 1;
    // A thin band just outside the box: an author draws a box with a little margin, so the band
    // is the background; a wider one would reach the neighbours (the next rows of a list).
    const pad = Math.max(2, join);
    near = sample(b.c0 - pad, b.c1 + pad, b.r0 - pad, b.r1 + pad, (c, r) =>
      c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1,
    );
    if (!near.length) near = sample(b.c0, b.c1, b.r0, b.r1);
  }
  if (!near.length) return { ok: false, reason: 'empty' };
  const background = dotBackground ?? backgroundOf(near);
  if (flatShare(near) < FLAT_SHARE) return { ok: false, reason: 'busy' };
  const ink = (c: number, r: number) => Math.abs(at(c, r) - background) >= INK;

  let found: { c0: number; c1: number; r0: number; r1: number } | undefined;
  if (box) {
    // An area: the ink inside its box, fitted tight.
    const b = box;
    for (let r = b.r0; r <= b.r1; r++)
      for (let c = b.c0; c <= b.c1; c++)
        if (ink(c, r)) {
          if (!found) found = { c0: c, c1: c, r0: r, r1: r };
          else {
            found.c0 = Math.min(found.c0, c);
            found.c1 = Math.max(found.c1, c);
            found.r0 = Math.min(found.r0, r);
            found.r1 = Math.max(found.r1, r);
          }
        }
  } else {
    // A dot: the element under it, or the nearest one a short way off.
    let seed: [number, number] | undefined;
    for (let d = 0; d <= 3 * join && !seed; d++)
      for (let r = cy - d; r <= cy + d && !seed; r++)
        for (let c = cx - d; c <= cx + d && !seed; c++)
          if (
            (Math.abs(r - cy) === d || Math.abs(c - cx) === d) &&
            c >= 0 &&
            r >= 0 &&
            c < cols &&
            r < rows &&
            ink(c, r)
          )
            seed = [c, r];
    if (!seed) return { ok: false, reason: 'empty' };
    // Grow over ink, across gaps up to `jx` along a row and `jy` down a column, so the letters
    // of a word read as one element. Null when it spreads too far: no element of its own.
    const limit = Math.round((0.35 * Math.max(width, height)) / cell);
    const isStrong = (c: number, r: number) => Math.abs(at(c, r) - background) >= STRONG;
    const grow = (from: [number, number], jx: number, jy: number, strong = false) => {
      const take = strong ? isStrong : ink;
      const visited = new Uint8Array(cols * rows);
      const stack = [from];
      visited[from[1] * cols + from[0]] = 1;
      const g = {
        c0: from[0],
        c1: from[0],
        r0: from[1],
        r1: from[1],
        ink: 0,
        // A cell of strong ink in it, to start the text pass from (the seed may be a faint rim).
        strongAt: undefined as [number, number] | undefined,
      };
      while (stack.length) {
        const [c, r] = stack.pop() as [number, number];
        if (Math.abs(c - cx) > limit || Math.abs(r - cy) > limit) return null;
        g.ink++;
        if (!g.strongAt && isStrong(c, r)) g.strongAt = [c, r];
        g.c0 = Math.min(g.c0, c);
        g.c1 = Math.max(g.c1, c);
        g.r0 = Math.min(g.r0, r);
        g.r1 = Math.max(g.r1, r);
        const visit = (nc: number, nr: number) => {
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return;
          const i = nr * cols + nc;
          if (visited[i] || !take(nc, nr)) return;
          visited[i] = 1;
          stack.push([nc, nr]);
        };
        // A gap of `jx` cells is crossed: the next ink is `jx + 1` away.
        for (let k = 1; k <= jx + 1; k++) {
          visit(c - k, r);
          visit(c + k, r);
        }
        for (let k = 1; k <= jy + 1; k++) {
          visit(c, r - k);
          visit(c, r + k);
        }
      }
      return g;
    };
    let g = grow(seed, join, joinY);
    if (!g) return { ok: false, reason: 'busy' };
    // Text: sparse ink, or letters with empty columns between them. Then the gaps between its
    // words scale with its size, not the image's: grow again along the line with a join set by
    // its height, so a dot on a headline or a big figure measures the whole line, not the one
    // word or the digits after a comma. Lines are not joined: a label over a figure sits as close
    // as two lines of a paragraph, so a dot measures its line, and an area measures a block. A
    // solid shape (a button, an avatar) is not grown, so it doesn't swallow the label beside it.
    const h = g.r1 - g.r0 + 1;
    const between = (c: number) => {
      for (let r = (g as { r0: number }).r0; r <= (g as { r1: number }).r1; r++)
        if (ink(c, r)) return false;
      return true;
    };
    let gapped = false;
    for (let c = g.c0 + 1; c < g.c1 && !gapped; c++) gapped = between(c);
    // Only strong ink joins at that reach: letters are strong, a card's faint edge is not, so
    // the text doesn't run along the edge into the whole card. The first pass's box is kept as
    // well, for the faint anti-aliased rims of the letters.
    if ((gapped || g.ink / ((g.c1 - g.c0 + 1) * h) < TEXT_DENSITY) && g.strongAt) {
      const text = grow(g.strongAt, Math.max(join, Math.ceil(0.6 * h)), joinY, true);
      if (text)
        g = {
          ...text,
          c0: Math.min(g.c0, text.c0),
          c1: Math.max(g.c1, text.c1),
          r0: Math.min(g.r0, text.r0),
          r1: Math.max(g.r1, text.r1),
        };
    }
    found = { c0: g.c0, c1: g.c1, r0: g.r0, r1: g.r1 };
  }
  if (!found) return { ok: false, reason: 'empty' };

  // Take in the element's faint rim: anti-aliased edges, up to 3px beyond its box, so a gap is
  // measured from the edge as drawn and never reads 0 against the element's own outline.
  const rim = Math.max(1, Math.ceil(3 / cell));
  const lineHas = (vertical: boolean, line: number, from: number, to: number) => {
    for (let k = from; k <= to; k++) if (vertical ? ink(k, line) : ink(line, k)) return true;
    return false;
  };
  const f = found;
  for (let k = 0; k < rim && f.r0 > 0 && lineHas(true, f.r0 - 1, f.c0, f.c1); k++) f.r0--;
  for (let k = 0; k < rim && f.r1 < rows - 1 && lineHas(true, f.r1 + 1, f.c0, f.c1); k++) f.r1++;
  for (let k = 0; k < rim && f.c0 > 0 && lineHas(false, f.c0 - 1, f.r0, f.r1); k++) f.c0--;
  for (let k = 0; k < rim && f.c1 < cols - 1 && lineHas(false, f.c1 + 1, f.r0, f.r1); k++) f.c1++;

  // From each edge outward, within the element's span, to the first line with ink on it.
  const e = found;
  const need = (span: number) => Math.max(2, Math.ceil(span * 0.01));
  const gaps: Gaps = {};
  const scan = (side: Side) => {
    const vertical = side === 'above' || side === 'below';
    const step = side === 'above' || side === 'left' ? -1 : 1;
    const start = side === 'above' ? e.r0 : side === 'below' ? e.r1 : side === 'left' ? e.c0 : e.c1;
    const size = vertical ? rows : cols;
    const reach = Math.round((REACH * (vertical ? height : width)) / cell);
    const [from, to] = vertical ? [e.c0, e.c1] : [e.r0, e.r1];
    for (let d = 1; d <= reach; d++) {
      const line = start + step * d;
      if (line < 0 || line >= size) return;
      let hits = 0;
      for (let k = from; k <= to; k++) if (vertical ? ink(k, line) : ink(line, k)) hits++;
      if (hits >= need(to - from + 1)) {
        gaps[side] = (d - 1) * cell;
        return;
      }
    }
  };
  for (const side of SIDES) scan(side);
  const x = e.c0 * cell;
  const y = e.r0 * cell;
  return {
    ok: true,
    element: {
      x,
      y,
      w: Math.min(width, (e.c1 + 1) * cell) - x,
      h: Math.min(height, (e.r1 + 1) * cell) - y,
    },
    gaps,
    precision: cell,
  };
}

/** Pixels of the screenshot per CSS pixel. */
export type Scale = 1 | 2 | 3;

/**
 * A first guess at a screenshot's scale from its size: a tall phone capture
 * 1080px or wider is 3×, a narrower one 2×; anything 2200px or wider is a
 * high-density desktop capture, 2×; otherwise 1×. The author can change it.
 */
export function guessScale(width: number, height: number): Scale {
  const phone = height / Math.max(1, width) >= 1.7 && width <= 1320;
  if (phone && width >= 1080) return 3;
  if (phone && width >= 640) return 2;
  return width >= 2200 ? 2 : 1;
}

/** The scale an image's spacing is read at: the author's, else a guess from its size. */
export function scaleOf(a: { width: number; height: number; scale?: Scale }) {
  return a.scale
    ? { scale: a.scale, guessed: false }
    : { scale: guessScale(a.width, a.height), guessed: true };
}

/** A side in a sentence: "32 px above", "24 px to the left". */
const SIDE_WORD: Record<Side, string> = {
  above: 'above',
  below: 'below',
  left: 'to the left',
  right: 'to the right',
};

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * The measurement as a sentence: `32 px above, 12 px below and 24 px to the
 * left; nothing within reach to the right (screenshot pixels; 16, 6 and 12
 * CSS px at 2×, guessed from the image size)`.
 */
export function spacingText(
  s: Pick<Spacing, 'gaps' | 'precision'>,
  scale: Scale,
  guessed: boolean,
): string {
  const sides = SIDES.filter((side) => s.gaps[side] !== undefined);
  const missing = SIDES.filter((side) => s.gaps[side] === undefined);
  if (!sides.length) return 'nothing within reach on any side';
  const gaps = list(sides.map((side) => `${s.gaps[side]} px ${SIDE_WORD[side]}`));
  const none = missing.length
    ? `; nothing within reach ${list(missing.map((side) => SIDE_WORD[side]))}`
    : '';
  const off = `, ±${s.precision} px`;
  const how = guessed ? 'guessed from the image size' : 'set by the author';
  const cssPx = list(sides.map((side) => String(Math.round((s.gaps[side] as number) / scale))));
  const css =
    scale === 1
      ? `screenshot pixels${off}, the same in CSS px at 1×, ${how}`
      : `screenshot pixels${off}; ${cssPx} CSS px at ${scale}×, ${how}`;
  return `${gaps}${none} (${css})`;
}
