import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32 as nodeCrc } from 'node:zlib';

import { pinRefusal, VISITOR_SHARE } from '../ai-budget';
import {
  agentGuide,
  type Asset,
  areaFrom,
  arrowFrom,
  assetFiles,
  busyShare,
  centreOf,
  cropRect,
  currentSuggestion,
  exportable,
  isTinyArea,
  isTinyArrow,
  type LumaGrid,
  type Mark,
  manifest,
  moveArrow,
  needsSuggestion,
  readme,
  settleCrop,
  shapeKey,
  shapePixels,
  slug,
  suggestionUse,
  verdictOf,
} from '../model';
import { layoutSheet, planSheetRows, SHEET_MAX_EDGE, SHEET_MAX_PIXELS } from '../sheet';
import {
  addToDay,
  changedEntries,
  emptyLogDay,
  expiredDays,
  fingerprint,
  incomingBatchSchema,
  LOG_CAPS,
  logBatchSchema,
  logEntries,
  logEntrySchema,
} from '../notes-log';
import { aboutTheMarker, cleanSuggestion, suggestPrompt, suggestSystem } from '../suggest';
import { clientIp } from '../visitor';
import { crc32, zip } from '../zip';

const mark = (over: Partial<Mark> = {}): Mark => ({
  id: 'm1',
  shape: { kind: 'dot', x: 0.5, y: 0.5 },
  label: '',
  good: '',
  bad: '',
  origin: 'user',
  ...over,
});

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  name: 'Pricing page (v2).png',
  type: 'image/png',
  width: 1600,
  height: 1000,
  note: '',
  marks: [],
  ...over,
});

describe('marks', () => {
  it('reads what a note says', () => {
    assert.equal(verdictOf(mark({ good: 'Clear' })), 'good');
    assert.equal(verdictOf(mark({ bad: 'Busy' })), 'bad');
    assert.equal(verdictOf(mark({ good: 'Clear', bad: 'Busy' })), 'both');
    assert.equal(verdictOf(mark({ good: '  ' })), 'empty');
  });

  it('makes an area from two corners in any order, inside the image', () => {
    const a = areaFrom(0.6, 0.8, 0.2, -0.1);
    assert.deepEqual([a.x, a.y, a.h], [0.2, 0, 0.8]);
    assert.ok(Math.abs(a.w - 0.4) < 1e-9);
    assert.ok(isTinyArea(areaFrom(0.5, 0.5, 0.505, 0.6)));
  });
});

