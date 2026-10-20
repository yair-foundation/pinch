import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Asset,
  currentRhythm,
  type LumaGrid,
  type Mark,
  manifest,
  readme,
  type Shape,
  shapeKey,
} from '../model';
import { checkRhythm, rhythmSuggestion, rhythmText } from '../rhythm';
import { imageSummary } from '../summary';

type Box = { x: number; y: number; w: number; h: number; luma?: number };

/** A 400×300 page sampled per pixel, light, with dark boxes drawn on it. */
const page = (boxes: Box[], background = 250): LumaGrid => {
  const cols = 400;
  const rows = 300;
  const luma = new Uint8Array(cols * rows).fill(background);
  for (const b of boxes)
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) luma[y * cols + x] = b.luma ?? 30;
  return { width: cols, height: rows, cell: 1, cols, rows, luma };
};
/** An area from pixel corners on the 400×300 page. */
const area = (x0: number, y0: number, x1: number, y1: number) => ({
  kind: 'area' as const,
  x: x0 / 400,
  y: y0 / 300,
  w: (x1 - x0) / 400,
  h: (y1 - y0) / 300,
});
const rowsAt = (tops: number[], h = 16) => tops.map((y) => ({ x: 100, y, w: 100, h, luma: 160 }));

describe('checkRhythm', () => {
  it('finds the rows of a list and the odd gap', () => {
    const r = checkRhythm(page(rowsAt([40, 72, 104, 144, 176])), area(90, 30, 210, 200));
    assert.ok(r.ok);
    assert.equal(r.axis, 'column');
    assert.equal(r.items.length, 5);
    assert.deepEqual(r.items[0], { x: 100, y: 40, w: 100, h: 16 });
    assert.deepEqual(r.gaps, [16, 16, 24, 16]);
    assert.equal(r.typical, 16);
    assert.deepEqual(r.odd, [2]);
  });

  it('calls an even list even', () => {
    const r = checkRhythm(page(rowsAt([40, 72, 104, 136])), area(90, 30, 210, 160));
    assert.ok(r.ok);
    assert.deepEqual(r.gaps, [16, 16, 16]);
    assert.deepEqual(r.odd, []);
  });

  it('treats a title and a subtitle as one item, not as two gaps', () => {
    // Items 22px tall (a 10px title, 4px, an 8px subtitle), 20px apart.
    const items = [40, 82, 124, 166].flatMap((y) => [
      { x: 100, y, w: 120, h: 10 },
      { x: 100, y: y + 14, w: 80, h: 8, luma: 120 },
    ]);
    const r = checkRhythm(page(items), area(90, 30, 230, 200));
    assert.ok(r.ok);
    assert.equal(r.items.length, 4);
    assert.deepEqual(r.items[0], { x: 100, y: 40, w: 120, h: 22 });
    assert.deepEqual(r.gaps, [20, 20, 20]);
    assert.deepEqual(r.odd, []);
  });

  it('reads cards side by side as a row', () => {
    const cards = [40, 116, 192, 268].map((x) => ({ x, y: 100, w: 60, h: 80, luma: 235 }));
    const r = checkRhythm(page(cards), area(30, 90, 340, 190));
    assert.ok(r.ok);
    assert.equal(r.axis, 'row');
    assert.deepEqual(r.gaps, [16, 16, 16]);
  });

  it('keeps solid items set close together apart: the bars of a chart', () => {
    // Three bars 2px apart, as close as letters, but solid.
    const bars = [100, 142, 184].map((x) => ({ x, y: 100, w: 40, h: 120, luma: 200 }));
    const r = checkRhythm(page(bars), area(90, 90, 235, 230));
    assert.ok(r.ok);
    assert.equal(r.axis, 'row');
    assert.deepEqual(r.gaps, [2, 2]);
  });

  it('reads a list of rows as rows, not as its tile, bar and amount columns', () => {
    // Three rows, each a tile, a bar and an amount: in columns too, but the rows are alike.
    const parts = [60, 100, 140].flatMap((y) => [
      { x: 100, y, w: 30, h: 30, luma: 200 },
      { x: 150, y: y + 10, w: 120, h: 10, luma: 220 },
      { x: 300, y: y + 8, w: 20, h: 14 },
    ]);
    const r = checkRhythm(page(parts), area(90, 50, 330, 180));
    assert.ok(r.ok);
    assert.equal(r.axis, 'column');
    assert.equal(r.items.length, 3);
    assert.deepEqual(r.gaps, [10, 10]);
  });

  it('reports two different gaps as uneven, without picking one as odd', () => {
    const r = checkRhythm(page(rowsAt([40, 72, 112])), area(90, 30, 210, 140));
    assert.ok(r.ok);
    assert.deepEqual(r.gaps, [16, 24]);
    assert.deepEqual(r.odd, [0, 1]);
  });

  it('says when there are too few items, nothing, a busy background or not an area', () => {
    assert.deepEqual(checkRhythm(page(rowsAt([40, 72])), area(90, 30, 210, 100)), {
      ok: false,
      reason: 'few',
    });
    assert.deepEqual(checkRhythm(page([]), area(90, 30, 210, 100)), { ok: false, reason: 'empty' });
    const noise = page([]);
    for (let i = 0; i < noise.luma.length; i++)
      (noise.luma as Uint8Array)[i] = (i * 2654435761) % 251;
    assert.deepEqual(checkRhythm(noise, area(90, 30, 210, 100)), { ok: false, reason: 'busy' });
    assert.deepEqual(checkRhythm(page([]), { kind: 'dot', x: 0.5, y: 0.5 }), {
      ok: false,
      reason: 'shape',
    });
  });
});

