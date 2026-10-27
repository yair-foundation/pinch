import { wordsFromChunks } from '@/lib/pin/transcript';
import type { TimedWord } from '@/lib/pin/voice-tags';

/*
 * Speech-to-text in the browser (D140), for wherever Pinch's server has none (the live site): the
 * take's audio is decoded here to 16 kHz mono and read by Whisper in a worker
 * (`whisper.worker.ts`). Nothing is sent anywhere; the voice model comes from Hugging Face once and
 * the browser keeps it.
 */

/** The most the voice model weighs the first time, in MB (less without WebGPU), for the page to say. */
export const MODEL_MB = 140;

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

/**
 * The words in a take, each timed in milliseconds from its start. `onModel` hears how much of the
 * voice model has come in (0–100) while it downloads, the first time.
 */
export async function transcribeInBrowser(
  audio: Blob,
  onModel?: (progress: number) => void,
): Promise<TimedWord[]> {
  const samples = await samplesOf(audio);
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = ++next;
  return new Promise((resolve, reject) => {
    const onMessage = (
      e: MessageEvent<
        | { type: 'progress'; progress: number }
        | { type: 'words'; id: number; chunks: Parameters<typeof wordsFromChunks>[0] }
        | { type: 'error'; id: number; message: string }
      >,
    ) => {
      const m = e.data;
      if (m.type === 'progress') return onModel?.(m.progress);
      if (m.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (m.type === 'words') resolve(wordsFromChunks(m.chunks));
      else reject(new Error(m.message));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, audio: samples }, [samples.buffer]);
  });
}
