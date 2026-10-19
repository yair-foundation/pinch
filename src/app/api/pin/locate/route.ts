import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import { sniffImage } from '@/lib/image';
import { reserveCall, settleCall } from '@/lib/pin/ai-budget';
import { locatePrompt, locateSchema, locateSystem, MAX_NOTE } from '@/lib/pin/locate';

/*
 * Pinch's "Find in image": POST multipart { image, width, height,
 * note } and get back the note split into points with a box for each.
 * Nothing is stored: the image and note go to the model and the answer comes
 * back. GET says whether the step is on (an API key, PIN_AI not "0").
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.PIN_MODEL ?? 'claude-opus-5-5';
const EFFORT = (process.env.PIN_EFFORT ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_IMAGE = 3 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const available = () => Boolean(process.env.ANTHROPIC_API_KEY) && process.env.PIN_AI !== '0';
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export function GET() {
  return Response.json({ available: available() }, { headers });
}

export async function POST(request: Request) {
  if (!available()) return fail(503, 'Finding notes in the image is off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Send the image and the note.');
  }
  const note = String(form.get('note') ?? '').trim();
  const file = form.get('image');
  const width = Number(form.get('width'));
  const height = Number(form.get('height'));
  if (!note) return fail(400, 'Write a note first.');
  if (note.length > MAX_NOTE) return fail(400, `Keep the note under ${MAX_NOTE} characters.`);
  if (!(file instanceof File) || file.size > MAX_IMAGE)
    return fail(400, 'The image is missing or too large.');
  if (!(width > 0 && height > 0 && width <= 4096 && height <= 4096))
    return fail(400, 'The image size is missing.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || type === 'image/gif') return fail(415, 'PNG, JPEG or WebP only.');

  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local';
  const reservation = await reserveCall(await visitorKey(ip));
  if (!reservation.ok) {
    return fail(
      429,
      reservation.reason === 'visitor'
        ? "You've used today's AI placements. Place notes by hand, or come back tomorrow."
        : 'The AI step has done its share for today. Place notes by hand, or come back tomorrow.',
    );
  }

  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // A declined request is retried on a fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: betaZodOutputFormat(locateSchema) },
      system: locateSystem,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: type,
                data: Buffer.from(bytes).toString('base64'),
              },
            },
            { type: 'text', text: locatePrompt(note, width, height) },
          ],
        },
      ],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] locate ${response.model} $${spent.toFixed(4)} ${response.stop_reason}`);
    if (response.stop_reason === 'refusal')
      return fail(422, "The AI couldn't read this one. Place notes by hand.");
    if (!response.parsed_output) return fail(502, 'The AI answer was cut off. Try again.');
    return Response.json(response.parsed_output, { headers });
  } catch (error) {
    console.error('[pin] locate', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, "Couldn't place the notes. Try again in a moment.");
  } finally {
    await settleCall(reservation.day, spent).catch((e) => console.error('[pin] settle', e));
  }
}
