/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers';

/*
 * Whisper in the browser (D140), off the page's thread: the voice model is fetched from Hugging
 * Face once and cached by the browser, then each take's audio (16 kHz mono samples) is read here
 * into words with their times. The audio never leaves the browser. It runs on the GPU where the
 * browser has WebGPU, and in WebAssembly where it hasn't or where the GPU fails.
 */

/**
 * Whisper base in English, exported with the attention it needs to time each word. English only,
 * as the voice tags are (D131), and better at it than the multilingual one of the same size.
 */
const MODEL = 'onnx-community/whisper-base.en_timestamped';

type Asr = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ chunks?: { text: string; timestamp: [number | null, number | null] }[] }>;

const post = (message: unknown) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);

async function load(device: 'webgpu' | 'wasm'): Promise<Asr> {
  const asr = await pipeline('automatic-speech-recognition', MODEL, {
    device,
    // The encoder kept whole on the GPU, where it is fast; eight-bit in WebAssembly, to stay small.
    dtype:
      device === 'webgpu'
        ? { encoder_model: 'fp32', decoder_model_merged: 'q8' }
        : { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (p) => {
      if (p.status === 'progress_total') post({ type: 'progress', progress: p.progress });
    },
  });
  return asr as unknown as Asr;
}

const hasGpu = async () => {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return Boolean(gpu && (await gpu.requestAdapter().catch(() => null)));
};

let ready: Promise<Asr> | null = null;
let device: 'webgpu' | 'wasm' | null = null;

const OPTIONS = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 };

async function transcribe(audio: Float32Array) {
  if (!ready) {
    device = (await hasGpu()) ? 'webgpu' : 'wasm';
    ready = load(device);
  }
  try {
    const asr = await ready;
    return await asr(audio, OPTIONS);
  } catch (error) {
    // A GPU that can't run the model: once more in WebAssembly, which every browser here has.
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    ready = load('wasm');
    const asr = await ready;
    return await asr(audio, OPTIONS);
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array }>) => {
  const { id, audio } = e.data;
  try {
    const out = await transcribe(audio);
    post({ type: 'words', id, chunks: out.chunks ?? [] });
  } catch (error) {
    ready = null;
    post({ type: 'error', id, message: (error as Error).message });
  }
};
