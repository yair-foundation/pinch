import { readAccount, recordOrder, recordSubscription } from '@/lib/account';
import { billingConfig, signatureOk, webhookOutcome } from '@/lib/billing';

/*
 * Lemon Squeezy's order webhook (D81, D98): `order_created` and
 * `order_refunded`, signed with LEMONSQUEEZY_WEBHOOK_SECRET in `X-Signature`.
 * A paid or refunded order of Pinch is kept with its product under the
 * buyer's email (a paid credits pack is 2,000 credits, a refund takes back
 * what is left of it), and under the
 * signed-in account's email too when the checkout carried the account and the
 * buyer typed another address. A Pro subscription's events (D123) keep its
 * state the same way. Anything else is acknowledged and dropped. No email is
 * logged.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 200_000;

export async function POST(request: Request) {
  const config = billingConfig();
  if (!config) return new Response('Not found', { status: 404 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413 });
  if (!signatureOk(raw, request.headers.get('x-signature'), config.webhookSecret))
    return new Response('Bad signature', { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  const outcome = webhookOutcome(body, config);
  if (outcome.kind === 'ignore') return Response.json({ ignored: outcome.reason });
  const emails = new Set([outcome.email]);
  if (outcome.user) {
    const account = await readAccount(outcome.user).catch(() => null);
    if (account) emails.add(account.email);
  }
  for (const email of emails) {
    if (outcome.kind === 'subscription')
      await recordSubscription(email, outcome.subscription, {
        status: outcome.status,
        at: outcome.at,
        ...(outcome.endsAt ? { endsAt: outcome.endsAt } : {}),
      });
    else await recordOrder(email, outcome.order, outcome.kind, outcome.at, outcome.product);
  }
  console.log(
    `[pin] ${outcome.kind === 'subscription' ? `subscription ${outcome.status}` : `order ${outcome.kind}`}`,
  );
  return Response.json({ ok: true });
}
