import {
  agentGuide,
  type Asset,
  assetFiles,
  busyShare,
  inkShare,
  type CropOf,
  cropRect,
  exportable,
  GUIDE_FILE,
  type LumaGrid,
  manifest,
  type Mark,
  readme,
  type Rect,
  SHEET_FILE,
  settleCrop,
  type Shape,
  verdictOf,
} from '@/lib/pin/model';
import { layoutSheet } from '@/lib/pin/sheet';
import { zip, type ZipEntry } from '@/lib/pin/zip';

/*
 * Pinch's drawing, in the browser: a copy of each image with its notes
 * drawn on, a close-up crop of every note, a contact sheet of the batch, and
 * the zip that carries them. Marker colours: green works, red doesn't, amber
 * both.
 */

export const VERDICT_COLOR = {
  good: '#16a34a',
  bad: '#dc2626',
  both: '#d97706',
  empty: '#737373',
};
/** The marker the AI sees for a suggestion: a colour no interface uses for chrome, so it isn't read as part of the design. */
const AI_MARK_COLOR = '#ff00c8';
const SHEET_BG = '#1c1d22';
/** A crop's longest side: smaller than the 1800px marked copy, so a wide crop still costs less. */
const CROP_MAX_SIDE = 1200;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const bitmapOf = (blob: Blob) => createImageBitmap(blob);

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw images.');
  return { canvas, ctx };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not save an image.'))),
      type,
      quality,
    ),
  );

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The numbered disc: a coloured rim, a white face, the number. */
function drawDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  unit: number,
  number: number,
  color: string,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3 * unit, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6 * unit;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#171717';
  ctx.font = `600 ${Math.round(12 * unit)}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), cx, cy + 0.5 * unit);
}

/** A stroke twice: a dark halo under the colour, so the mark reads on any background. */
function strokeHalo(ctx: CanvasRenderingContext2D, color: string, width: number) {
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = width * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** The ring at a point: open in the middle, so what it marks stays visible. */
function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ring: number,
  unit: number,
  color: string,
) {
  ctx.beginPath();
  ctx.arc(x, y, ring, 0, Math.PI * 2);
  strokeHalo(ctx, color, 3 * unit);
  ctx.beginPath();
  ctx.arc(x, y, ring - 2.2 * unit, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.2 * unit;
  ctx.stroke();
}

/**
 * How much text or control a disc of radius `r` centred at canvas (x, y)
 * would cover, 0 to 1; from the image's luma grid (`busyShare`, `inkShare`).
 */
type Busy = (x: number, y: number, r: number) => number;

/**
 * A disc counts as sitting on nothing when at most this share of the cells under it has ink or
 * an edge. Near zero on purpose: at 3% a disc's rim already touches a label's letters.
 */
const QUIET_DISC = 0.005;
/** Leader lengths tried, in radii of the disc: the short default, then longer to clear what the point sits on. */
const LEADERS = [1.7, 2.15, 2.6];
/** When no preferred direction has room: every 22.5°, with one longer leader as the last stretch. */
const FAN = Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8);
const FAN_LEADERS = [...LEADERS, 3.2];
/**
 * Longer leaders tried only after every short one in every direction, for a point in the middle
 * of text where no place beside it is quiet: a number a little further off, on a line, covers
 * nothing; a short one sits on the words it marks.
 */
const FAR_LEADERS = [3.4, 4.4, 5.6];
/** Points along a leader where what it crosses is measured. */
const LINE_SAMPLES = 6;
/** A leader counts as crossing nothing when this share or less of what it passes over is ink. */
const CLEAR_LINE = 0.02;

/**
 * The numbered disc beside a ring, on a leader. It sits off the point in
 * one of the `prefer` directions (unit vectors, best first), at the shortest
 * of `LEADERS` with room on the canvas; the leader lengthens before a less
 * preferred direction is tried, so the disc clears a wide element behind the
 * point. When no preferred direction has room (the point is in a corner of
 * the picture) every direction is tried, nearest the first preference first.
 * Among the places with room: when the image could be sampled, the first
 * that covers nothing (text, a control's edge, `busy`), else the one that
 * covers least; a place `avoid` names (an arrow's own line) comes after the
 * others. With no room anywhere the disc is clamped inside the canvas in the
 * direction with most room, so it is never off the picture.
 */
function drawLeaderDisc(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  ring: number,
  r: number,
  unit: number,
  number: number,
  color: string,
  prefer: [number, number][],
  busy?: Busy,
  avoid?: (x: number, y: number) => boolean,
) {
  const edge = r + 3 * unit + 1;
  const { width: W, height: H } = ctx.canvas;
  const fits = (x: number, y: number) => x >= edge && x <= W - edge && y >= edge && y <= H - edge;
  const at = (ux: number, uy: number, k: number) => ({ x: x0 + ux * k * r, y: y0 + uy * k * r });
  let spots: { x: number; y: number }[] = [];
  for (const [ux, uy] of prefer)
    for (const k of LEADERS) {
      const s = at(ux, uy, k);
      if (fits(s.x, s.y)) spots.push(s);
    }
  if (!spots.length) {
    const first = Math.atan2(prefer[0][1], prefer[0][0]);
    const away = (a: number) => Math.abs(Math.atan2(Math.sin(a - first), Math.cos(a - first)));
    for (const a of [...FAN].sort((p, q) => away(p) - away(q)))
      for (const k of FAN_LEADERS) {
        const s = at(Math.cos(a), Math.sin(a), k);
        if (fits(s.x, s.y)) spots.push(s);
      }
  }
  let cx: number;
  let cy: number;
  if (!spots.length) {
    // No room in any direction: the direction with most, clamped inside the canvas.
    const room = ([ux, uy]: [number, number]) => {
      const x = clamp(x0 + ux * LEADERS[0] * r, edge, Math.max(edge, W - edge));
      const y = clamp(y0 + uy * LEADERS[0] * r, edge, Math.max(edge, H - edge));
      return { x, y, d: Math.hypot(x - x0, y - y0) };
    };
    const best = prefer.map(room).reduce((a, b) => (b.d > a.d ? b : a));
    cx = best.x;
    cy = best.y;
  } else {
    for (const k of FAR_LEADERS)
      for (const [ux, uy] of prefer) {
        const s = at(ux, uy, k);
        if (fits(s.x, s.y)) spots.push(s);
      }
    if (avoid) spots = [...spots.filter((s) => !avoid(s.x, s.y)), ...spots.filter((s) => avoid(s.x, s.y))];
    // The leader crosses what lies between the ring and the disc: sampled along its length.
    const lineOver = (x: number, y: number) => {
      if (!busy) return 0;
      const len = Math.hypot(x - x0, y - y0);
      const from = ring + 2 * unit;
      const to = len - r - 2.5 * unit;
      if (to <= from) return 0;
      let total = 0;
      for (let i = 0; i < LINE_SAMPLES; i++) {
        const d = from + ((to - from) * (i + 0.5)) / LINE_SAMPLES;
        total += busy(x0 + ((x - x0) * d) / len, y0 + ((y - y0) * d) / len, 2.5 * unit);
      }
      return total / LINE_SAMPLES;
    };
    const scored = spots.map((s) => ({
      ...s,
      score: busy ? busy(s.x, s.y, r + 3 * unit) : 0,
      line: lineOver(s.x, s.y),
    }));
    // A clear place whose leader crosses (almost) nothing, nearest first; else the clear place
    // whose leader crosses least; else the place covering least, its leader counted at half.
    const quiet = scored.filter((s) => s.score <= QUIET_DISC);
    const pick =
      quiet.find((s) => s.line <= CLEAR_LINE) ??
      (quiet.length
        ? quiet.reduce((a, b) => (b.line < a.line ? b : a))
        : scored.reduce((a, b) => (b.score + b.line / 2 < a.score + a.line / 2 ? b : a)));
    ({ x: cx, y: cy } = pick);
  }
  const len = Math.hypot(cx - x0, cy - y0);
  if (len > ring + r + 2 * unit) {
    const ux = (cx - x0) / len;
    const uy = (cy - y0) / len;
    ctx.beginPath();
    ctx.moveTo(x0 + ux * (ring + 2 * unit), y0 + uy * (ring + 2 * unit));
    ctx.lineTo(cx - ux * (r + 2.5 * unit), cy - uy * (r + 2.5 * unit));
    strokeHalo(ctx, color, 2.2 * unit);
  }
  drawDisc(ctx, cx, cy, r, unit, number, color);
  return { x: cx, y: cy };
}

/**
 * `busy` for a canvas that shows the image at `scale` from image pixel
 * `origin`: a disc on the canvas is measured on the image's luma grid.
 */
function busyOn(grid: LumaGrid | undefined, scale: number, origin: Rect | null): Busy | undefined {
  if (!grid) return undefined;
  return (x, y, r) => {
    const R = r / scale;
    const rect = {
      x: (origin?.x ?? 0) + x / scale - R,
      y: (origin?.y ?? 0) + y / scale - R,
      w: 2 * R,
      h: 2 * R,
    };
    // Edges catch small text and outlines; ink catches the inside of big type and filled badges.
    return Math.max(busyShare(grid, rect), inkShare(grid, rect));
  };
}

/**
 * `busy` that also counts the other notes on the same picture as taken: their
 * rings, boxes, arrows and the discs already placed. A disc or its leader then
 * never lands on another note's marker, so a number can't read as tagging
 * that note's element.
 */
function withOthers(
  busy: Busy | undefined,
  others: Shape[],
  px: (x: number, y: number) => [number, number],
  unit: number,
  placed: { x: number; y: number }[],
): Busy {
  const disc = 14 * unit;
  const near = (x: number, y: number, ax: number, ay: number, d: number) =>
    Math.hypot(x - ax, y - ay) < d;
  const toSegment = (x: number, y: number, a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  };
  return (x, y, r) => {
    for (const p of placed) if (near(x, y, p.x, p.y, r + disc + 2 * unit)) return 1;
    for (const s of others) {
      const a = px(s.x, s.y);
      if (s.kind === 'dot') {
        if (near(x, y, a[0], a[1], r + 9 * unit)) return 1;
      } else if (s.kind === 'arrow') {
        const b = px(s.x2, s.y2);
        if (near(x, y, a[0], a[1], r + 8 * unit) || near(x, y, b[0], b[1], r + 14 * unit)) return 1;
        if (toSegment(x, y, a, b) < r + 2 * unit) return 1;
      } else {
        const b = px(s.x + s.w, s.y + s.h);
        const dx = Math.max(a[0] - x, 0, x - b[0]);
        const dy = Math.max(a[1] - y, 0, y - b[1]);
        if (Math.hypot(dx, dy) < r) return 1;
      }
    }
    return busy?.(x, y, r) ?? 0;
  };
}

/**
 * One numbered marker. `px` maps image fractions to canvas pixels; `unit`
 * sets the marker size. A dot is a small ring at the point, with the number
 * on a disc up and left of it on a short leader, so the number never covers
 * what the dot marks; near an edge, or when it would sit on text or a
 * control (`busy`, from the image's luma grid), the disc moves to another
 * corner or further out. An area is a box with the number just outside the
 * first corner that covers nothing (top-left first), else nudged inside it. An arrow is a
 * line from its tail to a filled head, a small ring at the tail and the disc
 * behind the tail or beside it, off the line and off what the tail marks.
 * (After Scrawl's `draw_mark_numbers`.)
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  number: number,
  px: (x: number, y: number) => [number, number],
  unit: number,
  color = VERDICT_COLOR[verdictOf(mark)],
  busy?: Busy,
) {
  const r = 11 * unit;
  const edge = r + 3 * unit + 1;
  const [x0, y0] = px(mark.shape.x, mark.shape.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (mark.shape.kind === 'area') {
    const [x1, y1] = px(mark.shape.x + mark.shape.w, mark.shape.y + mark.shape.h);
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    strokeHalo(ctx, color, 3 * unit);
    // The number just outside a corner: top-left first, then the other corners, the first that
    // covers no text or control (`busy`), else the one covering least; inside the box only when
    // no corner outside has room.
    const out = 0.9 * r;
    const { width: W, height: H } = ctx.canvas;
    const fits = (x: number, y: number) => x >= edge && x <= W - edge && y >= edge && y <= H - edge;
    const corners = [
      [x0 - out, y0 - out],
      [x1 + out, y0 - out],
      [x0 - out, y1 + out],
      [x1 + out, y1 + out],
    ].filter(([x, y]) => fits(x, y));
    let cx = Math.max(edge, x0);
    let cy = Math.max(edge, y0);
    if (corners.length) {
      const scored = corners.map(([x, y]) => ({ x, y, score: busy ? busy(x, y, r + 3 * unit) : 0 }));
      const quiet = scored.find((c) => c.score <= QUIET_DISC);
      ({ x: cx, y: cy } = quiet ?? scored.reduce((a, b) => (b.score < a.score ? b : a)));
    }
    drawDisc(ctx, cx, cy, r, unit, number, color);
    return { x: cx, y: cy };
  }
  if (mark.shape.kind === 'arrow') {
    const [x1, y1] = px(mark.shape.x2, mark.shape.y2);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    // The head: a filled triangle, no longer than a third of the arrow.
    const head = Math.min(13 * unit, len / 3);
    const half = head * 0.42;
    const bx = x1 - ux * head;
    const by = y1 - uy * head;
    const ring = 4 * unit;
    // The shaft is thin and a little see-through: it crosses what it points between, and that
    // text has to stay readable under it.
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0 + ux * (ring + 1.5 * unit), y0 + uy * (ring + 1.5 * unit));
    ctx.lineTo(bx + ux * head * 0.3, by + uy * head * 0.3);
    strokeHalo(ctx, color, 2 * unit);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - uy * half, by + ux * half);
    ctx.lineTo(bx + uy * half, by - ux * half);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 4 * unit;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    drawRing(ctx, x0, y0, ring, unit, color);
    // Whether a disc centred at (x, y) would lie on the arrow's line.
    const onLine = (x: number, y: number) => {
      const t = clamp(((x - x0) * ux + (y - y0) * uy) / len, 0, 1);
      return Math.hypot(x - (x0 + ux * t * len), y - (y0 + uy * t * len)) < r + 3 * unit;
    };
    // The disc behind the tail, off the line; beside it when the tail is near an edge or on
    // a wide element; on the line only when nothing else has room.
    return drawLeaderDisc(
      ctx,
      x0,
      y0,
      ring,
      r,
      unit,
      number,
      color,
      [
        [-ux, -uy],
        [uy, -ux],
        [-uy, ux],
      ],
      busy,
      onLine,
    );
  }
  const ring = 5 * unit;
  drawRing(ctx, x0, y0, ring, unit, color);
  // The disc, up and left, flipped to the side with room near an edge; the other corners after.
  const { width: W, height: H } = ctx.canvas;
  const off = LEADERS[0] * r;
  const dx = x0 - off - edge >= 0 || x0 + off + edge > W ? -1 : 1;
  const dy = y0 - off - edge >= 0 || y0 + off + edge > H ? -1 : 1;
  // The diagonals are not unit vectors on purpose: the disc sits √2 further out on them, as before.
  return drawLeaderDisc(
    ctx,
    x0,
    y0,
    ring,
    r,
    unit,
    number,
    color,
    [
      [dx, dy],
      [-dx, dy],
      [dx, -dy],
      [-dx, -dy],
      [dx, 0],
      [0, dy],
      [-dx, 0],
      [0, -dy],
    ],
    busy,
  );
}

const written = (a: Asset) => a.marks.filter((m) => verdictOf(m) !== 'empty');

/**
 * Every note of one picture, numbered in order, each number kept off the
 * other notes' markers and the numbers already placed (`withOthers`).
 */
function drawAll(
  ctx: CanvasRenderingContext2D,
  marks: Mark[],
  px: (x: number, y: number) => [number, number],
  unit: number,
  busy?: Busy,
) {
  const placed: { x: number; y: number }[] = [];
  for (const [i, m] of marks.entries()) {
    const others = marks.filter((o) => o !== m).map((o) => o.shape);
    const room = withOthers(busy, others, px, unit, placed);
    placed.push(drawMark(ctx, m, i + 1, px, unit, undefined, room));
  }
}

/**
 * The whole image with every note drawn on it, at most `maxSide` pixels on
 * the long side. `grid` (the image's luma, `lumaGrid`) keeps each number off
 * text and controls; sampled here when not given.
 */
export async function markedImage(
  bitmap: ImageBitmap,
  asset: Asset,
  maxSide = 1800,
  grid: LumaGrid | undefined = lumaGrid(bitmap),
) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const unit = Math.max(1, Math.max(w, h) / 1200);
  drawAll(ctx, written(asset), (x, y) => [x * w, y * h], unit, busyOn(grid, scale, null));
  return toBlob(canvas, 'image/jpeg', 0.88);
}

/**
 * The image's luminance in cells of a few pixels, for settling crop edges on
 * quiet bands. Undefined when the canvas can't be read, and the crops then
 * keep their plain rectangles.
 */
export function lumaGrid(
  bitmap: ImageBitmap,
  across = 1200,
  minCell = 2,
): LumaGrid | undefined {
  try {
    const cell = Math.max(minCell, Math.ceil(Math.max(bitmap.width, bitmap.height) / across));
    const cols = Math.max(1, Math.ceil(bitmap.width / cell));
    const rows = Math.max(1, Math.ceil(bitmap.height / cell));
    const { ctx } = canvasOf(cols, rows);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, cols, rows);
    const { data } = ctx.getImageData(0, 0, cols, rows);
    const luma = new Uint8Array(cols * rows);
    for (let i = 0; i < luma.length; i++)
      luma[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
    return {
      width: bitmap.width,
      height: bitmap.height,
      cell,
      cols,
      rows,
      luma,
    };
  } catch {
    return undefined;
  }
}

/** The crop a note gets: `cropRect`, then its edges settled on quiet bands when the image could be sampled. */
export function settledCrop(bitmap: ImageBitmap, mark: Mark, grid?: LumaGrid): Rect {
  const start = cropRect(mark.shape, bitmap.width, bitmap.height);
  return grid ? settleCrop(start, grid) : start;
}

function drawCrop(
  bitmap: ImageBitmap,
  mark: Mark,
  number: number,
  maxSide: number,
  rect: Rect,
  grid: LumaGrid | undefined,
  color?: string,
  others: Shape[] = [],
) {
  const side = Math.max(rect.w, rect.h);
  const scale = Math.min(maxSide / side, Math.max(1, Math.min(2, 480 / side)));
  const w = Math.round(rect.w * scale);
  const h = Math.round(rect.h * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const unit = Math.max(1.4, Math.max(w, h) / 700);
  const px = (x: number, y: number): [number, number] => [
    (x * bitmap.width - rect.x) * scale,
    (y * bitmap.height - rect.y) * scale,
  ];
  const room = withOthers(busyOn(grid, scale, rect), others, px, unit, []);
  drawMark(ctx, mark, number, px, unit, color, room);
  return canvas;
}

/** The whole image with one note's marker, 768px at most, as JPEG: context for a suggestion. */
export async function contextForAi(
  bitmap: ImageBitmap,
  mark: Mark,
  number: number,
  grid: LumaGrid | undefined = lumaGrid(bitmap),
) {
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  drawMark(ctx, mark, number, (x, y) => [x * w, y * h], 1, AI_MARK_COLOR, busyOn(grid, scale, null));
  return toBlob(canvas, 'image/jpeg', 0.8);
}

/**
 * A close-up of one note, its marker drawn in, upscaled when the crop is
 * small and at most CROP_MAX_SIDE on its long side. `rect` is the crop
 * already settled (`settledCrop`) and `grid` the image's luma; both are
 * sampled here when not given. `others` are the picture's other notes, which
 * its number keeps off.
 */
export function cropImage(
  bitmap: ImageBitmap,
  mark: Mark,
  number: number,
  rect?: Rect,
  grid: LumaGrid | undefined = lumaGrid(bitmap),
  others: Shape[] = [],
) {
  return toBlob(
    drawCrop(
      bitmap,
      mark,
      number,
      CROP_MAX_SIDE,
      rect ?? settledCrop(bitmap, mark, grid),
      grid,
      undefined,
      others,
    ),
    'image/jpeg',
    0.92,
  );
}

/** The same close-up for a suggestion: 1024px at most, as JPEG. */
export function cropForAi(
  bitmap: ImageBitmap,
  mark: Mark,
  number: number,
  rect?: Rect,
  grid: LumaGrid | undefined = lumaGrid(bitmap),
) {
  return toBlob(
    drawCrop(bitmap, mark, number, 1024, rect ?? settledCrop(bitmap, mark, grid), grid, AI_MARK_COLOR),
    'image/jpeg',
    0.85,
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, r));
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A keycap badge with the image's number in the top-left of a tile. (After Scrawl's `draw_keyframe_badge`.) */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, k: number) {
  const numSize = 15.5 * k;
  const badgeH = 28 * k;
  const outerR = 8.5 * k;
  const inset = 2.5 * k;
  const capH = badgeH - inset * 2;
  const capR = Math.max(2, outerR - inset);
  ctx.font = `700 ${numSize}px ${MONO}`;
  const numW = ctx.measureText(label).width;
  const capW = Math.max(numW + 12 * k, capH);
  const badgeW = capW + inset * 2;
  const margin = 7 * k;
  const bx = x + margin;
  const by = y + margin;
  roundRect(ctx, bx - k, by - k, badgeW + 2 * k, badgeH + 2 * k, outerR + k, 'rgba(0,0,0,0.38)');
  roundRect(ctx, bx, by, badgeW, badgeH, outerR, 'rgba(255,255,255,0.3)');
  const border = Math.max(1, 1.2 * k);
  roundRect(
    ctx,
    bx + border,
    by + border,
    badgeW - border * 2,
    badgeH - border * 2,
    outerR - border,
    'rgba(14,15,18,0.94)',
  );
  roundRect(ctx, bx + inset, by + inset, capW, capH, capR, '#f8f9fc');
  ctx.fillStyle = '#0e0f12';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + inset + capW / 2, by + badgeH / 2 + 0.5 * k);
}

/**
 * The contact sheet, drawn one image at a time while the export walks the
 * batch: each image is scaled into its cell and its notes drawn on at that
 * size, so the numbers stay legible however small the cell (the 1800px marked
 * copies, shrunk, made them a few pixels high). Laid out up front from the
 * images' sizes; an image whose file is missing leaves its cell empty.
 */
function contactSheet(sizes: { width: number; height: number }[]) {
  const layout = layoutSheet(sizes);
  const { canvas, ctx } = canvasOf(layout.width, layout.height);
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, layout.width, layout.height);
  return {
    add(index: number, bitmap: ImageBitmap, asset: Asset, number: string, grid?: LumaGrid) {
      const cell = layout.cells.find((c) => c.index === index);
      if (!cell) return;
      // The cell has the image's aspect, give or take rounding; a very tall or wide image
      // (its aspect clamped by the planner) is fitted whole, with the sheet showing beside it.
      const s = Math.min(cell.w / bitmap.width, cell.h / bitmap.height);
      const dw = Math.max(1, Math.round(bitmap.width * s));
      const dh = Math.max(1, Math.round(bitmap.height * s));
      // Its own canvas, so a number disc looks for room inside this image, never in its neighbour.
      const tile = canvasOf(dw, dh);
      tile.ctx.imageSmoothingQuality = 'high';
      tile.ctx.drawImage(bitmap, 0, 0, dw, dh);
      const unit = Math.max(1, Math.max(dw, dh) / 1200);
      // The image's number badge sits in the tile's top-left corner: a disc there would hide under it.
      const k = layout.badgeScale;
      const badge = { w: 7 * k + 64 * k, h: 7 * k + 32 * k };
      const onImage = busyOn(grid, s, null);
      const busy: Busy = (x, y, r) =>
        x - r < badge.w && y - r < badge.h ? 1 : (onImage?.(x, y, r) ?? 0);
      drawAll(tile.ctx, written(asset), (x, y) => [x * dw, y * dh], unit, busy);
      const dx = cell.x + Math.round((cell.w - dw) / 2);
      const dy = cell.y + Math.round((cell.h - dh) / 2);
      ctx.drawImage(tile.canvas, dx, dy);
      drawBadge(ctx, dx, dy, number, layout.badgeScale);
    },
    blob: () => toBlob(canvas, 'image/jpeg', 0.86),
  };
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * The export: README.md, AGENTS.md, notes.json, the contact sheet, and
 * images, marked copies and crops for every image with notes. The text is
 * written last, so notes.json reports the crops as they were drawn.
 */
export async function buildExport(
  assets: Asset[],
  imageOf: (id: string) => Promise<Blob | undefined>,
  onProgress: (done: number, total: number) => void,
) {
  const now = new Date();
  const stamp = now.toISOString();
  const root = `pinch-${stamp.slice(0, 10)}/`;
  const list = exportable(assets);
  const encoder = new TextEncoder();
  const files: ZipEntry[] = [];
  const crops = new Map<string, Rect>();
  const sheet = contactSheet(list.map((a) => ({ width: a.width, height: a.height })));
  let sheetUsed = false;
  for (const [i, asset] of list.entries()) {
    onProgress(i, list.length);
    const blob = await imageOf(asset.id);
    if (!blob) continue;
    const names = assetFiles(asset, i, list.length);
    const bitmap = await bitmapOf(blob);
    const grid = lumaGrid(bitmap);
    files.push({ name: root + names.image, data: await bytes(blob) });
    const markedBlob = await markedImage(bitmap, asset, undefined, grid);
    sheet.add(i, bitmap, asset, names.number, grid);
    sheetUsed = true;
    files.push({ name: root + names.marked, data: await bytes(markedBlob) });
    for (const [j, mark] of written(asset).entries()) {
      const rect = settledCrop(bitmap, mark, grid);
      crops.set(`${asset.id}/${mark.id}`, rect);
      files.push({
        name: root + names.crop(j),
        data: await bytes(
          await cropImage(
            bitmap,
            mark,
            j + 1,
            rect,
            grid,
            written(asset)
              .filter((o) => o !== mark)
              .map((o) => o.shape),
          ),
        ),
      });
    }
    bitmap.close();
  }
  const cropOf: CropOf = (a, m) =>
    crops.get(`${a.id}/${m.id}`) ?? cropRect(m.shape, a.width, a.height);
  const entries: ZipEntry[] = [
    { name: `${root}README.md`, data: encoder.encode(readme(assets, stamp)) },
    { name: root + GUIDE_FILE, data: encoder.encode(agentGuide()) },
    {
      name: `${root}notes.json`,
      data: encoder.encode(`${JSON.stringify(manifest(assets, stamp, cropOf), null, 2)}\n`),
    },
  ];
  if (sheetUsed) entries.push({ name: root + SHEET_FILE, data: await bytes(await sheet.blob()) });
  entries.push(...files);
  onProgress(list.length, list.length);
  return {
    blob: new Blob(zip(entries, now) as BlobPart[], {
      type: 'application/zip',
    }),
    name: `${root.slice(0, -1)}.zip`,
  };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * The most pixels an image keeps. Safari's canvas gives up at about 16.7 megapixels, and every
 * draw (the marked copy, the crops, the AI's copy) goes through a canvas of the image's size.
 */
export const PIXEL_BUDGET = 16_000_000;
/** The longest side a canvas takes in every browser. */
const MAX_SIDE = 16_000;

/** The factor that brings an image inside the budget: 1 when it already is. */
export const fitScale = (width: number, height: number) =>
  Math.min(1, Math.sqrt(PIXEL_BUDGET / (width * height)), MAX_SIDE / Math.max(width, height));

/**
 * Screenshots inside the pixel budget are kept as they are; one over it (a tall full-page capture,
 * a 4K-and-more export) is scaled down once, by area rather than by its long side, so a tall
 * page keeps its width legible. `scaled` says when that happened, so the app can tell the user.
 */
export async function prepareImage(file: File) {
  const bitmap = await bitmapOf(file);
  const { width, height } = bitmap;
  const scale = fitScale(width, height);
  const scaled = scale < 1;
  if (!scaled && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    bitmap.close();
    return { blob: file as Blob, type: file.type, width, height, scaled };
  }
  // Floored, so the result never lands a few pixels over the budget.
  const { canvas, ctx } = canvasOf(Math.floor(width * scale), Math.floor(height * scale));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // A photo stays a JPEG (a PNG of it is ten times the size); anything else is kept lossless.
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return {
    blob: await toBlob(canvas, type, type === 'image/jpeg' ? 0.92 : undefined),
    type,
    width: canvas.width,
    height: canvas.height,
    scaled,
  };
}
