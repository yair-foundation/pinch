import { wordsFromChunks } from '@/lib/pin/transcript';
import type { TimedWord } from '@/lib/pin/voice-tags';

/*
 * Speech-to-text in the browser (D140), for wherever Pinch's server has none (the live site): the
 * take's audio is decoded here to 16 kHz mono and read by Whisper in a worker
 * (`whisper.worker.ts`). Nothing is sent anywhere; the voice model comes from Hugging Face once and
 * the browser keeps it.
 */

/** The most the voice model weighs the first time, in MB (less where it can't run), for the page to say. */
export const MODEL_MB = 570;

/** Whether this browser can read a take itself. */
export const browserVoiceOn = () =>
  typeof window !== 'undefined' &&
  typeof Worker !== 'undefined' &&
  typeof WebAssembly !== 'undefined' &&
  typeof OfflineAudioContext !== 'undefined';

/** A recording as Whisper hears it: one channel at 16 kHz. */
async function samplesOf(audio: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await audio.arrayBuffer());
  } finally {
    ctx.close().catch(() => undefined);
  }
  const rate = 16_000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const source = off.createBufferSource();
  source.buffer = decoded;
  source.connect(off.destination);
  source.start();
  // A copy of its own, so it can be handed to the worker whole.
  return new Float32Array((await off.startRendering()).getChannelData(0));
}

let worker: Worker | null = null;
let next = 0;

/** The worker, made again after one that wouldn't load or died, so the next try starts afresh. */
function workerHere(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('error', () => {
    if (worker === w) worker = null;
    w.terminate();
  });
  worker = w;
  return w;
}

/**
 * Fetches the voice model ahead of a take (D161), so that Finish doesn't wait for it, unless the
 * person asked their browser to save data. `onModel` hears how much has come in (0–100). Returns
 * how to stop listening; the fetch carries on.
 */
export function prepareBrowserVoice(onModel: (progress: number) => void): () => void {
  const saving = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  if (saving) return () => undefined;
  const w = workerHere();
  // Ready, or given up on (an error with no take, or the worker gone): nothing more comes in.
  const settle = () => onModel(100);
  const onMessage = (e: MessageEvent<{ type: string; progress?: number; id?: number }>) => {
    if (e.data.type === 'progress') onModel(e.data.progress ?? 0);
    if (e.data.type === 'prepared' || (e.data.type === 'error' && e.data.id === undefined))
      settle();
  };
  w.addEventListener('message', onMessage);
  w.addEventListener('error', settle);
  w.postMessage({});
  return () => {
    w.removeEventListener('message', onMessage);
    w.removeEventListener('error', settle);
  };
}

/**
 * The words in a take, each timed in milliseconds from its start. `onModel` hears how much of the
 * voice model has come in (0–100) while it downloads, the first time.
 */
export async function transcribeInBrowser(
  audio: Blob,
  onModel?: (progress: number) => void,
): Promise<TimedWord[]> {
  const samples = await samplesOf(audio);
  const w = workerHere();
  const id = ++next;
  return new Promise((resolve, reject) => {
    const onMessage = (
      e: MessageEvent<
        | { type: 'progress'; progress: number }
        | { type: 'prepared' }
        | { type: 'words'; id: number; chunks: Parameters<typeof wordsFromChunks>[0] }
        | { type: 'error'; id: number; message: string }
      >,
    ) => {
      const m = e.data;
      if (m.type === 'progress') return onModel?.(m.progress);
      if (m.type === 'prepared' || m.id !== id) return;
      done();
      if (m.type === 'words') resolve(wordsFromChunks(m.chunks));
      else reject(new Error(m.message));
    };
    // A worker that won't load or dies answers nothing: the take's reading fails, to try again.
    const onError = () => {
      done();
      reject(new Error('The voice worker stopped.'));
    };
    const done = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, audio: samples }, [samples.buffer]);
  });
}
