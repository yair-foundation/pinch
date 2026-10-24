import { paywallOn } from '@/lib/access';
import { recordOrder, recordSubscription } from '@/lib/account';
import { isSameOriginWrite } from '@/lib/auth';
import { billingConfig, paidOrdersFor, subscriptionsFor } from '@/lib/billing';
import { sessionOf } from '@/lib/session';

/*
 * "I paid, but Pinch doesn't know" (D81, D98): with LEMONSQUEEZY_API_KEY set,
 * asks Lemon Squeezy for every paid order under the signed-in email and keeps
 * each, as the webhook would have, so a pack whose webhook went astray adds
 * its credits, and every Pro subscription with its state (D123). Orders
 * already kept are kept again unchanged. Without the key there is nothing to
 * ask.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function POST(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const session = sessionOf(request);
  const config = billingConfig();
  if (!paywallOn() || !config) return Response.json({ found: 0 }, { headers });
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  try {
    const found = await paidOrdersFor(session.email, config);
    for (const o of found) await recordOrder(session.email, o.order, 'paid', o.at, o.product);
    const subs = await subscriptionsFor(session.email, config);
    for (const x of subs)
      await recordSubscription(session.email, x.subscription, {
        status: x.status,
        at: x.at,
        ...(x.endsAt ? { endsAt: x.endsAt } : {}),
      });
    return Response.json({ found: found.length + subs.length }, { headers });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502, headers });
  }
}
