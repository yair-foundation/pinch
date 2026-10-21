import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/*
 * Paying for Pinch (D81, D98): one offer, 2,000 credits for $19.99, through
 * Lemon Squeezy, the merchant of record (it takes the payment and the tax, and
 * sends the receipt). The checkout link carries the signed-in email and
 * account; Lemon Squeezy then calls the webhook, signed with its secret, when
 * an order is paid or refunded, and the order is kept under the buyer's email
 * with its product. With an API key, a buyer whose webhook went astray can
 * restore their orders by email. Everything here is off until the store,
 * product, link and webhook secret are set, and then the tool is paid.
 *
 * LEMONSQUEEZY_PRODUCT_ID is the credits pack. LEMONSQUEEZY_ORIGINAL_PRODUCT_ID,
 * set only if customers bought the original offer (D81's $19 once) before
 * credits went on sale, names that product, so its buyers keep what they
 * bought (D98).
 */

export type BillingConfig = {
  storeId: string;
  productId: string;
  buyUrl: string;
  webhookSecret: string;
  apiKey?: string;
  price: string;
  /** The original offer's product, when customers bought it before credits went on sale. */
  originalProductId?: string;
};

export function billingConfig(
  env: Record<string, string | undefined> = process.env,
): BillingConfig | null {
  const storeId = env.LEMONSQUEEZY_STORE_ID?.trim();
  const productId = env.LEMONSQUEEZY_PRODUCT_ID?.trim();
  const buyUrl = env.PINCH_BUY_URL?.trim();
  const webhookSecret = env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!storeId || !productId || !buyUrl || !webhookSecret) return null;
  return {
    storeId,
    productId,
    buyUrl,
    webhookSecret,
    apiKey: env.LEMONSQUEEZY_API_KEY?.trim() || undefined,
    price: env.PINCH_PRICE?.trim() || '$19.99',
    originalProductId: env.LEMONSQUEEZY_ORIGINAL_PRODUCT_ID?.trim() || undefined,
  };
}

/** The checkout link for one buyer: their email filled in, their account carried to the webhook. */
export function checkoutUrl(buyUrl: string, email: string, user: string): string {
  const url = new URL(buyUrl);
  url.searchParams.set('checkout[email]', email);
  url.searchParams.set('checkout[custom][user]', user);
  return url.toString();
}

/** Whether a webhook body carries Lemon Squeezy's signature: HMAC-SHA256 of the raw body, in hex. */
export function signatureOk(raw: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(signature.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

const id = z.union([z.string(), z.number()]).transform(String);
const webhookSchema = z.object({
  meta: z.object({
    event_name: z.string(),
    custom_data: z.object({ user: z.string().max(60).optional() }).nullish(),
  }),
  data: z.object({
    id,
    attributes: z.object({
      store_id: id,
      user_email: z.string().max(320),
      status: z.string(),
      refunded: z.boolean().optional(),
      first_order_item: z.object({ product_id: id }).nullish(),
      updated_at: z.string().optional(),
      created_at: z.string().optional(),
    }),
  }),
});

export type WebhookOutcome =
  | {
      kind: 'paid' | 'refunded';
      order: string;
      /** The product bought, when the order says. */
      product?: string;
      email: string;
      user?: string;
      at: string;
    }
  | { kind: 'ignore'; reason: string };

/** The products Pinch sells: the credits pack, and the original offer while its buyers count. */
const productsOf = (config: BillingConfig) =>
  [config.productId, config.originalProductId].filter(Boolean) as string[];

/** What an order webhook means for Pinch: a paid or refunded order of its products, or nothing. */
export function webhookOutcome(body: unknown, config: BillingConfig): WebhookOutcome {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return { kind: 'ignore', reason: 'not an order' };
  const { meta, data } = parsed.data;
  const a = data.attributes;
  if (a.store_id !== config.storeId) return { kind: 'ignore', reason: 'another store' };
  const product = a.first_order_item?.product_id;
  if (product && !productsOf(config).includes(product))
    return { kind: 'ignore', reason: 'another product' };
  const refunded = meta.event_name === 'order_refunded' || a.refunded || a.status === 'refunded';
  const paid = meta.event_name === 'order_created' && a.status === 'paid';
  if (!refunded && !paid) return { kind: 'ignore', reason: `${meta.event_name} ${a.status}` };
  return {
    kind: refunded ? 'refunded' : 'paid',
    order: data.id,
    ...(product ? { product } : {}),
    email: a.user_email.trim().toLowerCase(),
    ...(meta.custom_data?.user ? { user: meta.custom_data.user } : {}),
    at: a.updated_at ?? a.created_at ?? new Date().toISOString(),
  };
}

const ordersSchema = z.object({
  data: z.array(
    z.object({
      id,
      attributes: z.object({
        status: z.string(),
        refunded: z.boolean().optional(),
        first_order_item: z.object({ product_id: id }).nullish(),
        updated_at: z.string().optional(),
      }),
    }),
  ),
});

/** Every paid order of Pinch's products for this email, asked of Lemon Squeezy's API. */
export async function paidOrdersFor(
  email: string,
  config: BillingConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ order: string; at: string; product?: string }[]> {
  if (!config.apiKey) return [];
  const url = new URL('https://api.lemonsqueezy.com/v1/orders');
  url.searchParams.set('filter[store_id]', config.storeId);
  url.searchParams.set('filter[user_email]', email.trim().toLowerCase());
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  if (!res.ok) throw new Error('Lemon Squeezy didn’t answer. Try again in a minute.');
  const parsed = ordersSchema.safeParse(await res.json());
  if (!parsed.success) return [];
  return parsed.data.data
    .filter(
      (o) =>
        o.attributes.status === 'paid' &&
        !o.attributes.refunded &&
        (!o.attributes.first_order_item ||
          productsOf(config).includes(o.attributes.first_order_item.product_id)),
    )
    .map((o) => ({
      order: o.id,
      at: o.attributes.updated_at ?? new Date().toISOString(),
      ...(o.attributes.first_order_item
        ? { product: o.attributes.first_order_item.product_id }
        : {}),
    }));
}
