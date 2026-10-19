/*
 * The contact sheet: every marked image of an export, in batch order, packed
 * into justified rows on one dark canvas, so an agent can take in the whole
 * batch with one image. This file plans the layout; render.ts draws it.
 *
 * The row planning is ported from Scrawl's `plan_contact_sheet_rows`
 * (src/render.rs), https://github.com/kitlangton/scrawl.
 * Copyright (c) 2026 Kit Langton. MIT License: permission is hereby granted,
 * free of charge, to any person obtaining a copy of this software and
 * associated documentation files, to deal in the software without
 * restriction, subject to the notice being included in all copies or
 * substantial portions of the software. The software is provided "as is",
 * without warranty of any kind.
 */

export const SHEET_MAX_EDGE = 1600;
export const SHEET_MAX_PIXELS = 1_560_000;
export const SHEET_GAP = 6;
export const SHEET_PAD = 6;
/** The planner searches every split into rows, so it works on batches this long at a time. */
const PLAN_CHUNK = 12;
const MAX_COLS = 6;

export type Row = { start: number; end: number };

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * Split `aspects` (width over height, in order) into justified rows of one to
 * six images, so the displayed areas stay balanced between wide and tall
 * images and the whole sheet lands near a square-ish aspect. Exhaustive, so
 * at most twelve at a time; longer batches are planned in chunks.
 */
