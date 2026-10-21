/*
 * Credits (D98): one offer, 2,000 credits for $19.99 that never expire, and
 * 200 free. An update, the author's click on Update rules, costs 20 credits
 * and 3 for each note it reads, close-ups included: a reading costs a fixed
 * part per call and a little per note (docs/cost-bench.md), and the price
 * follows both. The price is worked out before the update and taken whole;
 * if it stops partway, the credits for the notes it didn't read come back.
 *
 * Nothing here stores a balance. It is worked out each time from what was
 * granted (the free credits and each paid order) and what each update took,
 * so a refund, a late webhook or an update that never finished can't leave
 * it wrong. Pure, for tests.
 */

export const UPDATE_CREDITS = 20;
export const NOTE_CREDITS = 3;
export const PACK_CREDITS = 2000;
export const FREE_CREDITS = 200;
/** The free credits' grant id: they are spent first, even when a pack was bought before them. */
export const FREE_GRANT = 'free';

/** An update still running after this long has stopped: it takes only what it read. */
export const STALE_MS = 60 * 60 * 1000;

/** What an update of `notes` new or changed notes costs; nothing for none. */
export const updatePrice = (notes: number) =>
  notes > 0 ? UPDATE_CREDITS + NOTE_CREDITS * notes : 0;

/** Credits given: the free ones, or a paid order, and when that order was refunded. */
export type Grant = { id: string; credits: number; at: string; refundedAt?: string };

/**
 * One click on Update rules: how many notes it set out to read, how many its calls have taken
 * on (read, or being read now), and how many it has read.
 */
export type Update = {
  id: string;
  at: string;
  notes: number;
  read: number;
  /** Ledgers from before claiming count only what was read. */
  claimed?: number;
  done: boolean;
};

/** What an update takes: its whole price while it runs, then the price of what it read. */
export function takenBy(u: Update, now: number): number {
  const running = !u.done && now - Date.parse(u.at) < STALE_MS;
  return updatePrice(running ? u.notes : Math.min(u.read, u.notes));
}

/**
 * The credits left, worked out in time order: each grant joins the queue, each
 * update draws on the oldest grant with credits left (the free ones before
 * any pack), and a refund takes back only what is left of its
 * order. What was used of a refunded order stays used, never a debt, so a
 * later pack gives all it says.
 */
export function balanceOf(grants: Grant[], updates: Update[], now: number): number {
  type Event =
    | { at: string; order: number; kind: 'grant'; grant: Grant }
    | { at: string; order: number; kind: 'refund'; id: string }
    | { at: string; order: number; kind: 'spend'; credits: number };
  const events: Event[] = [
    ...grants.map((grant) => ({
      at: grant.id === FREE_GRANT ? '' : grant.at,
      order: 0,
      kind: 'grant' as const,
      grant,
    })),
    ...grants
      .filter((g) => g.refundedAt)
      .map((g) => ({ at: g.refundedAt as string, order: 1, kind: 'refund' as const, id: g.id })),
    ...updates.map((u) => ({
      at: u.at,
      order: 2,
      kind: 'spend' as const,
      credits: takenBy(u, now),
    })),
  ];
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));
  const left = new Map<string, number>();
  for (const e of events) {
    if (e.kind === 'grant') left.set(e.grant.id, e.grant.credits);
    else if (e.kind === 'refund') left.set(e.id, 0);
    else {
      let owed = e.credits;
      for (const [id, credits] of left) {
        if (owed <= 0) break;
        const take = Math.min(credits, owed);
        left.set(id, credits - take);
        owed -= take;
      }
    }
  }
  return [...left.values()].reduce((a, b) => a + b, 0);
}

/** Whether an update of `notes` notes can start: its whole price must be there. */
export const canUpdate = (grants: Grant[], updates: Update[], notes: number, now: number) =>
  updatePrice(notes) <= balanceOf(grants, updates, now);
