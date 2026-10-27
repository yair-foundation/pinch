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
/**
 * Characters of note text one day's document takes, and one visitor sends in
 * a day, re-sent edits included: a bound on what a script can push through
 * the route, since a re-sent id replaces its text without counting as new.
 */
export const DAY_BYTES = 6_000_000;
export const VISITOR_BYTES = 1_000_000;
export const KEEP_DAYS = 90;

/** The longest each field may be; the page's fields stop there too. */
export const MAX_LABEL = 60;
export const MAX_FIELD = 1000;
export const MAX_TEXT = 2000;

const id = z.string().regex(/^[a-z0-9]{4,32}$/);
const use = z.enum(['as-is', 'edited']);

export const logEntrySchema = z.object({
  /** The note's random id; "o" and the image's id for an image's overall note. */
  id,
  /** The image's random id, to group notes on one image. */
  image: id,
  kind: z.enum(['note', 'overall']),
  label: z.string().max(MAX_LABEL).optional(),
  works: z.string().max(MAX_FIELD).optional(),
  doesNotWork: z.string().max(MAX_FIELD).optional(),
  /** An overall note's text. */
  text: z.string().max(MAX_TEXT).optional(),
  shape: z.enum(['dot', 'area', 'arrow']).optional(),
  origin: z.enum(['user', 'ai', 'voice']).optional(),
  aiSuggested: z.object({ works: use.optional(), doesNotWork: use.optional() }).optional(),
  source: z.enum(SOURCES.map((s) => s.kind) as [SourceKind, ...SourceKind[]]).optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

export const logBatchSchema = z.object({
  entries: z.array(logEntrySchema).min(1).max(MAX_BATCH),
});

const FIELD_MAX: Record<'label' | 'works' | 'doesNotWork' | 'text', number> = {
  label: MAX_LABEL,
  works: MAX_FIELD,
  doesNotWork: MAX_FIELD,
  text: MAX_TEXT,
};

/** An entry as sent, its text fields cut to their limits; anything else is left for the schema. */
function clampStrings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const entry = { ...(raw as Record<string, unknown>) };
  for (const [field, max] of Object.entries(FIELD_MAX)) {
    const v = entry[field];
    if (typeof v === 'string' && v.length > max) entry[field] = v.slice(0, max);
  }
  return entry;
}

/**
 * The batch as the route takes it: an over-long field is cut to its limit
 * rather than failing the batch, since the page retries a failed batch on
 * every change and one long note would keep every other note from being
 * saved. Everything else (ids, kinds, the batch size) stays strict.
 */
export const incomingBatchSchema = z.preprocess(
  (raw) =>
    raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
      ? { ...raw, entries: (raw as { entries: unknown[] }).entries.map(clampStrings) }
      : raw,
  logBatchSchema,
);

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
  /** Characters of entries taken today, in all and per hashed visitor; absent on days saved before the cap. */
  bytes?: number;
  visitorBytes?: Record<string, number>;
};

export const emptyLogDay = (): LogDay => ({ entries: {}, visitors: {} });

const cut = (s: string, max: number) => s.trim().slice(0, max).trim();

function markEntry(a: Asset, m: Mark): LogEntry {
  const works = suggestionUse(m, 'good');
  const doesNotWork = suggestionUse(m, 'bad');
  const label = cut(m.label, MAX_LABEL);
  const good = cut(m.good, MAX_FIELD);
  const bad = cut(m.bad, MAX_FIELD);
  return {
    id: m.id,
    image: a.id,
    kind: 'note',
    ...(label ? { label } : {}),
    ...(good ? { works: good } : {}),
    ...(bad ? { doesNotWork: bad } : {}),
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

/**
 * Every written note in the session, as the browser sends it: each field cut
 * to its limit (`MAX_*`), so no batch can fail the schema on length, and
 * nothing with no words in it.
 */
export function logEntries(assets: Asset[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const a of assets) {
    const text = cut(a.note, MAX_TEXT);
    if (text)
      out.push({
        id: `o${a.id}`.slice(0, 32),
        image: a.id,
        kind: 'overall',
        text,
        ...sourceOf(a),
      });
    for (const m of a.marks) {
      if (verdictOf(m) === 'empty') continue;
      const entry = markEntry(a, m);
      if (entry.works || entry.doesNotWork) out.push(entry);
    }
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

export type LogCaps = { day: number; visitor: number; dayBytes: number; visitorBytes: number };
export const LOG_CAPS: LogCaps = {
  day: DAY_CAP,
  visitor: VISITOR_CAP,
  dayBytes: DAY_BYTES,
  visitorBytes: VISITOR_BYTES,
};

/** What a batch adds to the day's text: the characters of its entries as stored. */
const sizeOf = (entries: LogEntry[]) =>
  entries.reduce((n, e) => n + JSON.stringify(e).length, 0);

/**
 * Add a batch to a day's document; an id seen before is replaced and isn't
 * counted again as a new note, but its characters count every time, so
 * re-sending can't go on without limit.
 */
export function addToDay(
  doc: LogDay,
  entries: LogEntry[],
  visitor: string,
  at: string,
  caps: LogCaps = LOG_CAPS,
): { saved: number } | { refused: 'day' | 'visitor' } {
  const fresh = entries.filter((e) => !doc.entries[e.id]).length;
  const size = sizeOf(entries);
  if (Object.keys(doc.entries).length + fresh > caps.day) return { refused: 'day' };
  if ((doc.bytes ?? 0) + size > caps.dayBytes) return { refused: 'day' };
  if ((doc.visitors[visitor] ?? 0) + fresh > caps.visitor) return { refused: 'visitor' };
  if ((doc.visitorBytes?.[visitor] ?? 0) + size > caps.visitorBytes) return { refused: 'visitor' };
  for (const e of entries) doc.entries[e.id] = { ...e, at };
  if (fresh) doc.visitors[visitor] = (doc.visitors[visitor] ?? 0) + fresh;
  doc.bytes = (doc.bytes ?? 0) + size;
  doc.visitorBytes ??= {};
  doc.visitorBytes[visitor] = (doc.visitorBytes[visitor] ?? 0) + size;
  return { saved: entries.length };
}

/** Days older than `keep` days before `today` (both YYYY-MM-DD). */
export function expiredDays(days: string[], today: string, keep = KEEP_DAYS): string[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keep);
  const limit = cutoff.toISOString().slice(0, 10);
  return days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < limit);
}