describe('cropRect', () => {
  it('crops a square around a dot and keeps it inside the image', () => {
    assert.deepEqual(cropRect({ kind: 'dot', x: 0.5, y: 0.5 }, 1600, 1000), {
      x: 680,
      y: 380,
      w: 240,
      h: 240,
    });
    assert.deepEqual(cropRect({ kind: 'dot', x: 0.99, y: 0.01 }, 1600, 1000), {
      x: 1360,
      y: 0,
      w: 240,
      h: 240,
    });
  });

  it('crops an area with a margin, never beyond the image', () => {
    const r = cropRect({ kind: 'area', x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, 1600, 1000);
    assert.deepEqual(r, { x: 96, y: 36, w: 928, h: 328 });
    const full = cropRect({ kind: 'area', x: 0, y: 0, w: 1, h: 1 }, 1600, 1000);
    assert.deepEqual(full, { x: 0, y: 0, w: 1600, h: 1000 });
  });

  it('crops an arrow around both ends with a wide margin, and at least 200px', () => {
    // 1600 × 1000: the arrow spans x 192–1280 (1088px), y 400–410.
    const r = cropRect({ kind: 'arrow', x: 0.12, y: 0.4, x2: 0.8, y2: 0.41 }, 1600, 1000);
    const pad = Math.round(1088 * 0.2);
    // 20% of the long side on every edge; the left edge would start before the image, so it rests at 0.
    assert.deepEqual(r, { x: 0, y: 405 - pad - 5, w: 1088 + pad * 2, h: 10 + pad * 2 });
    assert.ok(r.x <= 192 && r.x + r.w >= 1280, 'both ends inside');
    // A short arrow in a corner: the floor size, kept inside the image.
    const short = cropRect({ kind: 'arrow', x: 0.98, y: 0.02, x2: 0.95, y2: 0.05 }, 1600, 1000);
    assert.deepEqual(short, { x: 1400, y: 0, w: 200, h: 200 });
  });
});

describe('arrows', () => {
  it('keeps both ends inside the image and knows a slip from an arrow', () => {
    assert.deepEqual(arrowFrom(-0.1, 0.4, 1.2, 0.41), {
      kind: 'arrow',
      x: 0,
      y: 0.4,
      x2: 1,
      y2: 0.41,
    });
    assert.ok(isTinyArrow(arrowFrom(0.5, 0.5, 0.51, 0.51)));
    assert.equal(isTinyArrow(arrowFrom(0.5, 0.5, 0.53, 0.5)), false);
  });

  it('moves as a whole without changing its length', () => {
    const a = arrowFrom(0.2, 0.4, 0.6, 0.5);
    const moved = moveArrow(a, 0.1, -0.1);
    for (const [got, want] of [[moved.x, 0.3], [moved.y, 0.3], [moved.x2, 0.7], [moved.y2, 0.4]])
      assert.ok(Math.abs(got - want) < 1e-9, `${got} ≈ ${want}`);
    // Pushed past the right edge, it stops with its head on the edge.
    const stopped = moveArrow(a, 0.9, 0);
    assert.ok(Math.abs(stopped.x2 - 1) < 1e-9 && Math.abs(stopped.x - 0.6) < 1e-9);
  });

  it('has its own key, centre and pixels', () => {
    const a = arrowFrom(0.12, 0.4, 0.8, 0.41);
    assert.equal(shapeKey(a), 'arrow:0.120,0.400,0.800,0.410');
    assert.notEqual(shapeKey(a), shapeKey({ kind: 'area', x: 0.12, y: 0.4, w: 0.8, h: 0.41 }));
    assert.deepEqual(centreOf(a), { x: 0.46, y: 0.405 });
    assert.deepEqual(shapePixels(a, 1600, 1000), { x: 192, y: 400, x2: 1280, y2: 410 });
  });

  it('is described tail to head in the README, notes.json and the saved-note schema', () => {
    const a = asset({
      id: 'asset01',
      marks: [
        mark({
          id: 'mark01',
          bad: 'Move the total next to the CTA.',
          shape: arrowFrom(0.12, 0.4, 0.8, 0.41),
        }),
      ],
    });
    const text = readme([a], '2026-10-19T10:00:00Z');
    assert.match(
      text,
      /Where: arrow from x 12\.0%, y 40\.0% to x 80\.0%, y 41\.0% \(pixels 192,400 to 1280,410\)/,
    );
    assert.match(text, /An arrow points from its tail \(where its number sits\) to its head/);
    assert.match(text, /an arrow from its tail to its head, each with its number on a disc beside it/);
    // The spot is the ring, box or arrow ends, never the number, and the text coordinates win.
    assert.match(text, /never the numbered disc/);
    assert.match(text, /trust the numbers/);
    assert.match(agentGuide(), /dots, areas and arrows/);
    const note = manifest([a], 'x').assets[0].notes[0];
    assert.deepEqual(note.shape, { kind: 'arrow', x: 0.12, y: 0.4, x2: 0.8, y2: 0.41 });
    assert.deepEqual(note.pixels, { x: 192, y: 400, x2: 1280, y2: 410 });
    const [entry] = logEntries([a]);
    assert.equal(entry.shape, 'arrow');
    assert.ok(logEntrySchema.safeParse(entry).success);
    const arrowPrompt = suggestPrompt('', undefined, 'arrow');
    assert.match(arrowPrompt, /at its tail, where the number sits/);
    assert.doesNotMatch(arrowPrompt, /marker/i);
    assert.doesNotMatch(suggestPrompt('', undefined, 'dot'), /tail/);
  });
});

describe('busyShare', () => {
  /** A white 100×100 image sampled per pixel with a checkerboard in one box. */
  const grid = (box: { x: number; y: number; w: number; h: number }): LumaGrid => {
    const cols = 100;
    const rows = 100;
    const luma = new Uint8Array(cols * rows).fill(255);
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++) luma[y * cols + x] = (x + y) % 2 ? 20 : 235;
    return { width: cols, height: rows, cell: 1, cols, rows, luma };
  };
  it('tells a disc on text from one on white', () => {
    const g = grid({ x: 40, y: 40, w: 20, h: 20 });
    assert.equal(busyShare(g, { x: 0, y: 0, w: 20, h: 20 }), 0);
    assert.ok(busyShare(g, { x: 42, y: 42, w: 10, h: 10 }) > 0.9);
    // Half on, half off.
    const half = busyShare(g, { x: 30, y: 42, w: 20, h: 10 });
    assert.ok(half > 0.3 && half < 0.7, `${half}`);
    // Outside the image: nothing to cover.
    assert.equal(busyShare(g, { x: -50, y: -50, w: 20, h: 20 }), 0);
  });
});

