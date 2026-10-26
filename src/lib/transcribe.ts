import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { wordsFromWhisper } from './pin/transcript';
import type { TimedWord } from './pin/voice-tags';

/*
 * Speech-to-text for the walkthrough (D131, D136), behind one function so the engine can change.
 * Today the only engine is whisper.cpp on the machine running `next dev`: free, and the audio never
 * leaves it. It is on with PINCH_WHISPER_MODEL (the path of a ggml model, from
 * `pnpm whisper-model`) and never on Vercel. The audio is written to a temporary folder for the
 * two programs and deleted as soon as they finish.
 */

const run = promisify(execFile);

/** Design words whisper would otherwise mishear, given to it as the start of the speech. */
const PROMPT =
  'Talking through screenshots of an interface: layout, spacing, hierarchy, typography, contrast, copy, padding, alignment, the CTA, the nav, a modal, a tooltip, a dropdown.';

/** Which engine is on, or null when speech-to-text is off. */
export const transcriber = (): 'whisper' | null =>
  process.env.PINCH_WHISPER_MODEL && !process.env.VERCEL ? 'whisper' : null;

/** The words in a recording, each timed in milliseconds from its start. */
export async function transcribe(audio: Uint8Array): Promise<TimedWord[]> {
  const model = process.env.PINCH_WHISPER_MODEL;
  if (!model || transcriber() !== 'whisper') throw new Error('Speech-to-text is off.');
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
    await run(
      process.env.PINCH_WHISPER_BIN || 'whisper-cli',
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
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return wordsFromWhisper(JSON.parse(await readFile(`${out}.json`, 'utf8')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
