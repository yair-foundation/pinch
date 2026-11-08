/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';
import { type VoiceTier, voiceTiers } from '@/lib/pin/voice-models';

/*
 * Whisper in the browser (D140, D161), off the page's thread: the voice model is fetched from
 * Hugging Face once and cached by the browser, then each take's audio (16 kHz mono samples) is read
 * here into words with their times. The audio never leaves the browser. `voiceTiers` says which
 * model to start on; one that won't load or run gives way to the next.
 */

type Asr = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ chunks?: { text: string; timestamp: [number | null, number | null] }[] }>;

const post = (message: unknown) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

const OPTIONS = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 };

async function tiersHere(): Promise<VoiceTier[]> {
  const here = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };
  };
  const adapter = await here.gpu?.requestAdapter().catch(() => null);
  return voiceTiers({
    webgpu: Boolean(adapter),
    f16: Boolean(adapter?.features.has('shader-f16')),
    memoryGb: here.deviceMemory,
  });
}

let tiers: VoiceTier[] | null = null;
let ready: Promise<{ asr: Asr; tier: VoiceTier }> | null = null;

/** The best model that loads here, the others dropped on the way. */
async function load(): Promise<{ asr: Asr; tier: VoiceTier }> {
  tiers ??= await tiersHere();
  for (;;) {
    const tier = tiers[0];
    try {
      const asr = await pipeline('automatic-speech-recognition', tier.model, {
        device: tier.device,
        dtype: tier.dtype,
        progress_callback: (p) => {
          if (p.status === 'progress_total') post({ type: 'progress', progress: p.progress });
        },
      });
      return { asr: asr as unknown as Asr, tier };
    } catch (error) {
      if (tiers.length === 1) throw error;
      tiers = tiers.slice(1);
    }
  }
}

async function transcribe(audio: Float32Array) {
  for (;;) {
    ready ??= load();
    const { asr, tier } = await ready;
    try {
      return await asr(audio, { ...OPTIONS, ...tier.options });
    } catch (error) {
      // A model that can't run here: once more on the next one, which every browser has in the end.
      if (!tiers || tiers.length === 1) throw error;
      tiers = tiers.slice(1);
      ready = null;
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id?: number; audio?: Float32Array }>) => {
  const { id, audio } = e.data;
  try {
    if (!audio) {
      // Fetched ahead of the take, so that Finish doesn't wait for it.
      ready ??= load();
      await ready;
      post({ type: 'prepared' });
      return;
    }
    const out = await transcribe(audio);
    post({ type: 'words', id, chunks: out.chunks ?? [] });
  } catch (error) {
    ready = null;
    tiers = null;
    // With no take, the page stops showing the model coming in.
    post({ type: 'error', id, message: (error as Error).message });
  }
};
