import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { gate } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import { reserveLearning, settleLearning } from '@/lib/pin/ai-budget';
import {
  cleanLearnings,
  learnPrompt,
  learnRequestSchema,
  learnSchema,
  learnSystem,
} from '@/lib/pin/learn';
import { clientIp } from '@/lib/pin/visitor';

/*
 * Pinch's learnings: POST JSON { notes: [{ id, works, doesNotWork, label?,
 * topics, source? }] }, a few notes of a collection's batch, only their words.
 * Get back { rules: { [id]: rule } }: the rule each note teaches, empty when it
 * teaches nothing. Nothing is stored, and no note text is logged. Off with
 * PIN_LEARN=0, PIN_AI=0, or without an API key.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.PIN_LEARN_MODEL ?? 'claude-opus-5-5';
/** Models the server-side refusal fallback takes; any other declines with no rule. */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const MAX_BODY = 40_000;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const available = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  process.env.PIN_AI !== '0' &&
  process.env.PIN_LEARN !== '0';
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export function GET() {
  return Response.json({ available: available() }, { headers });
}

export async function POST(request: Request) {
  if (!available()) return fail(503, 'Drafting is off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const blocked = await gate(request);
  if (blocked) return blocked;

  const body = await request.text().catch(() => '');
  if (!body || body.length > MAX_BODY) return fail(400, 'Send a few notes.');
  let parsed: ReturnType<typeof learnRequestSchema.safeParse>;
  try {
    parsed = learnRequestSchema.safeParse(JSON.parse(body));
  } catch {
    return fail(400, 'Send a few notes.');
  }
  if (!parsed.success) return fail(400, 'Send a few notes.');
  const notes = parsed.data.notes.filter((n) => n.works.trim() || n.doesNotWork.trim());
  if (!notes.length) return Response.json({ rules: {} }, { headers });

  const reservation = await reserveLearning(await visitorKey(clientIp(request.headers)));
  if (!reservation.ok) return fail(429, 'Drafting is done for today.');

  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      ...(FALLBACK_MODELS.includes(MODEL)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'medium', format: betaZodOutputFormat(learnSchema) },
      system: learnSystem,
      messages: [{ role: 'user', content: learnPrompt(notes) }],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] learn ${response.model} $${spent.toFixed(5)} ${response.stop_reason}`);
    if (response.stop_reason === 'refusal') return fail(422, 'No draft for these notes.');
    if (!response.parsed_output) return fail(502, 'No draft this time.');
    return Response.json(
      {
        rules: cleanLearnings(
          response.parsed_output,
          notes.map((n) => n.id),
        ),
      },
      { headers },
    );
  } catch (error) {
    console.error('[pin] learn', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No draft this time.');
  } finally {
    await settleLearning(reservation, spent).catch((e) => console.error('[pin] settle', e));
  }
}
