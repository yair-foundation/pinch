import { z } from 'zod';
import { type Asset, type Mark, SOURCES, type SourceKind, suggestionUse, verdictOf } from './model';

/*
 * Pinch keeps the text of the notes people write, anonymously, to learn what
 * designers say about screens: no images, no file names, no links, no
 * "made by", no IP address. One document per UTC day in the private Blob store, each note
 * stored under its random id, so an edited note replaces its earlier text.
 * Kept for KEEP_DAYS days. This file is the pure part: what the browser
 * sends, and how a day's document takes it.
 */

export const MAX_BATCH = 40;
/** Notes one day's document holds, and new notes one visitor adds in a day. */
export const DAY_CAP = 3000;
export const VISITOR_CAP = 600;
export const KEEP_DAYS = 90;

const id = z.string().regex(/^[a-z0-9]{4,32}$/);
const use = z.enum(['as-is', 'edited']);

export const logEntrySchema = z.object({
  /** The note's random id; "o" and the image's id for an image's overall note. */
  id,
  /** The image's random id, to group notes on one image. */
  image: id,
  kind: z.enum(['note', 'overall']),
  label: z.string().max(60).optional(),
  works: z.string().max(1000).optional(),
  doesNotWork: z.string().max(1000).optional(),
  /** An overall note's text. */
  text: z.string().max(2000).optional(),
  shape: z.enum(['dot', 'area', 'arrow']).optional(),
  origin: z.enum(['user', 'ai']).optional(),
  aiSuggested: z.object({ works: use.optional(), doesNotWork: use.optional() }).optional(),
  source: z.enum(SOURCES.map((s) => s.kind) as [SourceKind, ...SourceKind[]]).optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

export const logBatchSchema = z.object({
  entries: z.array(logEntrySchema).min(1).max(MAX_BATCH),
});

export type LogDay = {
  entries: Record<
    string,
    LogEntry & {
      at: string;
      /** Set by the server after saving (`notes-tags.ts`), never taken from the browser. */
      tags?: { areas: string[]; scores: Record<string, number>; model: string; for: string };
    }
  >;
  /** New notes per hashed visitor today, for the cap; not linked to any note. */
  visitors: Record<string, number>;
};

export const emptyLogDay = (): LogDay => ({ entries: {}, visitors: {} });

function markEntry(a: Asset, m: Mark): LogEntry {
  const works = suggestionUse(m, 'good');
  const doesNotWork = suggestionUse(m, 'bad');
  return {
    id: m.id,
    image: a.id,
    kind: 'note',
    ...(m.label.trim() ? { label: m.label.trim() } : {}),
    ...(m.good.trim() ? { works: m.good.trim() } : {}),
    ...(m.bad.trim() ? { doesNotWork: m.bad.trim() } : {}),
    shape: m.shape.kind,
    origin: m.origin,
    ...(works || doesNotWork
      ? { aiSuggested: { ...(works ? { works } : {}), ...(doesNotWork ? { doesNotWork } : {}) } }
      : {}),
    ...sourceOf(a),
  };
}

// The kind only: "made by" and the link can name a person, so they stay in the browser.
const sourceOf = (a: Asset) => (a.source ? { source: a.source.kind } : {});

/** Every written note in the session, as the browser sends it. */
export function logEntries(assets: Asset[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const a of assets) {
    if (a.note.trim())
      out.push({
        id: `o${a.id}`.slice(0, 32),
        image: a.id,
        kind: 'overall',
        text: a.note.trim(),
        ...sourceOf(a),
      });
    for (const m of a.marks) if (verdictOf(m) !== 'empty') out.push(markEntry(a, m));
  }
  return out;
}

/** A short fingerprint of an entry (53-bit string hash), to tell whether it changed since it was sent. */
export function fingerprint(e: LogEntry): string {
  const s = JSON.stringify(e);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The entries not sent as they are now. `sent` maps an id to the fingerprint last sent for it. */
export const changedEntries = (entries: LogEntry[], sent: Record<string, string>) =>
  entries.filter((e) => sent[e.id] !== fingerprint(e));

/** Add a batch to a day's document; an id seen before is replaced and isn't counted again. */
export function addToDay(
  doc: LogDay,
  entries: LogEntry[],
  visitor: string,
  at: string,
  caps = { day: DAY_CAP, visitor: VISITOR_CAP },
): { saved: number } | { refused: 'day' | 'visitor' } {
  const fresh = entries.filter((e) => !doc.entries[e.id]).length;
  if (Object.keys(doc.entries).length + fresh > caps.day) return { refused: 'day' };
  if ((doc.visitors[visitor] ?? 0) + fresh > caps.visitor) return { refused: 'visitor' };
  for (const e of entries) doc.entries[e.id] = { ...e, at };
  if (fresh) doc.visitors[visitor] = (doc.visitors[visitor] ?? 0) + fresh;
  return { saved: entries.length };
}

/** Days older than `keep` days before `today` (both YYYY-MM-DD). */
export function expiredDays(days: string[], today: string, keep = KEEP_DAYS): string[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keep);
  const limit = cutoff.toISOString().slice(0, 10);
  return days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit);
}
