import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { accessOf, gate, paywallOn } from '../access';
import {
  applyOrder,
  deleteAccount,
  emailKeyOf,
  isPaid,
  purchasesOf,
  readAccount,
  recordOrder,
  touchAccount,
  userFolder,
  userKeyOf,
} from '../account';
import {
  type BillingConfig,
  billingConfig,
  checkoutUrl,
  paidOrderFor,
  signatureOk,
  webhookOutcome,
} from '../billing';
import { listDocuments, putDocument } from '../blob-doc';
import { authUrl, claimsOf, pkcePair } from '../google';
import { cookieOf, readSession, SESSION_COOKIE, signSession } from '../session';

const SECRET = 'test-secret';

describe('sessions', () => {
  it('signs and reads a session, and refuses a forged or stale one', () => {
    const token = signSession({ user: 'g1', email: 'a@b.co', name: 'A' }, SECRET, 1000);
    const s = readSession(token, SECRET, 2000);
    assert.equal(s?.user, 'g1');
    assert.equal(s?.email, 'a@b.co');
    assert.equal(readSession(token, 'other', 2000), null);
    assert.equal(readSession(`${token}x`, SECRET, 2000), null);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), user: 'g2' }),
    ).toString('base64url');
    assert.equal(readSession(`${forged}.${sig}`, SECRET, 2000), null);
    assert.equal(readSession(token, SECRET, 1000 + 31 * 86_400_000), null, 'past 30 days');
    assert.equal(readSession(undefined, SECRET), null);
    assert.equal(readSession(token, undefined), null);
  });

  it('reads one cookie from a header', () => {
    assert.equal(cookieOf('a=1; pinch-session=x.y; b=2', SESSION_COOKIE), 'x.y');
    assert.equal(cookieOf('a=1', SESSION_COOKIE), undefined);
    assert.equal(cookieOf(null, SESSION_COOKIE), undefined);
  });
});

/** An ID token as Google's token endpoint sends it; only its claims are read. */
const idToken = (claims: Record<string, unknown>) =>
  ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
const good = {
  iss: 'https://accounts.google.com',
  aud: 'client-1',
  exp: 2_000_000_000,
  sub: '123',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada',
};

describe('Google sign-in', () => {
  it('takes a token from Google, for Pinch, current, with a verified email', () => {
    assert.deepEqual(claimsOf(idToken(good), 'client-1', 1_000_000_000_000), {
      sub: '123',
      email: 'ada@example.com',
      name: 'Ada',
    });
    const bad = (over: Record<string, unknown>) => () =>
      claimsOf(idToken({ ...good, ...over }), 'client-1', 1_000_000_000_000);
    assert.throws(bad({ iss: 'https://evil.example' }), /isn’t from Google/);
    assert.throws(bad({ aud: 'client-2' }), /isn’t for Pinch/);
    assert.throws(bad({ exp: 900_000_000 }), /took too long/);
    assert.throws(bad({ email_verified: false }), /isn’t verified/);
    assert.throws(() => claimsOf('nope', 'client-1'), /no ID token/);
  });

  it('asks Google with PKCE and a state', () => {
    const { verifier, challenge } = pkcePair();
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
    const url = new URL(
      authUrl({ clientId: 'c', redirectUri: 'https://x.co/cb', state: 's1', challenge }),
    );
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('state'), 's1');
  });
});

const config: BillingConfig = {
  storeId: '11',
  productId: '22',
  buyUrl: 'https://pinch.lemonsqueezy.com/buy/abc',
  webhookSecret: 'whsec',
  price: '$19',
};

const order = (over: {
  event?: string;
  status?: string;
  store?: number;
  product?: number;
  user?: string;
}) => ({
  meta: {
    event_name: over.event ?? 'order_created',
    custom_data: over.user ? { user: over.user } : null,
  },
  data: {
    id: '900',
    type: 'orders',
    attributes: {
      store_id: over.store ?? 11,
      user_email: ' Buyer@Example.com ',
      status: over.status ?? 'paid',
      refunded: over.status === 'refunded',
      first_order_item: { product_id: over.product ?? 22 },
      created_at: '2026-10-20T10:00:00.000000Z',
      updated_at: '2026-10-20T10:00:01.000000Z',
    },
  },
});

