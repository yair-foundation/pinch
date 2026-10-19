import { del, list } from '@vercel/blob';
import { readDocument, updateDocument } from '@/lib/blob-doc';
import { addToDay, emptyLogDay, expiredDays, type LogDay, type LogEntry } from './notes-log';
import { carriedTags, needsTagging, type Taggable, type Tags, tagText, textKey } from './notes-tags';

/*
 * Where the saved note text lives: `pin-notes/text/<day>.json` in the private
 * Blob store (in memory without Blob credentials). The first write of a day
 * deletes the days past the retention window. Area tags (`notes-tags.ts`) are
 * written into the same document after the save, keyed by the note's id.
 */

const PREFIX = 'pin-notes/text/';
const key = (day: string) => `${PREFIX}${day}.json`;
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const memoryDays = new Set<string>();

/**
 * Saves a batch. With it: the day it went to and the notes whose text is new
 * or changed, for tagging after the response. A re-sent note keeps its tags
 * only while they describe its current text.
 */
export async function saveNotes(entries: LogEntry[], visitor: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  // Minutes are enough to order notes; nothing finer is kept.
  const at = `${now.toISOString().slice(0, 16)}Z`;
  let first = false;
  const toTag: Taggable[] = [];
  const result = await updateDocument(
    key(day),
    emptyLogDay(),
    (doc) => {
      first = Object.keys(doc.entries).length === 0;
      toTag.length = 0;
      const before = entries.map((e) => [e.id, doc.entries[e.id]] as const);
      const added = addToDay(doc, entries, visitor, at);
      if (!('saved' in added)) return added;
      for (const [id, previous] of before) {
        const saved = doc.entries[id];
        const kept = carriedTags(saved, previous);
        if (kept) saved.tags = kept;
        if (needsTagging(saved, previous)) toTag.push({ id, text: tagText(saved) });
      }
      return added;
    },
    'Busy. Try again.',
  );
  if ('saved' in result) {
    memoryDays.add(day);
    if (first) await prune(day).catch((e) => console.error('[pin] prune notes', e));
    return { ...result, day, toTag };
  }
  return result;
}

/**
 * Writes tags into a day's document, each only onto the note it was made
 * for: the note must still exist and still carry the text the tags describe.
 * Returns how many were written.
 */
export async function writeTags(day: string, tags: Record<string, Tags>): Promise<number> {
  return updateDocument(
    key(day),
    emptyLogDay(),
    (doc) => {
      let written = 0;
      for (const [id, t] of Object.entries(tags)) {
        const e = doc.entries[id];
        if (!e || textKey(tagText(e)) !== t.for) continue;
        e.tags = t;
        written += 1;
      }
      return written;
    },
    'Busy. Try again.',
  );
}

/** The saved days of one month (YYYY-MM), each with its document. */
export async function readMonth(month: string): Promise<Record<string, LogDay>> {
  const days = (await savedDays()).filter((d) => d.startsWith(`${month}-`));
  const docs = await Promise.all(days.map((d) => readNotes(d)));
  return Object.fromEntries(days.map((d, i) => [d, docs[i]]));
}

export async function savedDays(): Promise<string[]> {
  if (!hasBlob()) return [...memoryDays].sort();
  const days: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      if (m) days.push(m[1]);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return days.sort();
}

export const readNotes = async (day: string): Promise<LogDay> =>
  (await readDocument(key(day), emptyLogDay())).doc;

async function prune(today: string) {
  const old = expiredDays(await savedDays(), today);
  if (!old.length) return;
  if (hasBlob()) await del(old.map(key));
  for (const d of old) memoryDays.delete(d);
}
