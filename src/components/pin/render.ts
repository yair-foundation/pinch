import {
  agentGuide,
  type Asset,
  assetFiles,
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
 * The numbered disc beside a ring, on a short leader. It sits off the point
 * in the first of `prefer` directions (unit vectors) that has room on the
 * canvas, so the number never covers what the ring marks, and is clamped
 * inside the canvas either way.
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
) {
  const edge = r + 3 * unit + 1;
  const { width: W, height: H } = ctx.canvas;
  const off = 1.7 * r;
  const fits = ([ux, uy]: [number, number]) => {
    const x = x0 + ux * off;
    const y = y0 + uy * off;
    return x >= edge && x <= W - edge && y >= edge && y <= H - edge;
  };
  const [dx, dy] = prefer.find(fits) ?? prefer[0];
  const cx = clamp(x0 + dx * off, edge, Math.max(edge, W - edge));
  const cy = clamp(y0 + dy * off, edge, Math.max(edge, H - edge));
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
}

/**
 * One numbered marker. `px` maps image fractions to canvas pixels; `unit`
 * sets the marker size. A dot is a small ring at the point, with the number
 * on a disc up and left of it on a short leader, so the number never covers
 * what the dot marks; near an edge the disc flips to the side with room. An
 * area is a box with the number just outside its top-left corner when there
 * is room, else nudged inside it. An arrow is a line from its tail to a
 * filled head, a small ring at the tail and the disc behind the tail, away
 * from the line. (After Scrawl's `draw_mark_numbers`.)
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: Mark,
  number: number,
  px: (x: number, y: number) => [number, number],
  unit: number,
  color = VERDICT_COLOR[verdictOf(mark)],
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
    const out = 0.9 * r;
    const room = x0 - out - edge >= 0 && y0 - out - edge >= 0;
    const cx = room ? x0 - out : Math.max(edge, x0);
    const cy = room ? y0 - out : Math.max(edge, y0);
    drawDisc(ctx, cx, cy, r, unit, number, color);
    return;
  }
  if (mark.shape.kind === 'arrow') {
    const [x1, y1] = px(mark.shape.x2, mark.shape.y2);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    // The head: a filled triangle, no longer than a third of the arrow.
    const head = Math.min(16 * unit, len / 3);
    const half = head * 0.42;
    const bx = x1 - ux * head;
    const by = y1 - uy * head;
    const ring = 4 * unit;
    ctx.beginPath();
    ctx.moveTo(x0 + ux * (ring + 1.5 * unit), y0 + uy * (ring + 1.5 * unit));
    ctx.lineTo(bx + ux * head * 0.3, by + uy * head * 0.3);
    strokeHalo(ctx, color, 3 * unit);
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
    // The disc behind the tail, off the line; beside it when the tail is near an edge.
    drawLeaderDisc(ctx, x0, y0, ring, r, unit, number, color, [
      [-ux, -uy],
      [uy, -ux],
      [-uy, ux],
      [ux, uy],
    ]);
    return;
  }
  const ring = 5 * unit;
  drawRing(ctx, x0, y0, ring, unit, color);
  // The disc, up and left, flipped to the side with room near an edge.
  const { width: W, height: H } = ctx.canvas;
  const off = 1.7 * r;
  const dx = x0 - off - edge >= 0 || x0 + off + edge > W ? -1 : 1;
  const dy = y0 - off - edge >= 0 || y0 + off + edge > H ? -1 : 1;
  drawLeaderDisc(ctx, x0, y0, ring, r, unit, number, color, [[dx, dy]]);
}

const written = (a: Asset) => a.marks.filter((m) => verdictOf(m) !== 'empty');

/** The whole image with every note drawn on it, at most `maxSide` pixels on the long side. */
export async function markedImage(bitmap: ImageBitmap, asset: Asset, maxSide = 1800) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const unit = Math.max(1, Math.max(w, h) / 1200);
  for (const [i, m] of written(asset).entries())
    drawMark(ctx, m, i + 1, (x, y) => [x * w, y * h], unit);
  return toBlob(canvas, 'image/jpeg', 0.88);
}

/**
 * The image's luminance in cells of a few pixels, for settling crop edges on
 * quiet bands. Undefined when the canvas can't be read, and the crops then
 * keep their plain rectangles.
 */