describe('settleCrop', () => {
  /** A white 400×300 image sampled per pixel, with "text" (a checkerboard) in the given boxes. */
  const grid = (text: { x: number; y: number; w: number; h: number }[]): LumaGrid => {
    const cols = 400;
    const rows = 300;
    const luma = new Uint8Array(cols * rows).fill(255);
    for (const t of text)
      for (let y = t.y; y < t.y + t.h; y++)
        for (let x = t.x; x < t.x + t.w; x++) luma[y * cols + x] = (x + y) % 2 ? 20 : 235;
    return { width: cols, height: rows, cell: 1, cols, rows, luma };
  };

  it('grows an edge that cuts through text to the quiet band past it', () => {
    const g = grid([{ x: 50, y: 100, w: 300, h: 20 }]);
    // The crop's bottom edge (y 110) and left edge (x 60) both cut the line.
    const r = settleCrop({ x: 60, y: 60, w: 200, h: 50 }, g);
    assert.ok(r.y + r.h >= 120, `bottom ${r.y + r.h} clears the text`);
    assert.ok(r.y + r.h <= 130, `bottom ${r.y + r.h} doesn't wander`);
    assert.ok(r.x <= 42 && r.x >= 30, `left ${r.x} sits in the quiet gutter`);
    // Edges already on white stay put.
    assert.equal(r.y, 60);
    assert.equal(r.x + r.w, 260);
  });

  it('gives up at the limit, and stops at the image edge', () => {
    // Text wider than 40% growth can reach on the right: that edge stays.
    const g = grid([{ x: 0, y: 100, w: 400, h: 20 }]);
    const r = settleCrop({ x: 100, y: 95, w: 100, h: 10 }, g);
    assert.equal(r.x + r.w, 200);
    assert.equal(r.x, 100);
    // Growing hits the top of the image: the edge rests there.
    const top = settleCrop({ x: 100, y: 10, w: 100, h: 100 }, grid([{ x: 0, y: 0, w: 400, h: 30 }]));
    assert.equal(top.y, 0);
  });

  it('never shrinks, and leaves a crop alone without a usable grid', () => {
    const start = { x: 60, y: 60, w: 200, h: 50 };
    const r = settleCrop(start, grid([]));
    assert.deepEqual(r, start);
    assert.deepEqual(settleCrop(start, { ...grid([]), cols: 1, rows: 1 }), start);
  });
});

