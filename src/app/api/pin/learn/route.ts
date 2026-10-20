import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { accessOf } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import {
  reserveLearning,
  reservePreview,
  settleLearning,
  settlePreview,
} from '@/lib/pin/ai-budget';
import {
  cleanReading,
  learnPrompt,
  learnRequestSchema,
  learnSchema,
  learnSystem,
  PREVIEW_RULES,
  previewReading,
} from '@/lib/pin/learn';
import { clientIp } from '@/lib/pin/visitor';

/*
 * Reading notes into rules (D87): POST JSON { notes: [{ id, works,
 * doesNotWork, label?, topics, source? }], rules: [{ id, text, context,
 * topics, status }], shown }, the library's new notes and its rules, only
 * their words. Get back { strengthen: [{ rule, notes }], propose: [{ rule,
 * context, topics, notes, conflictsWith?, conflict?, locked? }], preview }.
 * Anyone may ask: a visitor who hasn't bought Pinch gets a preview, the first
 * rules in full and the rest without their words, on a smaller daily cap.
 * Nothing is stored, and no note text is logged. Off with PIN_LEARN=0,
 * PIN_AI=0, or without an API key.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = process.env.PIN_LEARN_MODEL ?? 'claude-opus-5-5';
/** Models the server-side refusal fallback takes; any other declines with no rule. */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const MAX_BODY = 200_000;
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
  if (!available()) return fail(503, 'Rules are off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');

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
  const rules = parsed.data.rules.filter((r) => r.text.trim());
  if (!notes.length) return Response.json({ strengthen: [], propose: [] }, { headers });

  const { paywall, allowed } = await accessOf(request);
  const preview = paywall && !allowed;
  const visitor = await visitorKey(clientIp(request.headers));
  const reservation = await (preview ? reservePreview : reserveLearning)(visitor);
  if (!reservation.ok)
    return fail(
      429,
      preview
        ? 'That’s all the rules Pinch reads for a visitor today. Get Pinch to read the rest.'
        : 'Pinch has read all it can for today. The rest are read tomorrow.',
    );

  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...(FALLBACK_MODELS.includes(MODEL)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'medium', format: betaZodOutputFormat(learnSchema) },
      system: learnSystem,
      messages: [{ role: 'user', content: learnPrompt({ notes, rules }) }],
    });
    spent = costUsd(response.model, response.usage);
    console.log(
      `[pin] learn ${preview ? 'preview ' : ''}${response.model} $${spent.toFixed(5)} ${response.stop_reason}`,
    );
    if (response.stop_reason === 'refusal') return fail(422, 'No rules from these notes.');
    if (!response.parsed_output) return fail(502, 'No rules this time. Try again.');
    const reading = cleanReading(
      response.parsed_output,
      notes.map((n) => n.id),
      rules.map((r) => r.id),
    );
    return Response.json(
      preview
        ? {
            ...previewReading(reading, Math.max(0, PREVIEW_RULES - parsed.data.shown)),
            preview: true,
          }
        : { ...reading, preview: false },
      { headers },
    );
  } catch (error) {
    console.error('[pin] learn', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No rules this time. Try again.');
  } finally {
    await (preview ? settlePreview : settleLearning)(reservation, spent).catch((e) =>
      console.error('[pin] settle', e),
    );
  }
}
