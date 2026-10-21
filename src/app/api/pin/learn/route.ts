import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { accessOf } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { costUsd, visitorKey } from '@/lib/budget';
import { sniffImage } from '@/lib/image';
import { type BillingConfig, billingConfig } from '@/lib/billing';
import { beginUpdate, noteRead, release } from '@/lib/credits';
import { reserveFree, reserveLearning, settleFree, settleLearning } from '@/lib/pin/ai-budget';
import {
  cleanReading,
  learnContent,
  learnRequestSchema,
  learnSchema,
  learnSystem,
} from '@/lib/pin/learn';
import { clientIp } from '@/lib/pin/visitor';

/*
 * Reading notes into rules (D87): POST JSON { notes: [{ id, works,
 * doesNotWork, label?, topics, source?, crop? }], rules: [{ id, text, context,
 * topics, status }], update: { id, notes } }, the library's new notes, each
 * with its close-up (D98), and its rules' words. Get back { strengthen: [{ rule, notes }], propose:
 * [{ rule, context, topics, notes, conflictsWith?, conflict? }] }.
 *
 * Once Pinch is paid, a call belongs to an update, the author's click on
 * Update rules (D98): the first call prices the whole update (20 credits and
 * 3 a note) and holds it, each call that reads adds its notes, and what isn't
 * read comes back when the update finishes (`/api/pin/credits`). Buyers of the
 * original offer spend no credits. Every call stays under the reading's daily
 * fair-use caps. Nothing is stored here, and no note text or close-up is
 * logged. Off with
 * PIN_LEARN=0, PIN_AI=0, or without an API key.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = process.env.PIN_LEARN_MODEL ?? 'claude-opus-5-5';
/** Models the server-side refusal fallback takes; any other declines with no rule. */
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
/** A call's notes with their close-ups, as the page sizes them, and the rules (D98). */
const MAX_BODY = 4_000_000;
const MAX_CROP_BYTES = 150_000;
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
  // A close-up goes with its note only if it is a JPEG of a close-up's size (D98); else the
  // note is read from its words.
  const crops = notes.flatMap((n) => {
    if (!n.crop) return [];
    const bytes = Buffer.from(n.crop, 'base64');
    return bytes.length <= MAX_CROP_BYTES && sniffImage(bytes) === 'image/jpeg'
      ? [{ id: n.id, jpeg: n.crop }]
      : [];
  });
  if (!notes.length) return Response.json({ strengthen: [], propose: [] }, { headers });

  const { paywall, session, browser, credits } = await accessOf(request);
  const update = parsed.data.update;
  const charged = paywall && credits && !credits.original ? credits : null;
  if (charged) {
    if (!update) return fail(400, 'Update rules to read them.');
    // A visitor's credits live with this browser's id: without it, every call would start afresh.
    if (!session && browser.setCookie) return fail(400, 'Reload Pinch and try again.');
    const begun = await beginUpdate(
      charged,
      billingConfig() as BillingConfig,
      update.id,
      update.notes,
      notes.length,
    );
    if (!begun.ok) return fail(begun.status, begun.error);
  }
  // Free credits read on their own, smaller ledger, so fresh browsers can't spend what buyers'
  // updates need (D98).
  const free = Boolean(credits && !credits.original && !credits.bought);
  const visitor = await visitorKey(clientIp(request.headers));
  const reservation = await (free ? reserveFree : reserveLearning)(visitor);
  if (!reservation.ok) {
    if (charged && update) await release(charged.owner, update.id, notes.length);
    return fail(429, 'Pinch has read all it can for today. The rest are read tomorrow.');
  }

  let spent = 0;
  let read = false;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...(FALLBACK_MODELS.includes(MODEL)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: { effort: 'medium', format: betaZodOutputFormat(learnSchema) },
      // The instructions are the same for every author, so they stay cached while anyone reads (D97).
      system: [{ type: 'text', text: learnSystem, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: learnContent({ notes, rules }, crops) }],
    });
    spent = costUsd(response.model, response.usage);
    console.log(`[pin] learn ${response.model} $${spent.toFixed(5)} ${response.stop_reason}`);
    if (response.stop_reason === 'refusal') return fail(422, 'No rules from these notes.');
    if (!response.parsed_output) return fail(502, 'No rules this time. Try again.');
    const reading = cleanReading(
      response.parsed_output,
      notes.map((n) => n.id),
      rules.map((r) => r.id),
    );
    // A reading that came back counts its notes as read; one that failed or was refused gives
    // them back, to be read again.
    if (charged && update) await noteRead(charged.owner, update.id, notes.length);
    read = true;
    return Response.json(reading, { headers });
  } catch (error) {
    console.error('[pin] learn', error);
    if (error instanceof Anthropic.RateLimitError) return fail(429, 'Busy. Try again in a minute.');
    return fail(502, 'No rules this time. Try again.');
  } finally {
    if (charged && update && !read)
      await release(charged.owner, update.id, notes.length).catch((e) =>
        console.error('[pin] release', (e as Error).message),
      );
    await (free ? settleFree : settleLearning)(reservation, spent).catch((e) =>
      console.error('[pin] settle', e),
    );
  }
}
