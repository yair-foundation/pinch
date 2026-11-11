/// <reference lib="webworker" />
import { AutoModel, pipeline, Tensor } from '@huggingface/transformers';
import {
  loudnessOf,
  loudRuns,
  type Piece,
  piecesOf,
  SPEECH_RATE,
  soundOf,
  speechIn,
} from '@/lib/pin/speech-pieces';
import { type VoiceTier, voiceTiers } from '@/lib/pin/voice-models';

/*
 * Whisper in the browser (D140, D161), off the page's thread: the voice model is fetched from
 * Hugging Face once and cached by the browser, then each take's audio (16 kHz mono samples) is read
 * here into words with their times. The audio never leaves the browser. `voiceTiers` says which
 * model to start on; one that won't load or run gives way to the next.
 *
 * The take is cut at its pauses first and each stretch of speech read on its own (D187): Silero, a
 * small speech model fetched and kept the same way, says where the speech is. Without it the take
 * is read whole, as it was before.
 */

type Chunk = { text: string; timestamp: [number | null, number | null] };
type Asr = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ chunks?: Chunk[] }>;

/** Silero: how likely each 512 samples are speech, given what it kept of the ones before. */
type Ear = (inputs: {
  input: Tensor;
  sr: Tensor;
  state: Tensor;
}) => Promise<{ output: { data: ArrayLike<number> }; stateN: Tensor }>;

const SILERO = 'onnx-community/silero-vad';
const WINDOW = 512;
/**
 * Silero hears each window with the end of the one before it in front: without that it missed a
 * fifth of the speech on the author's take.
 */
const CARRIED = 64;

/** One piece's reading: the piece, when the sound Whisper was handed began, and its words. */
export type PieceRead = { piece: Piece; from: number; chunks: Chunk[] };

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

let ear: Promise<Ear> | null = null;

const earHere = () =>
  (ear ??= AutoModel.from_pretrained(SILERO, {
    // Not a model the library knows by name: it is run as it comes.
    config: { model_type: 'custom' } as never,
    dtype: 'fp32',
    device: 'wasm',
  }) as unknown as Promise<Ear>);

/** The stretches of speech in a recording, or null when Silero can't be had: it's read whole. */
async function piecesIn(audio: Float32Array): Promise<Piece[] | null> {
  try {
    const listen = await earHere();
    const sr = new Tensor('int64', BigInt64Array.from([BigInt(SPEECH_RATE)]), []);
    let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    const answers = new Float32Array(Math.floor(audio.length / WINDOW));
    for (let i = 0; i < answers.length; i++) {
      const heard = new Float32Array(CARRIED + WINDOW);
      if (i > 0) heard.set(audio.subarray(i * WINDOW - CARRIED, i * WINDOW));
      heard.set(audio.subarray(i * WINDOW, (i + 1) * WINDOW), CARRIED);
      const input = new Tensor('float32', heard, [1, heard.length]);
      const answer = await listen({ input, sr, state });
      state = answer.stateN;
      answers[i] = answer.output.data[0];
    }
    const db = loudnessOf(audio);
    return piecesOf(loudRuns(db), speechIn(answers, 0, (WINDOW * 1000) / SPEECH_RATE), db);
  } catch {
    ear = null;
    return null;
  }
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
      // All of it is in: the page stops saying the model is coming and says it is reading.
      post({ type: 'progress', progress: 100 });
      return { asr: asr as unknown as Asr, tier };
    } catch (error) {
      if (tiers.length === 1) throw error;
      tiers = tiers.slice(1);
    }
  }
}

async function transcribe(
  audio: Float32Array,
): Promise<{ chunks: Chunk[] } | { pieces: PieceRead[] }> {
  const pieces = await piecesIn(audio);
  const duration = (audio.length * 1000) / SPEECH_RATE;
  const at = (ms: number) => Math.round((ms * SPEECH_RATE) / 1000);
  for (;;) {
    ready ??= load();
    const { asr, tier } = await ready;
    const options = { ...OPTIONS, ...tier.options };
    try {
      if (!pieces) return { chunks: (await asr(audio, options)).chunks ?? [] };
      const read: PieceRead[] = [];
      for (const piece of pieces) {
        const sound = soundOf(piece, duration);
        // A copy of its own: each piece is read as a recording that starts and ends in quiet.
        const heard = await asr(audio.slice(at(sound.from), at(sound.to)), options);
        read.push({ piece, from: sound.from, chunks: heard.chunks ?? [] });
      }
      return { pieces: read };
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
      // Silero comes in beside it; a take is read whole if it never does.
      earHere().catch(() => {
        ear = null;
      });
      await ready;
      post({ type: 'prepared' });
      return;
    }
    post({ type: 'words', id, ...(await transcribe(audio)) });
  } catch (error) {
    ready = null;
    tiers = null;
    // With no take, the page stops showing the model coming in.
    post({ type: 'error', id, message: (error as Error).message });
  }
};
