import type { Batch, ExportedRule } from './learnings';
import { itemsLine, sourceLabel, type Verdict, verdictOf } from './model';
import type { ScreenNames } from './screen-index';

/**
 * The review sheets of a rules package (D106): each batch's close-ups with their notes beside
 * them, nine to a sheet, in note order. A close-up is the evidence behind a rule, and a one-line
 * rule is easy to apply without looking at it; a sheet is a way to look at many at once, with
 * what the author wrote under each. The drawing is in the browser (`render.ts`); this is the
 * plan it draws and the names the package gives the files.
 */

/** The sheet's geometry, in pixels, shared with the drawing. */
export const REVIEW = {
  width: 1600,
  gap: 16,
  cols: 3,
  rows: 3,
  /** The close-up's box in a cell, and the text under it. */
  cropH: 280,
  textH: 220,
} as const;

export const REVIEW_PER_SHEET = REVIEW.cols * REVIEW.rows;

/** One note on a sheet. */
export type ReviewCell = {
  ref: string;
  verdict: Verdict;
  /** Whose design and what it shows: "Ours; Marketing Assets - Unified Inbox". */
  about: string;
  works: string;
  doesNot: string;
  /** The rules that draw on it: "R22". */
  rules: string[];
  /** Where its close-up is in the batch's export. */
  crop: string;
};

/** A batch's notes as cells, in note order. */
export function reviewCells(batch: Batch, rules: ExportedRule[], names: ScreenNames): ReviewCell[] {
  const by = new Map<string, string[]>();
  for (const r of rules)
    for (const n of r.notes)
      if (n.batch.id === batch.id) by.set(n.note.ref, [...(by.get(n.note.ref) ?? []), r.id]);
  return batch.notes.map((n) => ({
    ref: n.ref,
    verdict: verdictOf({ good: n.works, bad: n.doesNotWork }),
    about: [n.source ? sourceLabel(n.source) : '', n.screenTag ? names.name(n.screenTag) : '']
      .filter(Boolean)
      .join('; '),
    works: itemsLine(n.works),
    doesNot: itemsLine(n.doesNotWork),
    rules: by.get(n.ref) ?? [],
    crop: n.crop,
  }));
}

/** The cells split into sheets of nine. */
export function reviewPages(cells: ReviewCell[]): ReviewCell[][] {
  const pages: ReviewCell[][] = [];
  for (let i = 0; i < cells.length; i += REVIEW_PER_SHEET)
    pages.push(cells.slice(i, i + REVIEW_PER_SHEET));
  return pages;
}

/** A sheet's file in its batch's folder: "review-02.jpg" for the second. */
export const reviewFile = (page: number) => `review-${String(page + 1).padStart(2, '0')}.jpg`;

/** A batch's sheets as the index lists them: each file with the first and last note on it. */
export type ReviewList = {
  folder: string;
  sheets: { file: string; notes: string }[];
}[];

/** The notes a sheet holds, in a few words: "01.1" or "01.1 to 03.2". */
export const reviewSpan = (page: ReviewCell[]) =>
  page.length > 1 ? `${page[0].ref} to ${page[page.length - 1].ref}` : (page[0]?.ref ?? '');
