import { plansOn } from '@/lib/access';
import { proOf, purchasesOf, readAccount } from '@/lib/account';
import { adminRealm, adminRequestAccess } from '@/lib/auth';
import { billingConfig } from '@/lib/billing';
import { pilotRows } from '@/lib/cloud';

/*
 * The pilot, for the owner (D123): behind ADMIN_PASSWORD, how each account
 * used its agent with Pinch (runs in the last 7 and 30 days, pieces of work
 * reported and the verdicts on them, notes the agent read, rules it proposed,
 * its last run) and, once plans are on, whether it has Pro. Accounts by the
 * first characters of their hashed key; no email, name or anything made or
 * said. Without ADMIN_PASSWORD in production it answers 404.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(request: Request) {
  const access = adminRequestAccess(request);
  if (access === 'hide') return new Response('Not found', { status: 404, headers });
  if (access === 'ask')
    return new Response('Password required', {
      status: 401,
      headers: { ...headers, 'WWW-Authenticate': `Basic realm="${adminRealm}"` },
    });
  const now = new Date().toISOString();
  const since = plansOn() ? billingConfig()?.pro?.since : undefined;
  const rows = await pilotRows(now);
  const accounts = await Promise.all(
    rows.map(async ({ user, ...row }) => {
      const account = since ? await readAccount(user).catch(() => null) : null;
      const pro = since && account ? proOf(await purchasesOf(account.email), since, now) : null;
      return { account: user.slice(0, 8), ...(pro === null ? {} : { pro }), ...row };
    }),
  );
  return Response.json({ at: now, accounts }, { headers });
}
