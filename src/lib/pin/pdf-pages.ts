/*
 * A PDF's pages as screenshots of their own (D139), without the browser: which files are PDFs,
 * what each page is called, and how large it is drawn. `src/components/pin/pdf.ts` draws them.
 */

export const isPdf = (f: { type: string; name: string }) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** A page's name: the file's, with its page number. */
export const pageName = (file: string, page: number) =>
  `${file.replace(/\.pdf$/i, '').trim() || 'PDF'} p${page}.png`;

/**
 * How much a page is scaled from its size in points: twice (144 dpi, as a retina screenshot is),
 * or less when that would go over the pixel budget.
 */
export const pageScale = (width: number, height: number, budget: number) =>
  Math.min(2, Math.sqrt(budget / (width * height)));
