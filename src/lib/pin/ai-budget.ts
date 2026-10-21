import { updateDocument } from '@/lib/blob-doc';
import { type DayLedger, refusal } from '@/lib/budget';

/*
 * Each of Pinch's AI steps has its own daily cap: one ledger per UTC day in the private
 * Blob store, changed by compare-and-swap. A call reserves its worst case
 * and settles to what it really cost. Besides the day's dollars, calls and
 * calls per visitor, no visitor may spend more than a share of the day's
 * dollars (`VISITOR_SHARE`), so one person can't use the site's budget up
 * for everyone else.
 */

export type PinCaps = { usd: number; perVisitor: number; requests: number };
/** The share of the day's dollars one visitor may spend. */
export const VISITOR_SHARE = 1 / 3;

export type PinLedger = DayLedger & {
  /** Dollars reserved or spent per hashed visitor today. Absent on ledgers from before the share. */
  spent?: Record<string, number>;
};

const EMPTY: PinLedger = { usd: 0, requests: 0, visitors: {} };
const today = (now: Date) => now.toISOString().slice(0, 10);

/** Why a call can't start, or null if it can: the shared reasons (budget, visitor, busy), then the visitor's share. Pure, for tests. */
export function pinRefusal(
  ledger: PinLedger,
  visitor: string,
  reserveUsd: number,
  caps: PinCaps,
): 'budget' | 'visitor' | 'busy' | null {
  const reason = refusal(ledger, visitor, reserveUsd, caps);
  if (reason) return reason;
  if ((ledger.spent?.[visitor] ?? 0) + reserveUsd > caps.usd * VISITOR_SHARE) return 'visitor';
  return null;
}

export type PinReservation = { day: string; visitor: string };

function dailyLedger(key: (day: string) => string, reserveUsd: number, caps: PinCaps) {
  const reserve = async (visitor: string, now = new Date()) => {
    const day = today(now);
    return updateDocument(
      key(day),
      EMPTY,
      (ledger) => {
        const reason = pinRefusal(ledger, visitor, reserveUsd, caps);
        if (reason) return { ok: false as const, reason };
        ledger.usd += reserveUsd;
        ledger.requests += 1;
        ledger.visitors[visitor] = (ledger.visitors[visitor] ?? 0) + 1;
        ledger.spent ??= {};
        ledger.spent[visitor] = (ledger.spent[visitor] ?? 0) + reserveUsd;
        return { ok: true as const, day, visitor };
      },
      'Busy. Try again.',
    );
  };
  const settle = async ({ day, visitor }: PinReservation, actualUsd: number) => {
    await updateDocument(
      key(day),
      EMPTY,
      (ledger) => {
        ledger.usd = Math.max(0, ledger.usd - reserveUsd + actualUsd);
        ledger.spent ??= {};
        ledger.spent[visitor] = Math.max(0, (ledger.spent[visitor] ?? 0) - reserveUsd + actualUsd);
      },
      'Busy. Try again.',
    );
  };
  return { reserve, settle };
}

/** Suggestions: one small crop to a small model, many per session. */
export const SUGGEST_CAPS: PinCaps = {
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

/**
 * Reading notes into rules (D87): a few dozen notes' words and the library's rules to a larger
 * model, a call or two per batch. The reservation is the worst case, a full answer of 16,000
 * tokens with its thinking and a long library, so the cap holds; a call settles to far less.
 */
export const LEARN_CAPS: PinCaps = {
  usd: Number(process.env.PIN_LEARN_DAILY_USD ?? 10),
  perVisitor: Number(process.env.PIN_LEARN_PER_VISITOR ?? 60),
  requests: Number(process.env.PIN_LEARN_CALLS_PER_DAY ?? 600),
};
export const LEARN_RESERVE_USD = 0.4;
const learnLedger = dailyLedger(
  (day) => `pin-notes/learn/${day}.json`,
  LEARN_RESERVE_USD,
  LEARN_CAPS,
);
export const reserveLearning = learnLedger.reserve;
export const settleLearning = learnLedger.settle;
