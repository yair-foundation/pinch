import { updateDocument } from '@/lib/blob-doc';
import { askJevQuestions } from '@/lib/jev';
import { writeTags } from './notes-store';
import { areaQuestions, grantCalls, type Taggable, type Tags, textKey, toTags } from './notes-tags';

/*
 * The calls to Jev that tag saved notes by area, run after a save has been
 * answered (`after()` in the notes route), so the page never waits. One pass
 * per save: the notes whose text is new or changed, a few at a time, then one
 * write of the tags into the day's document. A failed or timed-out call
 * leaves its note untagged; it is tried again only when the note's text
 * changes and is saved again, never in a loop.
 *
 * Off without JEV_API_KEY or with PIN_TAGS=0, and never in the way of saving.
 * A ledger per UTC day (`pin-notes/tags/<day>.json`) caps the calls so a
 * flood of notes can't run up TypeSafe usage.
 */

/** Jev calls per UTC day, across every save. */
export const TAG_CALLS_PER_DAY = Number(process.env.PIN_TAG_CALLS_PER_DAY ?? 2000);
/** Calls in flight at once within one save's pass. */
export const CONCURRENCY = 4;

export const tagsEnabled = () => Boolean(process.env.JEV_API_KEY) && process.env.PIN_TAGS !== '0';

type Ledger = { requests: number };
const EMPTY: Ledger = { requests: 0 };
const ledgerKey = (day: string) => `pin-notes/tags/${day}.json`;

/** Reserves up to `wanted` calls from today's cap in one compare-and-swap; returns how many were granted. */
export async function reserveTagCalls(wanted: number, now = new Date(), cap = TAG_CALLS_PER_DAY) {
  return updateDocument(
    ledgerKey(now.toISOString().slice(0, 10)),
    EMPTY,
    (ledger) => {
      const granted = grantCalls(ledger.requests, wanted, cap);
      ledger.requests += granted;
      return granted;
    },
    'Busy. Try again.',
  );
}

/** Asks Jev about one note's text. Null when it failed, so the note stays untagged. */
export async function tagOne(text: string): Promise<Tags | null> {
  const reply = await askJevQuestions({ text }, areaQuestions());
  if (!reply.ok) {
    console.warn('[pin] tag', reply.error);
    return null;
  }
  return toTags(reply.answers, reply.model, textKey(text));
}

/** Runs `work` over `items`, at most `limit` at a time, keeping the order. */
async function inBatches<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Tags the notes saved on `day`: as many as today's cap still allows, the
 * rest skipped until their text changes again. Never throws.
 */
export async function tagSavedNotes(day: string, toTag: Taggable[], now = new Date()) {
  if (!tagsEnabled() || !toTag.length) return { tagged: 0, skipped: toTag.length };
  try {
    const granted = await reserveTagCalls(toTag.length, now);
    const batch = toTag.slice(0, granted);
    const results = await inBatches(batch, CONCURRENCY, (t) => tagOne(t.text));
    const tags: Record<string, Tags> = {};
    batch.forEach((t, i) => {
      const r = results[i];
      if (r) tags[t.id] = r;
    });
    const tagged = Object.keys(tags).length ? await writeTags(day, tags) : 0;
    return { tagged, skipped: toTag.length - tagged };
  } catch (error) {
    console.error('[pin] tag notes', error);
    return { tagged: 0, skipped: toTag.length };
  }
}
