import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32 as nodeCrc } from 'node:zlib';

import { toMarks } from '../locate';
import {
  agentGuide,
  type Asset,
  areaFrom,
  arrowFrom,
  assetFiles,
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
  logBatchSchema,
  logEntries,
  logEntrySchema,
} from '../notes-log';
import { cleanSuggestion, suggestPrompt } from '../suggest';
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
    assert.match(text, /a numbered arrow from its tail to its head/);
    assert.match(agentGuide(), /dots, areas and arrows/);
    const note = manifest([a], 'x').assets[0].notes[0];
    assert.deepEqual(note.shape, { kind: 'arrow', x: 0.12, y: 0.4, x2: 0.8, y2: 0.41 });
    assert.deepEqual(note.pixels, { x: 192, y: 400, x2: 1280, y2: 410 });
    const [entry] = logEntries([a]);
    assert.equal(entry.shape, 'arrow');
    assert.ok(logEntrySchema.safeParse(entry).success);
    assert.match(suggestPrompt('', undefined, 'arrow'), /tail \(with the numbered disc\)/);
    assert.doesNotMatch(suggestPrompt('', undefined, 'dot'), /tail/);
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
    const guide = agentGuide();
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

describe('toMarks', () => {
  const ids = (() => {
    let n = 0;
    return () => `id${++n}`;
  })();
  it('turns pixel boxes into marks, a dot for tiny ones, and drops empty points', () => {
    const marks = toMarks(
      {
        points: [
          {
            quote: 'headline is great',
            label: 'headline',
            works: 'The headline is great.',
            doesNotWork: '',
            kind: 'area',
            left: 160,
            top: 50,
            right: 800,
            bottom: 150,
          },
          {
            quote: 'icon',
            label: 'help icon',
            works: '',
            doesNotWork: 'The help icon is hidden.',
            kind: 'dot',
            left: 1500,
            top: 20,
            right: 1520,
            bottom: 40,
          },
          {
            quote: 'hm',
            label: 'x',
            works: '',
            doesNotWork: '',
            kind: 'area',
            left: 0,
            top: 0,
            right: 10,
            bottom: 10,
          },
          {
            quote: 'off',
            label: 'y',
            works: 'Fine.',
            doesNotWork: '',
            kind: 'area',
            left: 1500,
            top: 900,
            right: 2400,
            bottom: 1300,
          },
        ],
        unplaced: ['Calm overall.'],
      },
      1600,
      1000,
      ids,
    );
    assert.equal(marks.length, 3);
    const s = marks[0].shape;
    assert.ok(s.kind === 'area');
    for (const [got, want] of [[s.x, 0.1], [s.y, 0.05], [s.w, 0.4], [s.h, 0.1]]) {
      assert.ok(Math.abs(got - want) < 1e-9, `${got} ≈ ${want}`);
    }
    assert.equal(marks[0].origin, 'ai');
    assert.equal(marks[0].confirmed, false);
    assert.deepEqual(marks[1].shape, { kind: 'dot', x: 0.94375, y: 0.03 });
    // Boxes past the edge are clipped to the image.
    assert.equal(marks[2].shape.kind === 'area' && marks[2].shape.x + marks[2].shape.w, 1);
  });
});

describe('Pinch sources and suggestions', () => {
  it('names the source in the README and notes.json', () => {
    const a = asset({
      source: { kind: 'competitor', by: ' Linear ', link: 'https://linear.app' },
      marks: [mark({ good: 'Calm' })],
    });
    const text = readme([a], '2026-10-19T10:00:00Z');
    assert.match(text, /Source: Competitor · made by Linear · <https:\/\/linear\.app>/);
    assert.match(text, /Source says whose design an image is/);
    const data = manifest([a], '2026-10-19T10:00:00Z');
    assert.deepEqual(data.assets[0].source, {
      kind: 'competitor',
      label: 'Competitor',
      madeBy: 'Linear',
      link: 'https://linear.app',
    });
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
    assert.deepEqual(addToDay(doc, [overall, note], 'v1', 't1', { day: 3, visitor: 2 }), { saved: 2 });
    // The same ids again replace, and don't count as new.
    assert.deepEqual(addToDay(doc, [{ ...note, works: 'Edited.' }], 'v1', 't2', { day: 3, visitor: 2 }), {
      saved: 1,
    });
    assert.equal(doc.entries.mark01.works, 'Edited.');
    assert.equal(doc.entries.mark01.at, 't2');
    assert.deepEqual(addToDay(doc, [{ ...note, id: 'mark03' }], 'v1', 't3', { day: 3, visitor: 2 }), {
      refused: 'visitor',
    });
    assert.deepEqual(
      addToDay(doc, [{ ...note, id: 'mark03' }, { ...note, id: 'mark04' }], 'v2', 't3', { day: 3, visitor: 9 }),
      { refused: 'day' },
    );
    assert.equal(Object.keys(doc.entries).length, 2);
  });

  it('rejects anything but the expected fields', () => {
    assert.equal(logBatchSchema.safeParse({ entries: [] }).success, false);
    const bad = { id: '../x', image: 'asset01', kind: 'note' };
    assert.equal(logEntrySchema.safeParse(bad).success, false);
    const long = { id: 'mark01', image: 'asset01', kind: 'note', works: 'x'.repeat(1001) };
    assert.equal(logEntrySchema.safeParse(long).success, false);
  });

  it('finds the days past the retention window', () => {
    assert.deepEqual(
      expiredDays(['2026-07-20', '2026-07-21', '2026-10-19', 'junk'], '2026-10-19', 90),
      ['2026-07-20'],
    );
  });
});
