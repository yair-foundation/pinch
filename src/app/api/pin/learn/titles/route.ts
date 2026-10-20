import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { accessOf } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import { reserveLearning, settleLearning } from '@/lib/pin/ai-budget';
import {
  cleanTitles,
  titlesPrompt,
  titlesRequestSchema,
  titlesSchema,
  titlesSystem,
} from '@/lib/pin/learn';
import { clientIp } from '@/lib/pin/visitor';

/*
 * Titles for rules that have none (D95): POST JSON { rules: [{ id, text }] },
 * only the rules' words, and get back { titles: [{ id, title }] }. For those
 * Pinch is open to (bought, or not for sale here); a small model, on the
 * reading's daily ledger. Nothing is stored, and no rule text is logged. Off
 * whenever reading is off.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = process.env.PIN_TITLE_MODEL ?? 'claude-haiku-5-5';
const MAX_BODY = 40_000;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const available = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  process.env.PIN_AI !== '0' &&
  process.env.PIN_LEARN !== '0';
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (!available()) return fail(503, 'Titles are off right now.');
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const { allowed } = await accessOf(request);
  if (!allowed) return fail(402, 'Titles are part of Pinch.');

  const body = await request.text().catch(() => '');
  if (!body || body.length > MAX_BODY) return fail(400, 'Send a few rules.');
  let parsed: ReturnType<typeof titlesRequestSchema.safeParse>;
  try {
    parsed = titlesRequestSchema.safeParse(JSON.parse(body));
  } catch {
    return fail(400, 'Send a few rules.');
  }
  if (!parsed.success) return fail(400, 'Send a few rules.');
  const rules = parsed.data.rules.filter((r) => r.text.trim());
  if (!rules.length) return Response.json({ titles: [] }, { headers });

  const reservation = await reserveLearning(await visitorKey(clientIp(request.headers)));
  if (!reservation.ok) return fail(429, 'Pinch has named all it can for today.');
  let spent = 0;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: betaZodOutputFormat(titlesSchema) },
      system: titlesSystem,
      messages: [{ role: 'user', content: titlesPrompt(rules) }],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] titles ${response.model} $${spent.toFixed(5)} ${response.stop_reason}`);
    if (!response.parsed_output) return fail(502, 'No titles this time.');
    const titles = cleanTitles(
      response.parsed_output,
      rules.map((r) => r.id),
    );
    return Response.json({ titles }, { headers });
  } catch (error) {
    console.error('[pin] titles', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No titles this time.');
  } finally {
    await settleLearning(reservation, spent).catch((e) => console.error('[pin] settle', e));
  }
}