describe('rhythm text', () => {
  const uneven = {
    axis: 'column' as const,
    items: Array.from({ length: 5 }, () => ({ x: 0, y: 0, w: 1, h: 1 })),
    gaps: [32, 32, 48, 32],
    typical: 32,
    odd: [2],
    precision: 2,
  };
  it('names the gaps, the scale and the odd one for the export', () => {
    assert.equal(
      rhythmText(uneven, 2, true),
      '5 items in a column; gaps 32, 32, 48 and 32 px (screenshot pixels, ±2 px; 16, 16, 24 and 16 CSS px at 2×, guessed from the image size). The gap after item 3 differs: 48 px where the others are about 32.',
    );
    assert.match(rhythmText({ ...uneven, odd: [] }, 2, false), /Even: every gap is within 12% or 2 px of 32 px\.$/);
  });
  it('suggests a sentence for the note in CSS pixels', () => {
    assert.deepEqual(rhythmSuggestion(uneven, 2), {
      field: 'bad',
      text: 'Uneven spacing between the rows: the gap after item 3 is 24 CSS px where the others are 16.',
    });
    assert.deepEqual(rhythmSuggestion({ ...uneven, odd: [] }, 1), {
      field: 'good',
      text: 'Even rhythm: every gap between the rows is 32 px.',
    });
  });
});

describe('rhythm in the export', () => {
  const box = { kind: 'area' as const, x: 0.1, y: 0.1, w: 0.4, h: 0.5 };
  const withRhythm = (shape: Shape = box): Mark => ({
    id: 'm1',
    shape: box,
    label: '',
    good: '',
    bad: 'The list feels uneven.',
    origin: 'user',
    rhythm: {
      axis: 'column',
      items: [0, 1, 2, 3].map((i) => ({ x: 300, y: 200 + i * 80, w: 600, h: 48 })),
      gaps: [32, 48, 32],
      typical: 32,
      odd: [1],
      precision: 2,
      shape: shapeKey(shape),
    },
  });
  const asset = (m: Mark): Asset => ({
    id: 'a1',
    name: 'List.png',
    type: 'image/png',
    width: 2880,
    height: 1800,
    note: '',
    marks: [m],
  });

  it('writes the check into the README, notes.json and the copied text', () => {
    const text = readme([asset(withRhythm())], 'x');
    assert.match(
      text,
      /What doesn't: The list feels uneven\.\nRhythm: 4 items in a column; gaps 32, 48 and 32 px \(screenshot pixels, ±2 px; 16, 24 and 16 CSS px at 2×, guessed from the image size\)\. The gap after item 2 differs: 48 px where the others are about 32\./,
    );
    assert.match(text, /^- Rhythm, on an area note that has it:/m);
    const note = manifest([asset(withRhythm())], 'x').assets[0].notes[0] as { rhythm?: unknown };
    assert.deepEqual(note.rhythm, {
      axis: 'column',
      items: withRhythm().rhythm?.items,
      gaps: [32, 48, 32],
      cssGaps: [16, 24, 16],
      typical: 32,
      odd: [1],
      scale: 2,
      scaleGuessed: true,
      precision: 2,
    });
    assert.match(imageSummary(asset(withRhythm()), 0, 1), /· rhythm: 4 items in a column/);
  });

  it('leaves out a check made before the note moved, and its rule', () => {
    const moved = withRhythm({ ...box, x: 0.2 });
    assert.equal(currentRhythm(moved), undefined);
    assert.doesNotMatch(readme([asset(moved)], 'x'), /Rhythm/);
  });
});
