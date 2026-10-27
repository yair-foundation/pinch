import { pageName, pageScale } from '@/lib/pin/pdf-pages';
import { PIXEL_BUDGET } from './render';

/*
 * A PDF added to a batch (D139): each page drawn as its own screenshot, in order, so a deck or an
 * exported set of screens is talked through one page at a time. pdf.js is loaded only when a PDF
 * arrives, so the page every visitor opens doesn't carry it. Nothing leaves the browser. The pure
 * parts are in `src/lib/pin/pdf-pages.ts`.
 */

/** A PDF's pages as PNG files, one per page, in order. `onPage` hears each as it is drawn. */
export async function pdfPages(
  file: File,
  onPage?: (page: number, pages: number) => void,
): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: File[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onPage?.(n, doc.numPages);
      const page = await doc.getPage(n);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: pageScale(size.width, size.height, PIXEL_BUDGET),
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('A page couldn’t be drawn.');
      pages.push(new File([blob], pageName(file.name, n), { type: 'image/png' }));
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
