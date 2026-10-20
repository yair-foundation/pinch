import { backgroundOf, FLAT_SHARE, flatShare, INK, JOIN, type Scale } from './measure';
import type { LumaGrid, Rect, Shape } from './model';

/*
 * The spacing check for an area (step 2 of the spacing helper, after
 * `measure.ts`): the repeated items inside the box (list rows, cards, links)
 * along one axis, the gaps between them, and which gap is the odd one out.
 * Pure and measured on the image's pixels, like Measure spacing; it never
 * places a note itself, it only suggests a sentence the author keeps or drops.
 *
 * Items are found from the box's ink profile: lines with content, joined
 * across letter and word gaps. When the gaps come in two clear sizes (a
 * title and a subtitle 4px apart, items 16px apart), the small ones are gaps
 * inside items, and only the large ones are the rhythm.
 */

/** `column`: items stacked top to bottom; `row`: items side by side. */
export type Axis = 'column' | 'row';

/** A spacing check kept on a note. */
export type Rhythm = {
  axis: Axis;
  /** The items, in order, in pixels of the image. */
  items: Rect[];
  /** `gaps[i]` lies between item i and item i + 1, in pixels of the image. */
  gaps: number[];
  /** The median gap, what the others are compared with. */
  typical: number;
  /** Indices of the gaps that differ from the typical one by more than the tolerance. */
  odd: number[];
  /** How far off a gap can be, in pixels of the image: the grid's cell. */
  precision: number;
  /** The shape it was checked for (`shapeKey`); a moved note has to be checked again. */
  shape: string;
};

export type Checked =
  | ({ ok: true } & Omit<Rhythm, 'shape'>)
  | { ok: false; reason: 'busy' | 'empty' | 'few' | 'shape' };

/** Gap sizes this many times apart are two kinds: inside items and between them. */
const TWO_SIZES = 1.8;
/** …but only when the small kind is at least this share of the gaps, as in two-line items. */
const INSIDE_SHARE = 0.4;
/** A gap is odd when it differs from the median by more than this share of it (or 2px). */
const ODD_SHARE = 0.12;
/**
 * Inside the box, a UI is a few flat colours (a list, cards, text: 90% or more on its three most
 * common colours); a photo spreads (40–70%). Below this, a box without items is a photo.
 */
const INSIDE_FLAT = 0.8;
/** A run whose ink covers less of its box than this is text: only text joins across small gaps. */
const SPARSE = 0.5;
/** Items needed to speak of a rhythm: three, so there are two gaps to compare. */
const FEWEST = 3;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

type Run = { start: number; end: number };

/**
 * Check the rhythm of the items inside an area: their axis, the gaps between
 * them and the odd ones. Fewer than three items, a busy background or an
 * empty box say so instead.
 */