describe('contact sheet', () => {
  it('plans rows like Scrawl: one, two and many', () => {
    assert.deepEqual(planSheetRows([]), []);
    assert.deepEqual(planSheetRows([1.6]), [{ start: 0, end: 1 }]);
    assert.deepEqual(planSheetRows([1.6, 1.6]), [{ start: 0, end: 2 }]);
    assert.deepEqual(planSheetRows([2, 2]), [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
    const rows = planSheetRows(Array(7).fill(1.6));
    assert.equal(rows[0].start, 0);
    assert.equal(rows.at(-1)?.end, 7);
    rows.forEach((r, i) => {
      assert.ok(r.end > r.start && r.end - r.start <= 6);
      if (i) assert.equal(r.start, rows[i - 1].end);
    });
    assert.ok(rows.length >= 2 && rows.length <= 4, `${rows.length} rows for 7 wide screens`);
  });

  it('plans a long batch in chunks, in order and without gaps', () => {
    const aspects = Array.from({ length: 30 }, (_, i) => (i % 3 ? 1.6 : 0.5));
    const rows = planSheetRows(aspects);
    assert.equal(rows[0].start, 0);
    assert.equal(rows.at(-1)?.end, 30);
    rows.forEach((r, i) => {
      if (i) assert.equal(r.start, rows[i - 1].end);
    });
  });

  it('lays tiles out inside the size caps, justified to one width', () => {
    const sizes = Array.from({ length: 12 }, (_, i) =>
      i % 4 === 3 ? { width: 800, height: 1600 } : { width: 1800, height: 1100 },
    );
    const sheet = layoutSheet(sizes);
    assert.ok(Math.max(sheet.width, sheet.height) <= SHEET_MAX_EDGE);
    assert.ok(sheet.width * sheet.height <= SHEET_MAX_PIXELS * 1.02);
    assert.equal(sheet.cells.length, 12);
    assert.deepEqual(
      sheet.cells.map((c) => c.index),
      Array.from({ length: 12 }, (_, i) => i),
    );
    const rows = new Map<number, number>();
    for (const c of sheet.cells) {
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= sheet.width && c.y + c.h <= sheet.height);
      rows.set(c.y, Math.max(rows.get(c.y) ?? 0, c.x + c.w));
    }
    for (const right of rows.values()) assert.equal(right, sheet.width - 6);
    assert.ok(sheet.badgeScale >= 0.5 && sheet.badgeScale <= 0.9);
  });
});

describe('export names and text', () => {
  it('names files by place in the batch and a safe slug', () => {
    assert.equal(slug('Pricing page (v2).png'), 'pricing-page-v2');
    assert.equal(slug('דף.png'), 'image');
    const f = assetFiles(asset(), 2, 30);
    assert.deepEqual(
      [f.image, f.marked, f.crop(0)],
      [
        'images/03-pricing-page-v2.png',
        'marked/03-pricing-page-v2.jpg',
        'crops/03-pricing-page-v2-note-1.png',
      ],
    );
  });

  it('leaves out images with nothing written, and empty notes', () => {
    const tagged = asset({ marks: [mark({ good: 'One number, huge' }), mark({ id: 'm2' })] });
    const blank = asset({ id: 'a2', name: 'blank.png' });
    assert.deepEqual(
      exportable([blank, tagged]).map((a) => a.id),
      ['a1'],
    );
    const data = manifest([blank, tagged], '2026-10-19T10:00:00.000Z');
    assert.equal(data.assets.length, 1);
    assert.equal(data.assets[0].notes.length, 1);
    assert.equal(data.assets[0].image, 'images/01-pricing-page-v2.png');
  });

  it('writes a README that ties each note to its crop and its place', () => {
    const a = asset({
      note: 'Calm overall.',
      marks: [
        mark({
          label: 'headline',
          good: 'Huge and alone.',
          shape: { kind: 'area', x: 0.1, y: 0.05, w: 0.4, h: 0.1 },
        }),
        mark({
          id: 'm2',
          bad: 'Six chips.',
          origin: 'ai',
          quote: 'the filters are noisy',
          confirmed: false,
        }),
      ],
    });
    const text = readme([a], '2026-10-19T10:00:00.000Z');
    assert.match(text, /^# Design notes: 1 image, 2 notes/);
    assert.match(
      text,
      /## 01 · Pricing page \(v2\)\.png\n\nImage: `images\/01-pricing-page-v2\.png` \(1600×1000\)/,
    );
    assert.match(text, /Overall: Calm overall\./);
    assert.match(
      text,
      /### Note 01\.1 · headline · works\n\nWhere: area from x 10\.0%–50\.0%, y 5\.0%–15\.0% \(pixels 160,50 to 800,150\)/,
    );
    assert.match(
      text,
      /Crop: `crops\/01-pricing-page-v2-note-1\.png`\nWhat works: Huge and alone\./,
    );
    assert.match(
      text,
      /### Note 01\.2 · doesn't work\n\nWhere: dot at x 50\.0%, y 50\.0% \(pixel 800, 500\) · placed by AI from the note, not checked/,
    );
    assert.match(text, /From the note: "the filters are noisy"/);
    // The reading contract comes first, and the same words ship as AGENTS.md.
    assert.match(text, /## How to use this\n\n- Start with `contact-sheet\.jpg`: one look at the whole batch/);
    assert.match(text, /read its crop in `crops\/` first/);
    assert.match(text, /"02\.3" for the third note on image 02/);
    assert.match(text, /not checked" sits where an AI put it/);
    assert.ok(text.indexOf('## How to use this') < text.indexOf('## Files'));
    assert.ok(text.indexOf('## Files') < text.indexOf('## 01 ·'));
    assert.match(text, /`notes\.json` has all of this as data\. `AGENTS\.md` repeats/);
    assert.match(
      text,
      /`images\/`: each image as it was added; screenshots over 16 megapixels were scaled down to fit\./,
    );
    const guide = agentGuide();
    assert.match(guide, /screenshots over 16 megapixels were scaled down to fit/);
    assert.match(guide, /^# Pinch export\n/);
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) assert.ok(guide.includes(line), line);
  });

  it('reports the crop each note was drawn with, and the sheet', () => {
    const a = asset({ marks: [mark({ good: 'Fine.' })] });
    const data = manifest([a], '2026-10-19T10:00:00.000Z');
    assert.equal(data.contactSheet, 'contact-sheet.jpg');
    assert.equal(data.guide, 'AGENTS.md');
    assert.deepEqual(data.assets[0].notes[0].cropPixels, { x: 680, y: 380, w: 240, h: 240 });
    const settled = { x: 640, y: 360, w: 300, h: 280 };
    const withCrops = manifest([a], 'x', () => settled);
    assert.deepEqual(withCrops.assets[0].notes[0].cropPixels, settled);
  });
});

describe('zip', () => {
  it('computes the same CRC-32 as zlib', () => {
    const data = new TextEncoder().encode('Pin notes ✓');
    assert.equal(crc32(data), nodeCrc(data));
  });

  it('writes a stored archive whose directory points at every entry', () => {
    const files = [
      { name: 'pin-notes/README.md', data: new TextEncoder().encode('# Notes\n') },
      { name: 'pin-notes/crops/01-a-note-1.png', data: new Uint8Array([1, 2, 3, 4]) },
    ];
    const parts = zip(files, new Date(2026, 9, 19, 10, 30, 0));
    const buf = Buffer.concat(parts.map((p) => Buffer.from(p)));
    const end = buf.length - 22;
    assert.equal(buf.readUInt32LE(end), 0x06054b50);
    assert.equal(buf.readUInt16LE(end + 10), 2);
    let at = buf.readUInt32LE(end + 16);
    for (const f of files) {
      assert.equal(buf.readUInt32LE(at), 0x02014b50);
      const nameLen = buf.readUInt16LE(at + 28);
      assert.equal(buf.subarray(at + 46, at + 46 + nameLen).toString(), f.name);
      const local = buf.readUInt32LE(at + 42);
      assert.equal(buf.readUInt32LE(local), 0x04034b50);
      const start = local + 30 + buf.readUInt16LE(local + 26);
      assert.deepEqual(new Uint8Array(buf.subarray(start, start + f.data.length)), f.data);
      assert.equal(buf.readUInt32LE(local + 14), nodeCrc(f.data));
      at += 46 + nameLen;
    }
  });
});

describe('Pinch sources and suggestions', () => {
  it('names the source kind in the README and notes.json, and nothing else', () => {
    const a = asset({
      source: { kind: 'competitor' },
      marks: [mark({ good: 'Calm' })],
    });
    const text = readme([a], '2026-10-19T10:00:00Z');
    assert.match(text, /^Source: Competitor$/m);
    assert.match(text, /Source says whose design an image is/);
    const data = manifest([a], '2026-10-19T10:00:00Z');
    assert.deepEqual(data.assets[0].source, { kind: 'competitor', label: 'Competitor' });
    // A session saved before the maker and link were dropped (D61) still loads; neither is exported.
    const old = asset({
      source: { kind: 'competitor', by: ' Linear ', link: 'https://linear.app' },
      marks: [mark({ good: 'Calm' })],
    });
    assert.match(readme([old], 'x'), /^Source: Competitor$/m);
    assert.doesNotMatch(readme([old], 'x'), /Linear|linear\.app/);
    assert.doesNotMatch(JSON.stringify(manifest([old], 'x')), /Linear|linear\.app|madeBy|link/);
    // No source picked: no line, no field.
    assert.doesNotMatch(readme([asset({ marks: [mark({ good: 'x' })] })], 'x'), /^Source:/m);
  });

  it('says which words came from an accepted suggestion', () => {
    const asIs = mark({ good: 'Clear headline.', accepted: { good: 'Clear headline.' } });
    const edited = mark({ id: 'm2', bad: 'Too many chips here.', accepted: { bad: 'Too many chips.' } });
    assert.equal(suggestionUse(asIs, 'good'), 'as-is');
    assert.equal(suggestionUse(asIs, 'bad'), undefined);
    assert.equal(suggestionUse(edited, 'bad'), 'edited');
    const text = readme([asset({ marks: [asIs, edited] })], '2026-10-19T10:00:00Z');
    assert.match(text, /What works \(AI suggestion, accepted as is\): Clear headline\./);
    assert.match(text, /What doesn't \(AI suggestion, edited by the author\): Too many chips here\./);
    const notes = manifest([asset({ marks: [asIs, edited] })], 'x').assets[0].notes;
    assert.deepEqual(notes[0].aiSuggested, { works: 'as-is' });
    assert.deepEqual(notes[1].aiSuggested, { doesNotWork: 'edited' });
  });

  it('keeps a suggestion only for where the note is', () => {
    const shape = { kind: 'dot', x: 0.5, y: 0.5 } as const;
    const m = mark({ shape, suggestion: { works: 'a', doesNotWork: 'b', shape: shapeKey(shape) } });
    assert.ok(currentSuggestion(m));
    assert.equal(needsSuggestion(m), false);
    const moved = { ...m, shape: { kind: 'dot', x: 0.6, y: 0.5 } as const };
    assert.equal(currentSuggestion(moved), undefined);
    assert.equal(needsSuggestion(moved), true);
    // A note with words in it needs none.
    assert.equal(needsSuggestion(mark({ good: 'mine' })), false);
  });

  it('tidies the model answer and the prompt', () => {
    assert.deepEqual(
      cleanSuggestion({ works: '  Big\n number. ', doesNotWork: '', label: ' revenue\nheadline ' }),
      { works: 'Big number.', doesNotWork: '', label: 'revenue headline' },
    );
    assert.deepEqual(
      cleanSuggestion({
        works: 'Clear title.',
        doesNotWork: 'The marker covers the label.',
        label: 'magenta box',
      }),
      { works: 'Clear title.', doesNotWork: '', label: '' },
    );
    assert.equal(
      cleanSuggestion({ works: '', doesNotWork: '', label: 'x'.repeat(80) }).label?.length,
      60,
    );
    assert.match(suggestPrompt('revenue headline', 'ours'), /"revenue headline"[\s\S]*Ours/);
    assert.equal(suggestPrompt('', undefined).split('\n').length, 1);
    assert.match(suggestSystem, /Never describe the overlay/);
    assert.match(suggestSystem, /never as "the marked point", "the dot" or "the spot"/);
  });

  it('drops a sentence about the overlay, and keeps one about a dot or arrow in the design', () => {
    const overlay = [
      'The marked point sits on the last digit of the figure, so the dot cuts into the number and reads as a glitch against the type.',
      'The dot cuts into the number and reads as a glitch against the type.',
      'The ring sits over the icon, hiding its shape.',
      'The numbered disc covers the label.',
      'The dot overlaps the text of the button.',
      'The magenta arrow runs across the table.',
      "The arrow's tail lands on the primary button.",
      'The arrow head points at the second row.',
      'The pink circle hides the price.',
      'The close-up shows a chip cut in half.',
      'The crop cuts the heading off.',
      'In the second image the total is hard to read.',
      'The disc with the 3 obscures the save button.',
      'The leader line crosses the headline.',
      'The marked element is a filter chip.',
      'The marked area holds six chips.',
      'The marked region is empty.',
      'The marker covers the label.',
      'The little dot is placed on the icon.',
      'The tail rests on the button text.',
      'The outline cuts through the avatar.',
      'The number disc blocks the button label.',
      'The highlight hides the row.',
      'The dot points at the wrong word.',
    ];
    const design = [
      'A dot separator between the date and the author reads as a bullet.',
      'The dot between the items is too faint to see.',
      'The ring around the avatar is too thin to read as a status.',
      'The arrow icon in the button points right, which suggests a next step.',
      'The arrow icon is smaller than the text beside it.',
      'The total is one big number with nothing competing.',
      'Six filter chips in one row; none reads as the default.',
      'The pink badge reads as an error, not a tag.',
      'The circle avatar sits flush with the name, with no gap.',
      'The leaderboard rows alternate colour, which helps scanning.',
      'The head of the table is bold, which separates it from the rows.',
      'The status dot is the same green as the button, so it looks clickable.',
      'The notification dot sits on the bell icon, which is the convention.',
      'The arrow points right but the link opens a modal.',
      'The headline is cropped by the card edge on narrow screens.',
      'The number is huge and alone, so it reads first.',
      'The line under the tab is too thin.',
      'The circle sits inside a square tile, which wastes the corners.',
      'The red dot on the tab marks unread items.',
      'The pin icon on the map is hard to see on the grey road.',
    ];
    for (const s of overlay) assert.ok(aboutTheMarker(s), `about the overlay: ${s}`);
    for (const s of design) assert.ok(!aboutTheMarker(s), `about the design: ${s}`);
    assert.deepEqual(cleanSuggestion({ works: design[0], doesNotWork: overlay[0], label: 'date line' }), {
      works: design[0],
      doesNotWork: '',
      label: 'date line',
    });
  });
});

describe('Pinch AI budget', () => {
  const caps = { usd: 3, perVisitor: 15, requests: 300 };
  it('refuses a visitor past their calls or their share of the day, and the day past its budget', () => {
    const empty = { usd: 0, requests: 0, visitors: {} };
    assert.equal(pinRefusal(empty, 'v1', 0.08, caps), null);
    assert.equal(pinRefusal({ ...empty, visitors: { v1: 15 } }, 'v1', 0.08, caps), 'visitor');
    assert.equal(pinRefusal({ ...empty, visitors: { v1: 15 } }, 'v2', 0.08, caps), null);
    // A third of $3 is $1: a visitor who has spent 95¢ can't reserve 8¢ more, another can.
    const spent = { ...empty, usd: 0.95, spent: { v1: 0.95 } };
    assert.equal(pinRefusal(spent, 'v1', 0.08, caps), 'visitor');
    assert.equal(pinRefusal(spent, 'v2', 0.08, caps), null);
    assert.equal(VISITOR_SHARE, 1 / 3);
    assert.equal(pinRefusal({ ...empty, usd: 2.95 }, 'v1', 0.08, caps), 'budget');
    assert.equal(pinRefusal({ ...empty, requests: 300 }, 'v1', 0.08, caps), 'busy');
  });
});

describe('Pinch visitor address', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('trusts the platform header first, then the last hop of X-Forwarded-For', () => {
    assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' })), '203.0.113.9');
    assert.equal(
      clientIp(h({ 'x-vercel-forwarded-for': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })),
      '203.0.113.9',
    );
    // A client-written first hop never counts; the proxy's own last hop does.
    assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })), '203.0.113.9');
    assert.equal(clientIp(h({ 'x-forwarded-for': ' 203.0.113.9 ' })), '203.0.113.9');
    assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4,' })), '1.2.3.4');
    assert.equal(clientIp(h({})), 'local');
    assert.equal(clientIp(h({ 'x-real-ip': '' })), 'local');
  });
});

