import { after } from 'next/server';
import { adminRequestAccess, adminRealm, isSameOriginWrite } from '@/lib/auth';
import { incomingBatchSchema } from '@/lib/pin/notes-log';
import { readMonth, readNotes, saveNotes, savedDays } from '@/lib/pin/notes-store';
import { tagSavedNotes, tagsEnabled } from '@/lib/pin/notes-tagger';
import { summarizeTags } from '@/lib/pin/notes-tags';
import { clientIp } from '@/lib/pin/visitor';
import { visitorKey } from '@/lib/budget';

/*
 * Pinch's saved note text (/pin). POST { entries } from the page: the text of
 * written notes, no images or names (`notes-log.ts`); an over-long field is
 * cut to its limit rather than failing the batch. Once answered, the new
 * or changed notes are tagged by area with Jev (`notes-tagger.ts`). GET is for
 * the owner, behind the owner's password (ADMIN_PASSWORD): the saved days, one day with
 * `?day=`, or a month's tag counts with `?summary=YYYY-MM`. Without
 * ADMIN_PASSWORD in production GET answers 404, and says so once in the
 * server log, since the page looks the same as a missing route.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 200_000;
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

let warnedHidden = false;

export async function POST(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return fail(403, 'Forbidden');
  const body = await request.text();
  if (body.length > MAX_BODY) return fail(413, 'Too much at once.');
  let parsed: ReturnType<typeof incomingBatchSchema.safeParse>;
  try {
    parsed = incomingBatchSchema.safeParse(JSON.parse(body));
  } catch {
    return fail(400, 'Bad request.');
  }
  if (!parsed.success) return fail(400, 'Bad request.');
  try {
    const result = await saveNotes(parsed.data.entries, await visitorKey(clientIp(request.headers)));
    if ('refused' in result) return fail(429, 'Enough for today.');
    const { day, toTag } = result;
    if (tagsEnabled() && toTag.length) after(() => tagSavedNotes(day, toTag));
    return Response.json({ saved: result.saved }, { headers });
  } catch (error) {
    console.error('[pin] notes', error);
    return fail(503, 'Busy. Try again.');
  }
}

export async function GET(request: Request) {
  const access = adminRequestAccess(request);
  if (access === 'hide') {
    if (!warnedHidden) {
      warnedHidden = true;
      console.warn('[pin] notes: ADMIN_PASSWORD is not set; the owner read is off');
    }
    return new Response('Not found', { status: 404, headers });
  }
  if (access === 'ask')
    return new Response('Password required', {
      status: 401,
      headers: { ...headers, 'WWW-Authenticate': `Basic realm="${adminRealm}"` },
    });
  const params = new URL(request.url).searchParams;
  const summary = params.get('summary');
  const day = params.get('day');
  if (summary !== null) {
    // `?summary=YYYY-MM` for a month, or `?day=YYYY-MM-DD&summary=1` for one day.
    if (/^\d{4}-\d{2}$/.test(summary))
      return Response.json(summarizeTags(summary, await readMonth(summary)), { headers });
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const one = { [day]: await readNotes(day) };
      return Response.json(summarizeTags(day.slice(0, 7), one), { headers });
    }
    return fail(400, 'Use ?summary=YYYY-MM.');
  }
  if (!day) return Response.json({ days: await savedDays() }, { headers });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, 'Use ?day=YYYY-MM-DD.');
  return Response.json(await readNotes(day), { headers });
}
