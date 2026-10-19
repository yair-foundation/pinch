import { updateDocument } from '@/lib/blob-doc';
import { type DayLedger, refusal } from '@/lib/budget';

/*
 * Pinch's AI steps are free and need no account, so each has its own daily
 * cap: one ledger per UTC day in the private
 * Blob store, changed by compare-and-swap. A call reserves its worst case
 * and settles to what it really cost.
 */

type Caps = { usd: number; perVisitor: number; requests: number };

const EMPTY: DayLedger = { usd: 0, requests: 0, visitors: {} };
const today = (now: Date) => now.toISOString().slice(0, 10);

function dailyLedger(key: (day: string) => string, reserveUsd: number, caps: Caps) {
  const reserve = async (visitor: string, now = new Date()) => {
    const day = today(now);
    return updateDocument(
      key(day),
      EMPTY,
      (ledger) => {
        const reason = refusal(ledger, visitor, reserveUsd, caps);
        if (reason) return { ok: false as const, reason };
        ledger.usd += reserveUsd;
        ledger.requests += 1;
        ledger.visitors[visitor] = (ledger.visitors[visitor] ?? 0) + 1;
        return { ok: true as const, day };
      },
      'Busy. Try again.',
    );
  };
  const settle = async (day: string, actualUsd: number) => {
    await updateDocument(
      key(day),
      EMPTY,
      (ledger) => {
        ledger.usd = Math.max(0, ledger.usd - reserveUsd + actualUsd);
      },
      'Busy. Try again.',
    );
  };
  return { reserve, settle };
}

/** "Find in image": one image of up to 1568px and a short note, with room for the answer. */
export const PIN_CAPS = {
  usd: Number(process.env.PIN_AI_DAILY_USD ?? 3),
  perVisitor: Number(process.env.PIN_AI_PER_VISITOR ?? 60),
  requests: Number(process.env.PIN_AI_CALLS_PER_DAY ?? 300),
};
export const RESERVE_USD = 0.08;
const locateLedger = dailyLedger((day) => `pin-notes/ai/${day}.json`, RESERVE_USD, PIN_CAPS);
export const reserveCall = locateLedger.reserve;
export const settleCall = locateLedger.settle;

/** Suggestions: one small crop to a small model, many per session. */
export const SUGGEST_CAPS = {
  usd: Number(process.env.PIN_SUGGEST_DAILY_USD ?? 2),
  perVisitor: Number(process.env.PIN_SUGGEST_PER_VISITOR ?? 300),
  requests: Number(process.env.PIN_SUGGEST_CALLS_PER_DAY ?? 4000),
};
export const SUGGEST_RESERVE_USD = 0.004;
const suggestLedger = dailyLedger(
  (day) => `pin-notes/suggest/${day}.json`,
  SUGGEST_RESERVE_USD,
  SUGGEST_CAPS,
);
export const reserveSuggestion = suggestLedger.reserve;
export const settleSuggestion = suggestLedger.settle;