describe('billing', () => {
  it('is off until the store, product, link and secret are all set', () => {
    assert.equal(billingConfig({}), null);
    const env = {
      LEMONSQUEEZY_STORE_ID: '11',
      LEMONSQUEEZY_PRODUCT_ID: '22',
      PINCH_BUY_URL: 'https://x.co/buy',
      LEMONSQUEEZY_WEBHOOK_SECRET: 's',
    };
    assert.equal(billingConfig(env)?.price, '$19');
    assert.equal(billingConfig({ ...env, LEMONSQUEEZY_WEBHOOK_SECRET: '' }), null);
  });

  it('fills the checkout with the email and carries the account', () => {
    const url = new URL(checkoutUrl(config.buyUrl, 'a+b@x.co', 'g1'));
    assert.equal(url.searchParams.get('checkout[email]'), 'a+b@x.co');
    assert.equal(url.searchParams.get('checkout[custom][user]'), 'g1');
  });

  it('checks the webhook signature', () => {
    const raw = JSON.stringify(order({}));
    const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
    assert.ok(signatureOk(raw, sig, 'whsec'));
    assert.equal(signatureOk(raw, sig, 'other'), false);
    assert.equal(signatureOk(`${raw} `, sig, 'whsec'), false);
    assert.equal(signatureOk(raw, null, 'whsec'), false);
  });

  it('reads paid and refunded orders of Pinch, and nothing else', () => {
    assert.deepEqual(webhookOutcome(order({ user: 'g1' }), config), {
      kind: 'paid',
      order: '900',
      email: 'buyer@example.com',
      user: 'g1',
      at: '2026-10-20T10:00:01.000000Z',
    });
    assert.equal(
      webhookOutcome(order({ event: 'order_refunded', status: 'refunded' }), config).kind,
      'refunded',
    );
    assert.equal(webhookOutcome(order({ store: 12 }), config).kind, 'ignore');
    assert.equal(webhookOutcome(order({ product: 23 }), config).kind, 'ignore');
    assert.equal(webhookOutcome(order({ status: 'pending' }), config).kind, 'ignore');
    assert.equal(webhookOutcome({ meta: {} }, config).kind, 'ignore');
  });

  it('finds a paid order by email through the API, when a key is set', async () => {
    let asked = '';
    const fake = (async (url: URL) => {
      asked = String(url);
      return Response.json({
        data: [
          {
            id: 1,
            attributes: {
              status: 'refunded',
              refunded: true,
              first_order_item: { product_id: 22 },
            },
          },
          {
            id: 2,
            attributes: { status: 'paid', first_order_item: { product_id: 22 }, updated_at: 't' },
          },
        ],
      });
    }) as unknown as typeof fetch;
    assert.equal(await paidOrderFor('a@x.co', config, fake), null, 'no key, no call');
    assert.deepEqual(await paidOrderFor('A@x.co', { ...config, apiKey: 'k' }, fake), {
      order: '2',
      at: 't',
    });
    assert.match(asked, /filter%5Buser_email%5D=a%40x\.co/);
  });
});

describe('accounts and purchases', () => {
  it('keys accounts and purchases by hashes, never the raw id or email', () => {
    assert.equal(userKeyOf('123'), userKeyOf('123'));
    assert.notEqual(userKeyOf('123'), userKeyOf('124'));
    assert.doesNotMatch(userKeyOf('123'), /123/);
    assert.equal(emailKeyOf('A@x.co '), emailKeyOf('a@x.co'));
  });

  it('keeps the later report of each order, so a refund holds', () => {
    let p = applyOrder({ orders: {} }, '1', 'paid', '2026-10-20T10:00');
    assert.ok(isPaid(p));
    p = applyOrder(p, '1', 'refunded', '2026-10-21T10:00');
    assert.equal(isPaid(p), false);
    p = applyOrder(p, '1', 'paid', '2026-10-20T10:00');
    assert.equal(isPaid(p), false, 'a late paid report does not undo the refund');
    p = applyOrder(p, '2', 'paid', '2026-10-22T10:00');
    assert.ok(isPaid(p), 'a second order counts');
    assert.equal(isPaid(null), false);
  });

  it('records orders and deletes an account with its folder, not its purchase', async () => {
    await recordOrder('Buyer@x.co', 'o1', 'paid', '2026-10-20');
    assert.ok(isPaid(await purchasesOf('buyer@x.co')));
    await touchAccount('g-test', 'buyer@x.co', 'B', '2026-10-20');
    assert.equal((await readAccount('g-test'))?.name, 'B');
    await putDocument(`${userFolder('g-test')}collections/c1.json`, { id: 'c1' });
    await deleteAccount('g-test');
    assert.equal(await readAccount('g-test'), null);
    assert.deepEqual(await listDocuments(userFolder('g-test')), []);
    assert.ok(isPaid(await purchasesOf('buyer@x.co')));
  });
});

describe('the paywall', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'c',
    GOOGLE_CLIENT_SECRET: 's',
    AUTH_SECRET: SECRET,
    LEMONSQUEEZY_STORE_ID: '11',
    LEMONSQUEEZY_PRODUCT_ID: '22',
    PINCH_BUY_URL: 'https://x.co/buy',
    LEMONSQUEEZY_WEBHOOK_SECRET: 'whsec',
  };
  const withEnv = async (vars: Record<string, string>, run: () => Promise<void>) => {
    const before = { ...process.env };
    Object.assign(process.env, vars);
    try {
      await run();
    } finally {
      for (const k of Object.keys(vars)) delete process.env[k];
      Object.assign(process.env, before);
    }
  };
  const request = (token?: string) =>
    new Request('https://pinch.test/api/pin/suggest', {
      headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
    });

  it('lets everyone in until billing and sign-in are set up', async () => {
    assert.equal(paywallOn(), false);
    assert.equal(await gate(request()), null);
  });

  it('then asks to sign in, then to buy, then lets the buyer in', async () => {
    await withEnv(env, async () => {
      assert.ok(paywallOn());
      assert.equal((await gate(request()))?.status, 401);
      const token = signSession({ user: 'g9', email: 'new@x.co', name: 'N' }, SECRET);
      assert.equal((await gate(request(token)))?.status, 402);
      await recordOrder('new@x.co', 'o9', 'paid', '2026-10-20');
      assert.equal((await accessOf(request(token), true)).allowed, true);
      assert.equal(await gate(request(token)), null);
    });
  });
});