export function checkRhythm(grid: LumaGrid, shape: Shape): Checked {
  if (shape.kind !== 'area') return { ok: false, reason: 'shape' };
  const { cell, cols, rows, luma, width, height } = grid;
  if (cols < 3 || rows < 3 || cell <= 0) return { ok: false, reason: 'empty' };
  const at = (c: number, r: number) => luma[r * cols + c];
  const col = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
  const join = Math.max(1, Math.round((JOIN * Math.max(width, height)) / cell));
  const b = {
    c0: col(shape.x * width),
    c1: col((shape.x + shape.w) * width),
    r0: row(shape.y * height),
    r1: row((shape.y + shape.h) * height),
  };

  // The background: a thin band just outside the box, as Measure spacing reads it for an area.
  const pad = Math.max(2, join);
  const band: number[] = [];
  for (let r = Math.max(0, b.r0 - pad); r <= Math.min(rows - 1, b.r1 + pad); r++)
    for (let c = Math.max(0, b.c0 - pad); c <= Math.min(cols - 1, b.c1 + pad); c++)
      if (c < b.c0 || c > b.c1 || r < b.r0 || r > b.r1) band.push(at(c, r));
  if (!band.length) return { ok: false, reason: 'empty' };
  if (flatShare(band) < FLAT_SHARE) return { ok: false, reason: 'busy' };
  const background = backgroundOf(band);
  const ink = (c: number, r: number) => Math.abs(at(c, r) - background) >= INK;

  // How much ink each line of the box has, across the box.
  const across = { column: [] as number[], row: [] as number[] };
  for (let r = b.r0; r <= b.r1; r++) {
    let n = 0;
    for (let c = b.c0; c <= b.c1; c++) if (ink(c, r)) n++;
    across.column.push(n);
  }
  for (let c = b.c0; c <= b.c1; c++) {
    let n = 0;
    for (let r = b.r0; r <= b.r1; r++) if (ink(c, r)) n++;
    across.row.push(n);
  }
  if (!across.column.some((n) => n > 0)) return { ok: false, reason: 'empty' };

  /** A run of lines with content, with its ink and its extent across the box. */
  type Stat = Run & { ink: number; lo: number; hi: number };
  const along = (axis: Axis) => {
    const profile = across[axis];
    const offset = axis === 'column' ? b.r0 : b.c0;
    const [k0, k1] = axis === 'column' ? [b.c0, b.c1] : [b.r0, b.r1];
    const isInk = (line: number, k: number) => (axis === 'column' ? ink(k, line) : ink(line, k));
    // A line has content when a few cells of it are ink, not one stray pixel of noise.
    const need = Math.max(2, Math.ceil(0.003 * (k1 - k0 + 1)));
    let runs: Stat[] = [];
    profile.forEach((n, i) => {
      if (n < need) return;
      const last = runs[runs.length - 1];
      if (last && last.end === offset + i - 1) last.end = offset + i;
      else runs.push({ start: offset + i, end: offset + i, ink: 0, lo: k1, hi: k0 });
    });
    for (const run of runs)
      for (let line = run.start; line <= run.end; line++)
        for (let k = k0; k <= k1; k++)
          if (isInk(line, k)) {
            run.ink++;
            run.lo = Math.min(run.lo, k);
            run.hi = Math.max(run.hi, k);
          }
    const gapOf = (x: Run, z: Run) => z.start - x.end - 1;
    // Letters and words are sparse ink; a bar, a card or a filled row is solid.
    const sparse = (r: Stat) => r.ink / ((r.end - r.start + 1) * (r.hi - r.lo + 1)) < SPARSE;
    const merge = (limit: number, onlySparse: boolean) => {
      const out: Stat[] = [];
      for (const r of runs) {
        const last = out[out.length - 1];
        if (last && gapOf(last, r) <= limit && (!onlySparse || (sparse(last) && sparse(r)))) {
          last.end = r.end;
          last.ink += r.ink;
          last.lo = Math.min(last.lo, r.lo);
          last.hi = Math.max(last.hi, r.hi);
        } else out.push({ ...r });
      }
      runs = out;
    };
    // Letters and words of text, never solid items set close together (bars of a chart): a
    // side-by-side row joins at the word join, a column at half of it.
    merge(axis === 'row' ? join : Math.max(1, Math.ceil(join / 2)), true);
    // Two sizes of gap, the small ones many: gaps inside items. Join them.
    const gaps = runs.slice(1).map((r, i) => gapOf(runs[i], r));
    if (gaps.length >= 3) {
      const sorted = [...gaps].sort((x, y) => x - y);
      let split = -1;
      let jump = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const ratio = sorted[i + 1] / Math.max(1, sorted[i]);
        if (ratio > jump) {
          jump = ratio;
          split = i;
        }
      }
      if (jump >= TWO_SIZES && (split + 1) / gaps.length >= INSIDE_SHARE)
        merge(sorted[split], false);
    }
    return runs;
  };

  // How alike the items are in size along the axis: 0 when all the same.
  const spread = (runs: Run[]) => {
    const sizes = runs.map((r) => r.end - r.start + 1);
    const mean = sizes.reduce((x, y) => x + y, 0) / sizes.length;
    const sd = Math.sqrt(sizes.reduce((x, y) => x + (y - mean) ** 2, 0) / sizes.length);
    return mean ? sd / mean : 0;
  };
  const columnRuns = along('column');
  const rowRuns = along('row');
  const longer: Axis = b.r1 - b.r0 >= b.c1 - b.c0 ? 'column' : 'row';
  // The axis with items to compare: when both have three or more, the one whose items are alike
  // in size (the rows of a list, not its tile, bar and amount columns), then the one with more.
  const both = columnRuns.length >= FEWEST && rowRuns.length >= FEWEST;
  const [cs, rs] = [spread(columnRuns), spread(rowRuns)];
  const axis: Axis =
    both && Math.abs(cs - rs) > 0.05
      ? cs < rs
        ? 'column'
        : 'row'
      : columnRuns.length === rowRuns.length
        ? longer
        : columnRuns.length > rowRuns.length
          ? 'column'
          : 'row';
  const runs = axis === 'column' ? columnRuns : rowRuns;
  if (runs.length < FEWEST) {
    // Too few items, or a photo: a picture fills the box with ink and leaves no gaps to find.
    // Then say it's a photo, not that the author drew the area around too few items.
    const inside: number[] = [];
    const step = Math.max(1, Math.round(Math.max(b.c1 - b.c0, b.r1 - b.r0) / 300));
    for (let r = b.r0; r <= b.r1; r += step)
      for (let c = b.c0; c <= b.c1; c += step) inside.push(at(c, r));
    return { ok: false, reason: flatShare(inside) < INSIDE_FLAT ? 'busy' : 'few' };
  }

  // Each item's box: its run along the axis, and the ink it holds across it.
  const items: Rect[] = runs.map((run) => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = -1;
    for (let i = run.start; i <= run.end; i++)
      for (let k = axis === 'column' ? b.c0 : b.r0; k <= (axis === 'column' ? b.c1 : b.r1); k++)
        if (axis === 'column' ? ink(k, i) : ink(i, k)) {
          lo = Math.min(lo, k);
          hi = Math.max(hi, k);
        }
    const [x0, x1, y0, y1] =
      axis === 'column' ? [lo, hi, run.start, run.end] : [run.start, run.end, lo, hi];
    return {
      x: x0 * cell,
      y: y0 * cell,
      w: Math.min(width, (x1 + 1) * cell) - x0 * cell,
      h: Math.min(height, (y1 + 1) * cell) - y0 * cell,
    };
  });
  const gaps = runs.slice(1).map((r, i) => (r.start - runs[i].end - 1) * cell);
  const typical = median(gaps);
  const tolerance = Math.max(2 * cell, 2, Math.round(ODD_SHARE * typical));
  const off = gaps.flatMap((g, i) => (Math.abs(g - typical) > tolerance ? [i] : []));
  // Two gaps have no majority: when they differ, both are reported, neither is "the odd one".
  const odd = gaps.length === 2 && Math.abs(gaps[0] - gaps[1]) > tolerance ? [0, 1] : off;
  return { ok: true, axis, items, gaps, typical, odd, precision: cell };
}

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const css = (px: number, scale: Scale) => Math.round(px / scale);

