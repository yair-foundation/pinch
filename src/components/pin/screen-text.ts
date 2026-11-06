import type { TextLine } from '@/lib/pin/mark-words';

/*
 * The text on each screen (D166), read by `screen-text.worker.ts` once per image and kept for the
 * visit, so that an export after a take doesn't wait for it. A screen that can't be read has no text;
 * the export goes without and the next one tries again.
 */

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, (lines: TextLine[] | null) => void>();
const read = new Map<string, Promise<TextLine[]>>();

function workerHere() {
  if (worker) return worker;
  worker = new Worker(new URL('./screen-text.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; lines: TextLine[] | null }>) => {
    waiting.get(e.data.id)?.(e.data.lines);
    waiting.delete(e.data.id);
  };
  return worker;
}

async function readScreen(image: Blob): Promise<TextLine[]> {
  const w = workerHere();
  const id = ++next;
  const lines = await new Promise<TextLine[] | null>((done) => {
    waiting.set(id, done);
    w.postMessage({ id, image });
  });
  if (!lines) throw new Error('This screen could not be read.');
  return lines;
}

/** The lines on the image kept under `id`, read the first time it is asked for. */
export function screenText(
  id: string,
  imageOf: (id: string) => Promise<Blob | undefined>,
): Promise<TextLine[]> {
  const known = read.get(id);
  if (known) return known;
  const found = imageOf(id)
    .then((image) => (image ? readScreen(image) : []))
    .catch(() => {
      read.delete(id);
      return [] as TextLine[];
    });
  read.set(id, found);
  return found;
}
