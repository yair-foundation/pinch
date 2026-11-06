/*
 * Which voice model a browser reads a take with (D140, D161), best first. The large model was the
 * only one that held up on the author's real takes: the smaller one misheard short sentences and
 * could fill the pauses between them with loops. It needs WebGPU with 16-bit floats and the memory
 * for it, so anything else starts on the smaller one, and a model that fails gives way to the next.
 * Pure, for tests.
 */

export type VoiceTier = {
  model: string;
  device: 'webgpu' | 'wasm';
  dtype: {
    encoder_model: 'q4f16' | 'fp32' | 'q8';
    decoder_model_merged: 'q4f16' | 'q8';
  };
  /** The large model reads many languages; the voice tags are in English (D131). */
  options?: { language: string; task: string };
};

const LARGE: VoiceTier = {
  model: 'onnx-community/whisper-large-v3-turbo_timestamped',
  device: 'webgpu',
  dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' },
  options: { language: 'english', task: 'transcribe' },
};

const SMALL = 'onnx-community/whisper-base.en_timestamped';

/** The encoder kept whole on the GPU, where it is fast. */
const SMALL_ON_GPU: VoiceTier = {
  model: SMALL,
  device: 'webgpu',
  dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
};

/** Eight-bit in WebAssembly, to stay small. */
const SMALL_ON_WASM: VoiceTier = {
  model: SMALL,
  device: 'wasm',
  dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};

/** Browsers report memory in steps up to 8 GB or more: below that, the large model won't fit. */
const LARGE_NEEDS_GB = 8;

/** The models to try here, best first. `memoryGb` is unknown in the browsers that don't report it. */
export function voiceTiers(here: {
  webgpu: boolean;
  f16: boolean;
  memoryGb?: number;
}): VoiceTier[] {
  const roomy = here.memoryGb === undefined || here.memoryGb >= LARGE_NEEDS_GB;
  return [
    ...(here.webgpu && here.f16 && roomy ? [LARGE] : []),
    ...(here.webgpu ? [SMALL_ON_GPU] : []),
    SMALL_ON_WASM,
  ];
}
