import { isSameOriginWrite } from '@/lib/auth';
import { transcribe, transcriber } from '@/lib/transcribe';

/*
 * The walkthrough's words (D131, D136): POST a take's audio as the body, get back
 * { words: [{ text, start, end }] } in milliseconds. Nothing is stored or logged. On only where
 * speech-to-text runs on this machine (`transcriber`), so it costs nothing and needs no sign-in;
 * GET says whether it is on.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** About an hour of the browser's Opus. */
const MAX_AUDIO = 50 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export function GET() {
  return Response.json({ available: transcriber() !== null }, { headers });
}

export async function POST(request: Request) {
  if (!transcriber()) return fail(503, 'Speech-to-text is off.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  if (!(request.headers.get('content-type') ?? '').startsWith('audio/'))
    return fail(415, 'Send the audio.');
  const audio = new Uint8Array(await request.arrayBuffer());
  if (!audio.length || audio.length > MAX_AUDIO)
    return fail(413, 'The recording is empty or too long.');
  try {
    return Response.json({ words: await transcribe(audio) }, { headers });
  } catch {
    return fail(500, 'The words couldn’t be read from the recording.');
  }
}
