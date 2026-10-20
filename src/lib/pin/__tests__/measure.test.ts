import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guessScale, measureSpacing, spacingText } from '../measure';
import {
  type Asset,
  currentSpacing,
  type LumaGrid,
  type Mark,
  manifest,
  readme,
  type Shape,
  shapeKey,
} from '../model';
import { imageSummary } from '../summary';

type Box = { x: number; y: number; w: number; h: number; luma?: number };

/** A 400×300 page sampled per pixel: `background` everywhere, with dark boxes drawn on it. */
const page = (boxes: Box[], background = 250): LumaGrid => {
  const cols = 400;
  const rows = 300;
  const luma = new Uint8Array(cols * rows).fill(background);
  for (const b of boxes)
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) luma[y * cols + x] = b.luma ?? 30;
  return { width: cols, height: rows, cell: 1, cols, rows, luma };
};

// The element measured, and one neighbour above (30px off), below (20px) and left (30px).
const element = { x: 100, y: 100, w: 100, h: 30 };
const neighbours = [
  { x: 100, y: 40, w: 100, h: 30 },
  { x: 100, y: 150, w: 100, h: 20 },
  { x: 40, y: 100, w: 30, h: 30 },
];

describe('measureSpacing', () => {
  it('measures from the line of text under a dot to its neighbours', () => {
    // Ten letters, 8px wide every 10px, at y 100–112; neighbours 30px above, 20px below, 30px left.
    const letters = Array.from({ length: 10 }, (_, i) => ({ x: 100 + i * 10, y: 100, w: 8, h: 12 }));
    const around = [
      { x: 100, y: 40, w: 100, h: 30 },
      { x: 100, y: 132, w: 100, h: 18 },
      { x: 40, y: 100, w: 30, h: 12 },
    ];
    const m = measureSpacing(page([...letters, ...around]), { kind: 'dot', x: 0.375, y: 106 / 300 });
    assert.ok(m.ok);
    assert.deepEqual(m.element, { x: 100, y: 100, w: 98, h: 12 });
    // Nothing on the right within half the width.
    assert.deepEqual(m.gaps, { above: 30, below: 20, left: 30 });
    assert.equal(m.precision, 1);
  });

  it('fits an area to the element inside it before measuring', () => {
    const loose = { kind: 'area' as const, x: 90 / 400, y: 95 / 300, w: 120 / 400, h: 40 / 300 };
    const m = measureSpacing(page([element, ...neighbours]), loose);
    assert.ok(m.ok);
    assert.deepEqual(m.element, element);
    assert.deepEqual(m.gaps, { above: 30, below: 20, left: 30 });
  });

  it('measures a filled button as one element, its label inside it', () => {
    const button = { x: 100, y: 100, w: 100, h: 30, luma: 120 };
    const label = { x: 130, y: 110, w: 40, h: 10, luma: 250 };
    const loose = { kind: 'area' as const, x: 95 / 400, y: 95 / 300, w: 110 / 400, h: 40 / 300 };
    const m = measureSpacing(page([button, label, neighbours[0]]), loose);
    assert.ok(m.ok);
    assert.deepEqual(m.element, element);
    assert.equal(m.gaps.above, 30);
  });

  it('joins the letters of a line into one element', () => {
    const letters = [0, 1, 2, 3].map((i) => ({ x: 100 + i * 10, y: 100, w: 8, h: 12 }));
    const m = measureSpacing(page(letters), { kind: 'dot', x: 101 / 400, y: 105 / 300 });
    assert.ok(m.ok);
    assert.deepEqual(m.element, { x: 100, y: 100, w: 38, h: 12 });
  });

  it('measures a big figure whole, not just the digits after a comma', () => {
    // Solid digits 24px wide, 2px apart, with a 12px gap where a comma would sit: "$12,345".
    const digit = (x: number) => ({ x, y: 100, w: 24, h: 40 });
    const figure = [100, 126, 152, 188, 214].map(digit);
    const m = measureSpacing(page(figure), { kind: 'dot', x: 200 / 400, y: 120 / 300 });
    assert.ok(m.ok);
    assert.deepEqual(m.element, { x: 100, y: 100, w: 138, h: 40 });
  });

  it('measures one row of a dense list against the page, not against the rows', () => {
    // Five rows 16px tall, 16px apart except 24px after the third: rows cover much of the window.
    const tops = [40, 72, 104, 144, 176];
    const rows = tops.map((y) => ({ x: 100, y, w: 100, h: 16, luma: 160 }));
    const m = measureSpacing(page(rows), { kind: 'dot', x: 150 / 400, y: 112 / 300 });
    assert.ok(m.ok);
    assert.deepEqual(m.element, { x: 100, y: 104, w: 100, h: 16 });
    assert.deepEqual(m.gaps, { above: 16, below: 24 });
  });

  it('finds the faint edge of a white card on a near-white page', () => {
    const card = { x: 50, y: 50, w: 300, h: 200, luma: 255 };
    const text = { x: 74, y: 74, w: 120, h: 14 };
    const m = measureSpacing(page([card, text], 245), { kind: 'dot', x: 100 / 400, y: 80 / 300 });
    assert.ok(m.ok);
    assert.equal(m.gaps.above, 24);
    assert.equal(m.gaps.left, 24);
  });

  it('says there is nothing to measure on empty space, a photo or an arrow', () => {
    assert.deepEqual(measureSpacing(page([element]), { kind: 'dot', x: 0.9, y: 0.9 }), {
      ok: false,
      reason: 'empty',
    });
    const noise = page([]);
    for (let i = 0; i < noise.luma.length; i++)
      (noise.luma as Uint8Array)[i] = (i * 2654435761) % 251;
    assert.deepEqual(measureSpacing(noise, { kind: 'dot', x: 0.5, y: 0.5 }), {
      ok: false,
      reason: 'busy',
    });
    assert.deepEqual(
      measureSpacing(page([element]), { kind: 'arrow', x: 0.1, y: 0.1, x2: 0.5, y2: 0.5 }),
      { ok: false, reason: 'arrow' },
    );
  });
});