export function planSheetRows(aspects: number[]): Row[] {
  const n = aspects.length;
  if (n === 0) return [];
  if (n === 1) return [{ start: 0, end: 1 }];
  if (n === 2) {
    return aspects[0] + aspects[1] > 3.6
      ? [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
        ]
      : [{ start: 0, end: 2 }];
  }
  if (n > PLAN_CHUNK) {
    const chunks = Math.ceil(n / PLAN_CHUNK);
    const rows: Row[] = [];
    for (let c = 0; c < chunks; c++) {
      const start = Math.round((c * n) / chunks);
      const end = Math.round(((c + 1) * n) / chunks);
      for (const r of planSheetRows(aspects.slice(start, end)))
        rows.push({ start: r.start + start, end: r.end + start });
    }
    return rows;
  }

  const totalA = sum(aspects);
  const avgA = totalA / n;
  const targetSheet = avgA < 0.7 ? 1.05 : 1.25;
  const targetRowA = Math.max(Math.sqrt(totalA * targetSheet), avgA);

  let bestRows: Row[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  const current: Row[] = [];

  const score = () => {
    const rowCount = current.length;
    const rowAspects = current.map((r) => sum(aspects.slice(r.start, r.end)));
    const invSum = sum(rowAspects.map((a) => 1 / a));
    const logRowSum = sum(rowAspects.map((a) => Math.log(a)));
    const sheetAspect = 1 / invSum;
    const sheetPen = Math.log(sheetAspect / targetSheet) ** 2 * 1.8;

    // The displayed area of image i in row r is proportional to a_i / A_r².
    const areas = new Array<number>(n).fill(0);
    current.forEach((r, ri) => {
      const invAr2 = 1 / rowAspects[ri] ** 2;
      for (let i = r.start; i < r.end; i++) areas[i] = aspects[i] * invAr2;
    });
    const logAreas = areas.map((a) => Math.log(a));
    const meanLogArea = sum(logAreas) / n;
    const areaVar = sum(logAreas.map((la) => (la - meanLogArea) ** 2)) / n;

    const sorted = [...areas].sort((a, b) => a - b);
    const medianArea = Math.max(
      (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) * 0.5,
      1e-6,
    );
    let underPen = 0;
    for (const ar of areas) {
      const ratio = ar / medianArea;
      if (ratio < 0.58) underPen += ((0.58 - ratio) / 0.58) ** 2 * 18;
      if (ratio > 2.3) underPen += ((ratio - 2.3) / 2.3) ** 2 * 4;
    }

    const meanLogA = logRowSum / rowCount;
    let rowVar = 0;
    let rowPen = 0;
    let crampPen = rowCount > 4 ? (rowCount - 4) * 2.5 : 0;
    let tie = 0;
    current.forEach((r, ri) => {
      const ar = rowAspects[ri];
      const dl = Math.log(ar) - meanLogA;
      rowVar += dl * dl;
      const dt = Math.log(ar / targetRowA);
      rowPen += dt * dt;
      for (let i = r.start; i < r.end; i++) {
        const wFrac = (aspects[i] / ar) * Math.min(sheetAspect, 1);
        if (wFrac < 0.16) crampPen += ((0.16 - wFrac) / 0.16) ** 2 * 8;
      }
      const cols = r.end - r.start;
      if (cols > 4 && avgA > 0.75) crampPen += (cols - 4) * 2;
      if (cols > 3 && avgA > 1.15) crampPen += (cols - 3) * 2;
      tie += ri * 1e-4 * cols;
    });
    return (
      sheetPen +
      areaVar * 8 +
      underPen +
      (rowVar / rowCount) * 0.6 +
      (rowPen / rowCount) * 0.4 +
      crampPen +
      tie
    );
  };

  const search = (idx: number) => {
    if (idx === n) {
      const cost = score();
      if (cost < bestCost) {
        bestCost = cost;
        bestRows = current.map((r) => ({ ...r }));
      }
      return;
    }
    const limit = Math.min(MAX_COLS, n - idx);
    for (let k = 1; k <= limit; k++) {
      // A row of one is only for a wide image, once there are three or more.
      if (k === 1 && n >= 3 && aspects[idx] < 1.85) continue;
      current.push({ start: idx, end: idx + k });
      search(idx + k);
      current.pop();
    }
  };
  search(0);
  return bestRows;
}

export type SheetCell = {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type SheetLayout = {
  width: number;
  height: number;
  cells: SheetCell[];
  badgeScale: number;
};

/**
 * Where each image goes on the sheet, in pixels. Rows are justified to one
 * width; the sheet is at most SHEET_MAX_EDGE on a side and about
 * SHEET_MAX_PIXELS in all, so a vision model gets it in one look.
 */
export function layoutSheet(sizes: { width: number; height: number }[]): SheetLayout {
  if (sizes.length === 0) return { width: 640, height: 360, cells: [], badgeScale: 0.9 };
  const aspects = sizes.map((s) =>
    Math.min(4.5, Math.max(0.25, Math.max(1, s.width) / Math.max(1, s.height))),
  );
  const rows = planSheetRows(aspects);
  const rowAspects = rows.map((r) => Math.max(0.1, sum(aspects.slice(r.start, r.end))));
  const sheetAspect = 1 / Math.max(0.01, sum(rowAspects.map((a) => 1 / a)));

  const pad = SHEET_PAD;
  const gap = SHEET_GAP;
  const nativeRowW = Math.max(
    ...rows.map(
      (r) => sum(sizes.slice(r.start, r.end).map((s) => s.width)) + gap * (r.end - r.start - 1),
    ),
  );
  const minInnerW = sizes.length === 1 ? 640 : 960;
  const desiredInnerW = Math.max(nativeRowW, minInnerW);
  let wInner =
    sheetAspect >= 1
      ? Math.min(SHEET_MAX_EDGE - 2 * pad, desiredInnerW)
      : Math.min((SHEET_MAX_EDGE - 2 * pad) * sheetAspect, desiredInnerW);

  const hInnerOf = (wi: number) =>
    sum(rows.map((r, i) => Math.max(32, wi - gap * (r.end - r.start - 1)) / rowAspects[i])) +
    gap * (rows.length - 1);

  let totalW = wInner + 2 * pad;
  const totalH = hInnerOf(wInner) + 2 * pad;
  let scale = 1;
  if (Math.max(totalW, totalH) > SHEET_MAX_EDGE)
    scale = Math.min(scale, SHEET_MAX_EDGE / Math.max(totalW, totalH));
  if (totalW * totalH > SHEET_MAX_PIXELS)
    scale = Math.min(scale, Math.sqrt(SHEET_MAX_PIXELS / (totalW * totalH)));
  if (scale < 1) {
    wInner = Math.max(64, totalW * scale - 2 * pad);
    totalW = wInner + 2 * pad;
  }

  const innerW = Math.max(64, Math.round(totalW)) - 2 * pad;
  const rowHeights = rows.map((r, i) => {
    const avail = Math.max(1, innerW - gap * (r.end - r.start - 1));
    return Math.max(1, Math.round(avail / rowAspects[i]));
  });
  const width = innerW + 2 * pad;
  const height = 2 * pad + sum(rowHeights) + gap * (rows.length - 1);

  const cells: SheetCell[] = [];
  let minCellW = Number.POSITIVE_INFINITY;
  let minCellH = Number.POSITIVE_INFINITY;
  let rowY = pad;
  rows.forEach((r, ri) => {
    const rowH = rowHeights[ri];
    minCellH = Math.min(minCellH, rowH);
    const k = r.end - r.start;
    const avail = innerW - gap * (k - 1);
    const aRow = rowAspects[ri];
    let cum = 0;
    for (let j = 0; j < k; j++) {
      const i = r.start + j;
      const x0 = Math.round(avail * (cum / aRow));
      cum += aspects[i];
      const x1 = j + 1 === k ? avail : Math.round(avail * (cum / aRow));
      const cellW = Math.max(1, x1 - x0);
      minCellW = Math.min(minCellW, cellW);
      cells.push({
        index: i,
        x: pad + x0 + j * gap,
        y: rowY,
        w: cellW,
        h: rowH,
      });
    }
    rowY += rowH + gap;
  });
  const badgeScale = Math.max(0.5, Math.min(0.9, minCellW / 120, minCellH / 72));
  return { width, height, cells, badgeScale };
}
