/*
 * Which address a request came from, for the per-visitor caps. On Vercel the
 * platform sets `x-real-ip` and `x-vercel-forwarded-for` from the connection
 * and overwrites whatever the client sent, so those are trusted first. Without
 * them (`next dev`, another host) the last hop of `x-forwarded-for` is used:
 * the one the nearest proxy appended, which a client can't choose, where the
 * first hop is whatever the client wrote. With no header at all, "local".
 */

const first = (value: string | null) => value?.split(',')[0]?.trim() || undefined;
const last = (value: string | null) =>
  value
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);

export function clientIp(headers: Headers): string {
  return (
    first(headers.get('x-real-ip')) ??
    first(headers.get('x-vercel-forwarded-for')) ??
    last(headers.get('x-forwarded-for')) ??
    'local'
  );
}
