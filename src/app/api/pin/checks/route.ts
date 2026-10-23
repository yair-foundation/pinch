import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { accessOf } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import { reserveFree, reserveLearning, settleFree, settleLearning } from '@/lib/pin/ai-budget';
import {
  checksPrompt,
  checksRequestSchema,
  checksSchema,
  checksSystem,
  cleanChecks,
} from '@/lib/pin/checks';
import { clientIp } from '@/lib/pin/visitor';

/*
 * Render checks worked out from the rules (D109): POST JSON { rules: [{ id, text, where?, notes? }] },
 * the rules' words and their notes' words only, and get back { checks: [...] }, at most one per
 * kind, each tied to the rules it holds. Your rules asks in the background when the rules change
 * and before an export; the author never sees them.
 * Free, like titles: on the reading's daily ledgers (the free one for those who haven't bought),
 * taking no credits. Nothing is stored, and no rule or note text is logged. Off whenever reading
 * is off.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = process.env.PIN_CHECKS_MODEL ?? 'claude-opus-5-5';
/** Models the server-side refusal fallback takes. */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const MAX_BODY = 600_000;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const available = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  process.env.PIN_AI !== '0' &&
  process.env.PIN_LEARN !== '0';
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (!available()) return fail(503, 'Checks are off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');

  const body = await request.text().catch(() => '');
  if (!body || body.length > MAX_BODY) return fail(400, 'Send your rules.');
  let parsed: ReturnType<typeof checksRequestSchema.safeParse>;
  try {
    parsed = checksRequestSchema.safeParse(JSON.parse(body));
  } catch {
    return fail(400, 'Send your rules.');
  }
  if (!parsed.success) return fail(400, 'Send your rules.');
  const rules = parsed.data.rules.filter((r) => r.text.trim());
  if (!rules.length) return Response.json({ checks: [] }, { headers });

  // Those who haven't bought are on the free ledger, so they can't spend buyers' (D98).
  const { credits } = await accessOf(request);
  const free = Boolean(credits && !credits.original && !credits.bought);
  const reservation = await (free ? reserveFree : reserveLearning)(
    await visitorKey(clientIp(request.headers)),
  );
  if (!reservation.ok) return fail(429, 'Pinch has worked out all it can for today.');
  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...(FALLBACK_MODELS.includes(MODEL)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'medium', format: betaZodOutputFormat(checksSchema) },
      // The instructions are the same for every author, so they stay cached.
      system: [{ type: 'text', text: checksSystem, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: checksPrompt(rules) }],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] checks ${response.model} $${spent.toFixed(5)} ${response.stop_reason}`);
    if (response.stop_reason === 'refusal') return fail(422, 'No checks from these rules.');
    if (!response.parsed_output) return fail(502, 'No checks this time. Try again.');
    const checks = cleanChecks(
      response.parsed_output,
      rules.map((r) => r.id),
    );
    return Response.json({ checks }, { headers });
  } catch (error) {
    console.error('[pin] checks', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No checks this time. Try again.');
  } finally {
    await (free ? settleFree : settleLearning)(reservation, spent).catch((e) =>
      console.error('[pin] settle', e),
    );
  }
}