type Found = Pick<Rhythm, 'axis' | 'items' | 'gaps' | 'typical' | 'odd' | 'precision'>;

/**
 * The check as a sentence for the export: `5 items in a column; gaps 16, 16,
 * 24 and 16 px (8, 8, 12 and 8 CSS px at 2×, guessed from the image size).
 * The gap after item 3 differs: 24 px where the others are about 16.`
 */
export function rhythmText(r: Found, scale: Scale, guessed: boolean) {
  const how = guessed ? 'guessed from the image size' : 'set by the author';
  const off = r.precision > 1 ? `, ±${r.precision} px` : '';
  const px = list(r.gaps.map(String));
  const cssPx =
    scale === 1
      ? 'the same in CSS px at 1×'
      : `${list(r.gaps.map((g) => String(css(g, scale))))} CSS px at ${scale}×`;
  const head = `${r.items.length} items in a ${r.axis}; gaps ${px} px (screenshot pixels${off}; ${cssPx}, ${how})`;
  if (!r.odd.length) return `${head}. Even: every gap is within 12% or 2 px of ${r.typical} px.`;
  if (r.gaps.length === 2) return `${head}. Uneven: ${r.gaps[0]} px, then ${r.gaps[1]} px.`;
  const after = list(r.odd.map((i) => String(i + 1)));
  const which =
    r.odd.length === 1
      ? `The gap after item ${after} differs`
      : `The gaps after items ${after} differ`;
  const odd = list(r.odd.map((i) => `${r.gaps[i]} px`));
  return `${head}. ${which}: ${odd} where the others are about ${r.typical}.`;
}

/**
 * A sentence the author can add to the note, in CSS pixels: for "what
 * doesn't" when a gap is off, for "what works" when the rhythm is even.
 */
export function rhythmSuggestion(r: Pick<Rhythm, 'axis' | 'gaps' | 'typical' | 'odd'>, scale: Scale) {
  const unit = scale === 1 ? 'px' : 'CSS px';
  const things = r.axis === 'column' ? 'rows' : 'items';
  const at = (px: number) => css(px, scale);
  if (!r.odd.length)
    return {
      field: 'good' as const,
      text: `Even rhythm: every gap between the ${things} is ${at(r.typical)} ${unit}.`,
    };
  if (r.gaps.length === 2)
    return {
      field: 'bad' as const,
      text: `Uneven spacing between the ${things}: ${at(r.gaps[0])} ${unit}, then ${at(r.gaps[1])} ${unit}.`,
    };
  const after = list(r.odd.map((i) => String(i + 1)));
  const gaps = list(r.odd.map((i) => String(at(r.gaps[i]))));
  const item = r.odd.length === 1 ? 'item' : 'items';
  return {
    field: 'bad' as const,
    text: `Uneven spacing between the ${things}: the gap after ${item} ${after} is ${gaps} ${unit} where the others are ${at(r.typical)}.`,
  };
}
