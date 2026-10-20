import { forgetPaid, paidEmail, paywallOn } from '@/lib/access';
import { recordOrder } from '@/lib/account';
import { isSameOriginWrite } from '@/lib/auth';
import { billingConfig, paidOrderFor } from '@/lib/billing';
import { sessionOf } from '@/lib/session';

/*
 * "I paid, but Pinch doesn't know" (D79): with LEMONSQUEEZY_API_KEY set, asks
 * Lemon Squeezy for a paid order under the signed-in email and keeps it, as
 * the webhook would have. Without the key, it only reads what is kept.
 */

export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function POST(request: Request) {
  if (!isSameOriginWrite(request.headers, new URL(request.url).origin))
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const session = sessionOf(request);
  const config = billingConfig();
  if (!paywallOn() || !config) return Response.json({ allowed: true }, { headers });
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401, headers });
  if (await paidEmail(session.email, true)) return Response.json({ allowed: true }, { headers });
  try {
    const found = await paidOrderFor(session.email, config);
    if (found) {
      await recordOrder(session.email, found.order, 'paid', found.at);
      forgetPaid(session.email);
    }
    return Response.json({ allowed: Boolean(found) }, { headers });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502, headers });
  }
}
