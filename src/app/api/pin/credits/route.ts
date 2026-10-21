import { z } from 'zod';
import { accessOf } from '@/lib/access';
import { isSameOriginWrite } from '@/lib/auth';
import { finishUpdate } from '@/lib/credits';

/*
 * An update is over (D98): POST JSON { finish: id } when the author's click on
 * Update rules has read all it will, or stopped. It then takes the price of
 * the notes it read, and the rest of what it held comes back at once rather
 * than after an hour. Finishing an update that is done, or isn't the asker's,
 * changes nothing.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const finishSchema = z.object({
  finish: z
    .string()
    .min(8)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const parsed = finishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Which update?' }, { status: 400, headers });
  const { credits } = await accessOf(request);
  if (credits) await finishUpdate(credits.owner, parsed.data.finish);
  return Response.json({ ok: true }, { headers });
}