export function lumaGrid(bitmap: ImageBitmap): LumaGrid | undefined {
  try {
    const cell = Math.max(2, Math.ceil(Math.max(bitmap.width, bitmap.height) / 1200));
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
  color?: string,
) {
  const side = Math.max(rect.w, rect.h);
  const scale = Math.min(maxSide / side, Math.max(1, Math.min(3, 480 / side)));
  const w = Math.round(rect.w * scale);
  const h = Math.round(rect.h * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  const unit = Math.max(1.4, Math.max(w, h) / 420);
  const px = (x: number, y: number): [number, number] => [
    (x * bitmap.width - rect.x) * scale,
    (y * bitmap.height - rect.y) * scale,
  ];
  drawMark(ctx, mark, number, px, unit, color);
  return canvas;
}

/** The whole image with one note's marker, 768px at most, as JPEG: context for a suggestion. */
export async function contextForAi(bitmap: ImageBitmap, mark: Mark, number: number) {
  const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  drawMark(ctx, mark, number, (x, y) => [x * w, y * h], 1, AI_MARK_COLOR);
  return toBlob(canvas, 'image/jpeg', 0.8);
}

/** A close-up of one note, its marker drawn in, upscaled when the crop is small. */
export const cropImage = (bitmap: ImageBitmap, mark: Mark, number: number, rect?: Rect) =>
  toBlob(
    drawCrop(
      bitmap,
      mark,
      number,
      Number.POSITIVE_INFINITY,
      rect ?? settledCrop(bitmap, mark, lumaGrid(bitmap)),
    ),
    'image/png',
  );

/** The same close-up for a suggestion: 1024px at most, as JPEG. */
export const cropForAi = (bitmap: ImageBitmap, mark: Mark, number: number, rect?: Rect) =>
  toBlob(
    drawCrop(
      bitmap,
      mark,
      number,
      1024,
      rect ?? settledCrop(bitmap, mark, lumaGrid(bitmap)),
      AI_MARK_COLOR,
    ),
    'image/jpeg',
    0.85,
  );

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

/** Every marked copy on one dark sheet, in batch order, each with its number. */
export async function contactSheet(marked: { blob: Blob; number: string }[]) {
  const bitmaps = await Promise.all(marked.map((m) => bitmapOf(m.blob)));
  try {
    const layout = layoutSheet(bitmaps.map((b) => ({ width: b.width, height: b.height })));
    const { canvas, ctx } = canvasOf(layout.width, layout.height);
    ctx.fillStyle = SHEET_BG;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.imageSmoothingQuality = 'high';
    for (const cell of layout.cells) {
      const b = bitmaps[cell.index];
      // The cell has the image's aspect, give or take rounding; a very tall or wide image
      // (its aspect clamped by the planner) is fitted whole, with the sheet showing beside it.
      const s = Math.min(cell.w / b.width, cell.h / b.height);
      const dw = Math.round(b.width * s);
      const dh = Math.round(b.height * s);
      const dx = cell.x + Math.round((cell.w - dw) / 2);
      const dy = cell.y + Math.round((cell.h - dh) / 2);
      ctx.drawImage(b, 0, 0, b.width, b.height, dx, dy, dw, dh);
      drawBadge(ctx, dx, dy, marked[cell.index].number, layout.badgeScale);
    }
    return toBlob(canvas, 'image/jpeg', 0.86);
  } finally {
    for (const b of bitmaps) b.close();
  }
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
  const marked: { blob: Blob; number: string }[] = [];
  for (const [i, asset] of list.entries()) {
    onProgress(i, list.length);
    const blob = await imageOf(asset.id);
    if (!blob) continue;
    const names = assetFiles(asset, i, list.length);
    const bitmap = await bitmapOf(blob);
    const grid = lumaGrid(bitmap);
    files.push({ name: root + names.image, data: await bytes(blob) });
    const markedBlob = await markedImage(bitmap, asset);
    marked.push({ blob: markedBlob, number: names.number });
    files.push({ name: root + names.marked, data: await bytes(markedBlob) });
    for (const [j, mark] of written(asset).entries()) {
      const rect = settledCrop(bitmap, mark, grid);
      crops.set(`${asset.id}/${mark.id}`, rect);
      files.push({
        name: root + names.crop(j),
        data: await bytes(await cropImage(bitmap, mark, j + 1, rect)),
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
  if (marked.length)
    entries.push({
      name: root + SHEET_FILE,
      data: await bytes(await contactSheet(marked)),
    });
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

/** Large screenshots are kept up to 4096px on the long side; anything bigger is scaled down once. */
export async function prepareImage(file: File) {
  const bitmap = await bitmapOf(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, 4096 / Math.max(width, height));
  if (scale === 1 && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    bitmap.close();
    return { blob: file as Blob, type: file.type, width, height };
  }
  const { canvas, ctx } = canvasOf(Math.round(width * scale), Math.round(height * scale));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    blob: await toBlob(canvas, 'image/png'),
    type: 'image/png',
    width: canvas.width,
    height: canvas.height,
  };
}

/** The copy the AI sees: 1568px on the long side at most, as JPEG. */
export async function imageForAi(blob: Blob) {
  const bitmap = await bitmapOf(blob);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const { canvas, ctx } = canvasOf(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    blob: await toBlob(canvas, 'image/jpeg', 0.9),
    width: canvas.width,
    height: canvas.height,
  };
}