describe('Pinch saved note text', () => {
  const session = [
    asset({
      id: 'asset01',
      name: 'Jane Doe – private.png',
      note: 'Overall calm.',
      source: { kind: 'concept', by: 'Jane Doe', link: 'https://dribbble.com/janedoe' },
      marks: [
        mark({ id: 'mark01', good: 'Clear.', label: 'header', accepted: { good: 'Clear.' } }),
        mark({ id: 'mark02' }),
      ],
    }),
  ];

  it('sends the text only: no file names, makers or links', () => {
    const entries = logEntries(session);
    assert.deepEqual(entries, [
      { id: 'oasset01', image: 'asset01', kind: 'overall', text: 'Overall calm.', source: 'concept' },
      {
        id: 'mark01',
        image: 'asset01',
        kind: 'note',
        label: 'header',
        works: 'Clear.',
        shape: 'dot',
        origin: 'user',
        aiSuggested: { works: 'as-is' },
        source: 'concept',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(entries), /Jane|dribbble|private/);
    for (const e of entries) assert.ok(logEntrySchema.safeParse(e).success);
  });

  it('resends a note only when its text changed', () => {
    const entries = logEntries(session);
    const sent = Object.fromEntries(entries.map((e) => [e.id, fingerprint(e)]));
    assert.equal(changedEntries(entries, sent).length, 0);
    const edited = logEntries([
      { ...session[0], marks: [{ ...session[0].marks[0], good: 'Very clear.' }] },
    ]);
    assert.deepEqual(changedEntries(edited, sent).map((e) => e.id), ['mark01']);
  });

  it('replaces an edited note and holds the caps', () => {
    const doc = emptyLogDay();
    const [overall, note] = logEntries(session);
    const caps = { ...LOG_CAPS, day: 3, visitor: 2 };
    assert.deepEqual(addToDay(doc, [overall, note], 'v1', 't1', caps), { saved: 2 });
    // The same ids again replace, and don't count as new.
    assert.deepEqual(addToDay(doc, [{ ...note, works: 'Edited.' }], 'v1', 't2', caps), {
      saved: 1,
    });
    assert.equal(doc.entries.mark01.works, 'Edited.');
    assert.equal(doc.entries.mark01.at, 't2');
    assert.deepEqual(addToDay(doc, [{ ...note, id: 'mark03' }], 'v1', 't3', caps), {
      refused: 'visitor',
    });
    assert.deepEqual(
      addToDay(doc, [{ ...note, id: 'mark03' }, { ...note, id: 'mark04' }], 'v2', 't3', { ...caps, visitor: 9 }),
      { refused: 'day' },
    );
    assert.equal(Object.keys(doc.entries).length, 2);
  });

  it('counts the characters of every save, re-sent ids included, against a day and a visitor cap', () => {
    const doc = emptyLogDay();
    const [, note] = logEntries(session);
    const size = JSON.stringify(note).length;
    const caps = { ...LOG_CAPS, visitorBytes: size * 2 + 1, dayBytes: size * 3 + 1 };
    assert.deepEqual(addToDay(doc, [note], 'v1', 't1', caps), { saved: 1 });
    assert.equal(doc.bytes, size);
    assert.equal(doc.visitorBytes?.v1, size);
    // The same id again is not a new note, but its text counts.
    assert.deepEqual(addToDay(doc, [note], 'v1', 't2', caps), { saved: 1 });
    assert.equal(doc.visitors.v1, 1);
    assert.deepEqual(addToDay(doc, [note], 'v1', 't3', caps), { refused: 'visitor' });
    assert.deepEqual(addToDay(doc, [note], 'v2', 't3', caps), { saved: 1 });
    assert.deepEqual(addToDay(doc, [note], 'v3', 't3', caps), { refused: 'day' });
    // A day saved before the cap has no counters and still takes a batch.
    const old = { entries: {}, visitors: {} };
    assert.deepEqual(addToDay(old, [note], 'v1', 't1'), { saved: 1 });
  });

  it('rejects anything but the expected fields', () => {
    assert.equal(logBatchSchema.safeParse({ entries: [] }).success, false);
    const bad = { id: '../x', image: 'asset01', kind: 'note' };
    assert.equal(logEntrySchema.safeParse(bad).success, false);
    const long = { id: 'mark01', image: 'asset01', kind: 'note', works: 'x'.repeat(1001) };
    assert.equal(logEntrySchema.safeParse(long).success, false);
  });

  it('cuts what the page sends to the limits, so no batch fails on length', () => {
    const a = asset({
      id: 'asset01',
      note: ` ${'t'.repeat(2500)} `,
      marks: [
        mark({ id: 'mark01', label: 'l'.repeat(80), good: 'g'.repeat(1500), bad: ' ' }),
        mark({ id: 'mark02', good: 'fine' }),
      ],
    });
    const entries = logEntries([a]);
    assert.equal(entries[0].text?.length, 2000);
    assert.equal(entries[1].label?.length, 60);
    assert.equal(entries[1].works?.length, 1000);
    assert.equal(entries[1].doesNotWork, undefined);
    assert.ok(logBatchSchema.safeParse({ entries }).success);
  });

  it('takes an over-long field from the wire by cutting it, and still refuses everything else', () => {
    const entry = { id: 'mark01', image: 'asset01', kind: 'note', works: 'x'.repeat(1001), label: 'y'.repeat(61) };
    const taken = incomingBatchSchema.safeParse({ entries: [entry] });
    assert.ok(taken.success);
    assert.equal(taken.data.entries[0].works?.length, 1000);
    assert.equal(taken.data.entries[0].label?.length, 60);
    assert.equal(incomingBatchSchema.safeParse({ entries: [] }).success, false);
    assert.equal(incomingBatchSchema.safeParse({ entries: [{ ...entry, id: '../x' }] }).success, false);
    assert.equal(incomingBatchSchema.safeParse({ entries: Array(41).fill(entry) }).success, false);
    assert.equal(incomingBatchSchema.safeParse({ entries: [{ ...entry, works: 7 }] }).success, false);
    assert.equal(incomingBatchSchema.safeParse('nope').success, false);
  });

  it('finds the days past the retention window', () => {
    assert.deepEqual(
      expiredDays(['2026-07-20', '2026-07-21', '2026-10-19', 'junk'], '2026-10-19', 90),
      ['2026-07-20'],
    );
  });
});
