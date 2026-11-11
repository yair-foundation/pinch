import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  loudnessOf,
  loudRuns,
  type Piece,
  type PieceWords,
  piecesOf,
  SPEECH_RATE,
  type Span,
  soundOf,
  wordsOfPieces,
} from './pin/speech-pieces';
import type { ReadBy } from './pin/narration';
import { wordsFromWhisper } from './pin/transcript';
import type { TimedWord } from './pin/voice-tags';

/*
 * Speech-to-text for the walkthrough (D131, D136), behind one function so the engine can change.
 * Today the only engine is whisper.cpp on the machine running `next dev`: free, and the audio never
 * leaves it. It is on with PINCH_WHISPER_MODEL (the path of a ggml model, from
 * `pnpm whisper-model`) and never on Vercel. The audio is written to a temporary folder for the
 * two programs and deleted as soon as they finish. With PINCH_WHISPER_VAD (the path of a Silero
 * model, also from `pnpm whisper-model`), the take is cut at its pauses and each stretch of speech
 * is read on its own (D187): read whole, whisper times words up to 14 seconds off over a long
 * pause and repeats its last sentence (D159), and read whole with its own `--vad` it still carried
 * one sentence into the next, so that on the author's review of 336 slides it heard 20 of 43
 * "Delete this slide".
 */

const run = promisify(execFile);

/** Design words whisper would otherwise mishear, given to it as the start of the speech. */
const PROMPT =
  'Talking through screenshots of an interface: layout, spacing, hierarchy, typography, contrast, copy, padding, alignment, the CTA, the nav, a modal, a tooltip, a dropdown.';

/** Which engine is on, or null when speech-to-text is off. */
export const transcriber = (): 'whisper' | null =>
  process.env.PINCH_WHISPER_MODEL && !process.env.VERCEL ? 'whisper' : null;

/** A WAV file's samples: 16-bit, one channel, as ffmpeg wrote them. */
function samplesOf(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  // The chunks after "RIFF….WAVE": the sound is the one named "data".
  let at = 12;
  while (at + 8 <= wav.length) {
    const size = view.getUint32(at + 4, true);
    const data = String.fromCharCode(...wav.subarray(at, at + 4)) === 'data';
    if (data) {
      const count = Math.floor(Math.min(size, wav.length - at - 8) / 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return new Float32Array(0);
}

/** Samples as a WAV file whisper reads: 16-bit, one channel, 16 kHz. */
function wavOf(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_RATE, true);
  view.setUint32(28, SPEECH_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), true);
  return out;
}

/**
 * Where Silero hears speech in a recording, by the program that comes with whisper-cli. It prints
 * "Speech segment 0: start = 234.00, end = 358.00", in hundredths of a second.
 */
async function speechOf(wav: string, vad: string, whisper: string): Promise<Span[]> {
  const beside = whisper.includes('/') ? `${dirname(whisper)}/` : '';
  const { stdout } = await run(
    `${beside}whisper-vad-speech-segments`,
    ['-vm', vad, '-f', wav, '-np'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return [...stdout.matchAll(/start = ([\d.]+), end = ([\d.]+)/g)].map((m) => ({
    from: Number(m[1]) * 10,
    to: Number(m[2]) * 10,
  }));
}

const ms = (t: number) => Math.round((t * SPEECH_RATE) / 1000);

/**
 * The take cut at its pauses, each piece read on its own with nothing carried from the last
 * (D187). Null when the cut can't be made, for the take to be read whole.
 */
async function wordsByPiece(
  dir: string,
  wav: string,
  whisper: string,
  model: string,
  vad: string,
): Promise<TimedWord[] | null> {
  let pieces: Piece[];
  let samples: Float32Array;
  try {
    samples = samplesOf(await readFile(wav));
    const db = loudnessOf(samples);
    pieces = piecesOf(loudRuns(db), await speechOf(wav, vad, whisper), db);
  } catch {
    return null;
  }
  if (!pieces.length) return [];
  const duration = (samples.length * 1000) / SPEECH_RATE;
  const sounds = pieces.map((p) => soundOf(p, duration));
  const names = pieces.map((_, i) => `piece-${String(i).padStart(5, '0')}.wav`);
  await Promise.all(
    names.map((name, i) =>
      writeFile(join(dir, name), wavOf(samples.subarray(ms(sounds[i].from), ms(sounds[i].to)))),
    ),
  );
  // Nothing carried from one piece to the next (`-mc 0`): each is read as a recording of its own.
  await run(
    whisper,
    ['-m', model, '-l', 'auto', '-ml', '1', '-sow', '-oj', '-np', '-mc', '0', '--prompt', PROMPT, ...names],
    { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
  );
  const read: PieceWords[] = [];
  for (const [i, name] of names.entries()) {
    const words = wordsFromWhisper(JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8')));
    read.push({ piece: pieces[i], soundFrom: sounds[i].from, words });
  }
  return wordsOfPieces(read);
}

/**
 * The words in a recording, each timed in milliseconds from its start, and how they were read
 * (D188): the model's file name, never its path.
 */
export async function transcribe(
  audio: Uint8Array,
): Promise<{ words: TimedWord[]; readBy: ReadBy }> {
  const model = process.env.PINCH_WHISPER_MODEL;
  if (!model || transcriber() !== 'whisper') throw new Error('Speech-to-text is off.');
  const vad = process.env.PINCH_WHISPER_VAD;
  const dir = await mkdtemp(join(tmpdir(), 'pinch-voice-'));
  try {
    const input = join(dir, 'take');
    const wav = join(dir, 'take.wav');
    const out = join(dir, 'words');
    await writeFile(input, audio);
    // whisper.cpp reads 16 kHz mono WAV; the browser records WebM or MP4.
    await run('ffmpeg', [
      '-nostdin',
      '-loglevel',
      'error',
      '-i',
      input,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    const whisper = process.env.PINCH_WHISPER_BIN || 'whisper-cli';
    const readBy = (cut: boolean): ReadBy => ({ engine: 'server', model: basename(model), cut });
    const cut = vad ? await wordsByPiece(dir, wav, whisper, model, vad) : null;
    if (cut) return { words: cut, readBy: readBy(true) };
    await run(
      whisper,
      [
        '-m',
        model,
        '-f',
        wav,
        '-l',
        'auto',
        '-ml',
        '1',
        '-sow',
        '-oj',
        '-of',
        out,
        '-np',
        '--prompt',
        PROMPT,
        ...(vad ? ['--vad', '--vad-model', vad] : []),
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const words = wordsFromWhisper(JSON.parse(await readFile(`${out}.json`, 'utf8')));
    return { words, readBy: readBy(false) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
