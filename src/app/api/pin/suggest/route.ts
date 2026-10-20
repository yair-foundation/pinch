import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { isSameOriginWrite } from '@/lib/auth';
import { sniffImage } from '@/lib/image';
import { reserveSuggestion, settleSuggestion } from '@/lib/pin/ai-budget';
import { type Shape, SOURCES, type SourceKind } from '@/lib/pin/model';
import { cleanSuggestion, suggestPrompt, suggestSchema, suggestSystem } from '@/lib/pin/suggest';
import { clientIp } from '@/lib/pin/visitor';
import { costUsd, visitorKey } from '@/lib/budget';

/*
 * Pinch's suggestions (/pin): POST multipart { image, context, label?,
 * source?, shape? }: the crop of one empty note with its marker drawn in, and
 * the whole screen scaled down with the same marker (`shape` says whether it
 * is a dot, an area or an arrow). Get back a draft of
 * what works and what doesn't there, and a short name for the spot
 * (`label`). Nothing is stored. A small, fast model
 * (PIN_SUGGEST_MODEL), because it runs on every new note; off with
 * PIN_SUGGEST=0, or without an API key.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MODEL = process.env.PIN_SUGGEST_MODEL ?? 'claude-haiku-5-5';
const MAX_IMAGE = 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const available = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  process.env.PIN_AI !== '0' &&
  process.env.PIN_SUGGEST !== '0';
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export function GET() {
  return Response.json({ available: available() }, { headers });
}

export async function POST(request: Request) {
  if (!available()) return fail(503, 'Suggestions are off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'Send the crop.');
  }
  const file = form.get('image');
  const label = String(form.get('label') ?? '');
  const sourceValue = String(form.get('source') ?? '');
  const source = SOURCES.some((s) => s.kind === sourceValue)
    ? (sourceValue as SourceKind)
    : undefined;
  const shapeValue = String(form.get('shape') ?? '');
  const shape = ['dot', 'area', 'arrow'].includes(shapeValue)
    ? (shapeValue as Shape['kind'])
    : undefined;
  const context = form.get('context');
  if (!(file instanceof File) || file.size > MAX_IMAGE)
    return fail(400, 'The crop is missing or too large.');
  if (!(context instanceof File) || context.size > MAX_IMAGE)
    return fail(400, 'The screen is missing or too large.');
  const images = [];
  for (const f of [context, file]) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniffImage(bytes);
    if (!type || type === 'image/gif') return fail(415, 'PNG, JPEG or WebP only.');
    images.push({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: type,
        data: Buffer.from(bytes).toString('base64'),
      },
    });
  }

  const reservation = await reserveSuggestion(await visitorKey(clientIp(request.headers)));
  if (!reservation.ok) return fail(429, 'Suggestions are done for today.');

  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      output_config: { format: betaZodOutputFormat(suggestSchema) },
      system: suggestSystem,
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text', text: suggestPrompt(label, source, shape) }],
        },
      ],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] suggest ${response.model} $${spent.toFixed(5)} ${response.stop_reason}`);
    // A declined request has no fallback here: the note just gets no suggestion.
    if (response.stop_reason === 'refusal') return fail(422, 'No suggestion for this one.');
    if (!response.parsed_output) return fail(502, 'No suggestion this time.');
    return Response.json(cleanSuggestion(response.parsed_output), { headers });
  } catch (error) {
    console.error('[pin] suggest', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No suggestion this time.');
  } finally {
    await settleSuggestion(reservation, spent).catch((e) => console.error('[pin] settle', e));
  }
}
