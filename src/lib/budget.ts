/*
 * What the AI steps cost and who is asking: the price list, the shape of a
 * day's ledger, the refusal test and the visitor key. The ledgers themselves
 * (one per AI step, per UTC day) are in `pin/ai-budget.ts`.
 *
 * A request first reserves its worst-case cost; after the model answers, the
 * reservation is settled to the real cost from the usage report. So a cap
 * holds even while requests are in flight.
 */

export type DayLedger = {
  usd: number;
  requests: number;
  visitors: Record<string, number>;
};

/** USD per million tokens. Unknown models are priced at the most expensive, so the cap errs safe. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
const FALLBACK_PRICE = { input: 10, output: 50, cacheRead: 1 };

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  cache_creation_input_tokens?: number | null;
};

/** What one response cost. Cache writes: 1.25× input for 5 minutes, 2× for an hour. */
export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const n = (v?: number | null) => (typeof v === 'number' && v > 0 ? v : 0);
  const w5 = n(usage.cache_creation?.ephemeral_5m_input_tokens);
  const w1h = n(usage.cache_creation?.ephemeral_1h_input_tokens);
  // Older usage shapes report only the total; price it as the dearer 1-hour write.
  const wUnsplit = w5 + w1h === 0 ? n(usage.cache_creation_input_tokens) : 0;
  const perToken =
    n(usage.input_tokens) * p.input +
    n(usage.output_tokens) * p.output +
    n(usage.cache_read_input_tokens) * p.cacheRead +
    w5 * p.input * 1.25 +
    (w1h + wUnsplit) * p.input * 2;
  return perToken / 1_000_000;
}

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

export type Caps = { usd: number; perVisitor: number; requests: number };

/** Why a request can't start, or null if it can. Pure, for tests. */
export function refusal(
  ledger: DayLedger,
  visitor: string,
  reserveUsd: number,
  caps: Caps,
): 'budget' | 'visitor' | 'busy' | null {
  if (ledger.usd + reserveUsd > caps.usd) return 'budget';
  if ((ledger.visitors[visitor] ?? 0) >= caps.perVisitor) return 'visitor';
  if (ledger.requests >= caps.requests) return 'busy';
  return null;
}

/**
 * A visitor key that isn't the raw IP: a salted hash, kept only in a day's
 * ledger to count a visitor's calls. VISITOR_SALT changes the keys; the
 * default is fine, since the ledgers are private and live a day.
 */
export async function visitorKey(ip: string): Promise<string> {
  const salt = process.env.VISITOR_SALT ?? 'pinch';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Buffer.from(bytes).toString('base64url').slice(0, 16);
}