describe('guessScale', () => {
  it('guesses phones at 3× or 2×, wide desktop captures at 2×, the rest at 1×', () => {
    assert.equal(guessScale(1179, 2556), 3);
    assert.equal(guessScale(750, 1334), 2);
    assert.equal(guessScale(2880, 1800), 2);
    assert.equal(guessScale(1440, 900), 1);
    assert.equal(guessScale(1440, 4000), 1);
  });
});

describe('spacingText', () => {
  it('names each gap, the missing sides and the CSS pixels at the scale', () => {
    const s = { gaps: { above: 32, below: 12, left: 24 }, precision: 1 };
    assert.equal(
      spacingText(s, 2, true),
      '32 px above, 12 px below and 24 px to the left; nothing within reach to the right (screenshot pixels; 16, 6 and 12 CSS px at 2×, guessed from the image size)',
    );
    assert.match(spacingText({ gaps: { above: 8 }, precision: 2 }, 1, false), /±2 px, the same in CSS px at 1×, set by the author\)/);
    assert.equal(spacingText({ gaps: {}, precision: 1 }, 1, true), 'nothing within reach on any side');
  });
});

describe('spacing in the export', () => {
  const dot = { kind: 'dot' as const, x: 0.5, y: 0.5 };
  const withSpacing = (shape: Shape = dot): Mark => ({
    id: 'm1',
    shape: dot,
    label: '',
    good: '',
    bad: 'Too tight under the title.',
    origin: 'user',
    spacing: {
      element: { x: 700, y: 480, w: 200, h: 40 },
      gaps: { above: 32, below: 12 },
      precision: 1,
      shape: shapeKey(shape),
    },
  });
  const asset = (m: Mark, over: Partial<Asset> = {}): Asset => ({
    id: 'a1',
    name: 'Settings.png',
    type: 'image/png',
    width: 2880,
    height: 1800,
    note: '',
    marks: [m],
    ...over,
  });

  it('writes the gaps and the element into the README, notes.json and the copied text', () => {
    const a = asset(withSpacing());
    const text = readme([a], '2026-10-20T10:00:00Z');
    assert.match(
      text,
      /What doesn't: Too tight under the title\.\nSpacing: 32 px above and 12 px below; nothing within reach to the left and to the right \(screenshot pixels; 16 and 6 CSS px at 2×, guessed from the image size\)\. Measured from the element at pixels 700,480, 200×40\./,
    );
    assert.match(text, /^- Spacing, on a note that has it:/m);
    // Without a measurement, no word about Spacing.
    assert.doesNotMatch(readme([asset({ ...withSpacing(), spacing: undefined })], 'x'), /Spacing/);
    const note = manifest([a], 'x').assets[0].notes[0] as { spacing?: unknown };
    assert.deepEqual(note.spacing, {
      element: { x: 700, y: 480, w: 200, h: 40 },
      gaps: { above: 32, below: 12 },
      cssGaps: { above: 16, below: 6 },
      scale: 2,
      scaleGuessed: true,
      precision: 1,
    });
    assert.match(imageSummary(a, 0, 1), /· spacing: 32 px above and 12 px below/);
    // The author's scale wins over the guess.
    assert.match(readme([asset(withSpacing(), { scale: 1 })], 'x'), /the same in CSS px at 1×, set by the author/);
  });

  it('drops a measurement taken before the note moved', () => {
    const moved = withSpacing({ kind: 'dot', x: 0.2, y: 0.2 });
    assert.equal(currentSpacing(moved), undefined);
    assert.doesNotMatch(readme([asset(moved)], 'x'), /^Spacing:/m);
    assert.equal('spacing' in manifest([asset(moved)], 'x').assets[0].notes[0], false);
  });
});
