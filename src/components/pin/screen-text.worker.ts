/// <reference lib="webworker" />
import { DEFAULT_MODEL, PaddleOcrService } from 'ppu-paddle-ocr/web';
import type { TextLine } from '@/lib/pin/mark-words';

/*
 * The text on a screenshot, read off the page's thread (D166), for a mark said in words. The models
 * are fetched from Hugging Face once and kept here. The screenshot never leaves the browser. It runs
 * on the processor: as quick as the graphics card on the author's take, and the voice model has the
 * card.
 */

const post = (message: unknown) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

const MODELS_CACHE = 'pinch-screen-text';

/** A model's bytes. Hugging Face's address changes on each fetch, so the browser wouldn't keep it. */
async function modelFile(url: string) {
  const cache = await caches.open(MODELS_CACHE).catch(() => null);
  const kept = await cache?.match(url);
  if (kept) return kept.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error('The text model did not load.');
  await cache?.put(url, response.clone()).catch(() => undefined);
  return response.arrayBuffer();
}

let ready: Promise<PaddleOcrService> | null = null;

const serviceHere = () =>
  (ready ??= (async () => {
    const service = new PaddleOcrService({
      model: {
        detection: await modelFile(DEFAULT_MODEL.detection),
        recognition: await modelFile(DEFAULT_MODEL.recognition),
        charactersDictionary: await modelFile(DEFAULT_MODEL.charactersDictionary),
      },
      session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    });
    await service.initialize();
    return service;
  })());

async function read(image: Blob): Promise<TextLine[]> {
  const service = await serviceHere();
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { results } = await service.recognize(canvas, { flatten: true });
  return results.map((r) => ({
    text: r.text,
    x: r.box.x / width,
    y: r.box.y / height,
    w: r.box.width / width,
    h: r.box.height / height,
  }));
}

// One screen at a time: a session runs one thing at once.
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<{ id: number; image: Blob }>) => {
  const { id, image } = e.data;
  queue = queue.then(async () => {
    try {
      post({ id, lines: await read(image) });
    } catch {
      ready = null;
      post({ id, lines: null });
    }
  });
};
