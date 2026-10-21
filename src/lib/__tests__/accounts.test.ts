import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { accessOf, accountGate, gate, paywallOn } from '../access';
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
  paidOrdersFor,
  signatureOk,
  webhookOutcome,
} from '../billing';
import { listDocuments, putDocument } from '../blob-doc';
import {
  begin,
  beginUpdate,
  creditsOf,
  finishUpdate,
  grantsOf,
  keepsOriginal,
  type Ledger,
  mergeBrowser,
  noteRead,
} from '../credits';
import { authUrl, claimsOf, pictureOf, pkcePair } from '../google';
import { FREE_GRANT, PACK_CREDITS, updatePrice } from '../pin/credits';
import { cookieOf, readSession, SESSION_COOKIE, signSession } from '../session';

const SECRET = 'test-secret';

describe('sessions', () => {
  it('signs and reads a session, and refuses a forged or stale one', () => {
    const token = signSession({ user: 'g1', email: 'a@b.co', name: 'A' }, SECRET, 1000);
    const s = readSession(token, SECRET, 2000);
    assert.equal(s?.user, 'g1');
    assert.equal(s?.email, 'a@b.co');
    assert.equal(s?.picture, '', 'a session from before pictures has none');
    const withPicture = signSession(
      { user: 'g1', email: 'a@b.co', name: 'A', picture: 'https://lh3.googleusercontent.com/a' },
      SECRET,
      1000,
    );
    assert.equal(readSession(withPicture, SECRET, 2000)?.picture, 'https://lh3.googleusercontent.com/a');
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
      picture: '',
    });
    assert.equal(
      claimsOf(idToken({ ...good, picture: 'https://lh3.googleusercontent.com/a/x=s96-c' }), 'client-1', 1_000_000_000_000).picture,
      'https://lh3.googleusercontent.com/a/x=s96-c',
    );
    assert.equal(pictureOf('https://evil.example/a.png'), '', 'only Google’s image host');
    assert.equal(pictureOf('http://lh3.googleusercontent.com/a'), '', 'https only');
    assert.equal(pictureOf(42), '');
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
  creditsProductId: '22',
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
  it('is off until the store, the credits product, link and secret are all set', () => {
    assert.equal(billingConfig({}), null);
    const env = {
      LEMONSQUEEZY_STORE_ID: '11',
      LEMONSQUEEZY_CREDITS_PRODUCT_ID: '22',
      PINCH_BUY_URL: 'https://x.co/buy',
      LEMONSQUEEZY_WEBHOOK_SECRET: 's',
    };
    assert.equal(billingConfig(env)?.price, '$19.99');
    assert.equal(billingConfig(env)?.originalProductId, undefined);
    assert.equal(
      billingConfig({ ...env, LEMONSQUEEZY_PRODUCT_ID: '21' })?.originalProductId,
      '21',
    );
    // Deployed before the credits product is set, the old configuration sells nothing new (D98).
    const { LEMONSQUEEZY_CREDITS_PRODUCT_ID, ...old } = env;
    assert.equal(LEMONSQUEEZY_CREDITS_PRODUCT_ID, '22');
    assert.equal(billingConfig({ ...old, LEMONSQUEEZY_PRODUCT_ID: '21' }), null);
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
      product: '22',
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
    // The original offer's product counts when there is one (D98).
    assert.equal(webhookOutcome(order({ product: 21 }), config).kind, 'ignore');
    assert.equal(
      webhookOutcome(order({ product: 21 }), { ...config, originalProductId: '21' }).kind,
      'paid',
    );
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
    assert.deepEqual(await paidOrdersFor('a@x.co', config, fake), [], 'no key, no call');
    assert.deepEqual(await paidOrdersFor('A@x.co', { ...config, apiKey: 'k' }, fake), [
      { order: '2', at: 't', product: '22' },
    ]);
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

  it('keeps the product of an order and when it was first paid, whatever comes later (D98)', () => {
    let p = applyOrder({ orders: {} }, '1', 'paid', '2026-10-22T10:00', '22');
    p = applyOrder(p, '1', 'paid', '2026-10-22T09:00');
    assert.deepEqual(p.orders['1'], {
      status: 'paid',
      at: '2026-10-22T10:00',
      product: '22',
      paidAt: '2026-10-22T09:00',
    });
    p = applyOrder(p, '1', 'refunded', '2026-10-23T10:00');
    assert.deepEqual(p.orders['1'], {
      status: 'refunded',
      at: '2026-10-23T10:00',
      product: '22',
      paidAt: '2026-10-22T09:00',
    });
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
    LEMONSQUEEZY_CREDITS_PRODUCT_ID: '22',
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

  it('opens an account to its rules and agent key for anyone signed in (D98)', async () => {
    await withEnv(env, async () => {
      assert.equal(accountGate(request())?.status, 401);
      const token = signSession({ user: 'g8', email: 'free@x.co', name: 'F' }, SECRET);
      assert.equal(accountGate(request(token)), null);
    });
  });

  it('opens suggestions to buyers: sign in, then buy, then in', async () => {
    await withEnv(env, async () => {
      assert.ok(paywallOn());
      assert.equal((await gate(request()))?.status, 401);
      const token = signSession({ user: 'g9', email: 'new@x.co', name: 'N' }, SECRET);
      assert.equal((await gate(request(token)))?.status, 402);
      await recordOrder('new@x.co', 'o9', 'paid', '2026-10-20', '22');
      assert.equal((await accessOf(request(token))).allowed, true);
      assert.equal(await gate(request(token)), null);
    });
  });
});

describe('credits in the store (D98)', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`;
  const now = Date.parse(at(25));

  it('turns paid orders of the credits pack into grants, and older orders into none', () => {
    const grants = grantsOf(
      {
        a: { status: 'paid', at: at(20), product: '22', paidAt: at(20) },
        b: { status: 'refunded', at: at(22), product: '22', paidAt: at(21) },
        old: { status: 'paid', at: at(19) },
        other: { status: 'paid', at: at(20), product: '23', paidAt: at(20) },
      },
      config,
    );
    assert.deepEqual(grants, [
      { id: 'a', credits: PACK_CREDITS, at: at(20) },
      { id: 'b', credits: PACK_CREDITS, at: at(21), refundedAt: at(22) },
    ]);
  });

  it('keeps the original offer for its buyers, and for orders kept before D98', () => {
    const withOriginal = { ...config, originalProductId: '21' };
    const before = { old: { status: 'paid' as const, at: at(19) } };
    assert.equal(keepsOriginal(before, config), true, 'kept before D98: the only offer then');
    const bought = {
      o: { status: 'paid' as const, at: at(22), product: '21', paidAt: at(22) },
    };
    assert.equal(keepsOriginal(bought, withOriginal), true);
    assert.equal(keepsOriginal(bought, config), false, 'no original offer here');
    const refunded = { old: { status: 'refunded' as const, at: at(19) } };
    assert.equal(keepsOriginal(refunded, withOriginal), false);
    const pack = { p: { status: 'paid' as const, at: at(22), product: '22', paidAt: at(22) } };
    assert.equal(keepsOriginal(pack, withOriginal), false, 'a credits pack is not the original');
  });

  it('starts an update only with its whole price, and reads no more than it was priced for', () => {
    const grants = [{ id: FREE_GRANT, credits: 200, at: '' }];
    const ledger: Ledger = { updates: [] };
    assert.deepEqual(begin(ledger, grants, 'u1', 61, 30, now), {
      ok: false,
      status: 402,
      error: 'Not enough credits for this update.',
    });
    assert.deepEqual(begin(ledger, grants, 'u1', 50, 30, now), { ok: true });
    assert.equal(ledger.updates.length, 1);
    assert.deepEqual(begin(ledger, grants, 'u1', 50, 20, now), { ok: true }, 'the next call');
    ledger.updates[0].read = 40;
    assert.equal(begin(ledger, grants, 'u1', 50, 20, now).ok, false, '60 of 50');
    ledger.updates[0].done = true;
    assert.equal(begin(ledger, grants, 'u1', 50, 1, now).ok, false, 'finished');
    assert.equal(begin({ updates: [], mergedInto: 'e-x' }, grants, 'u2', 1, 1, now).ok, false);
  });

  it('charges updates, gives back what they did not read, and moves a browser into the account', async () => {
    const browser = 'b'.repeat(24);
    let c = await creditsOf(null, browser, config, now);
    assert.equal(c.balance, 200);
    assert.equal((await beginUpdate(c, config, 'u1', 10, 10, now)).ok, true);
    c = await creditsOf(null, browser, config, now);
    assert.equal(c.balance, 200 - updatePrice(10), 'held while it runs');
    await noteRead(c.owner, 'u1', 4);
    await finishUpdate(c.owner, 'u1');
    c = await creditsOf(null, browser, config, now);
    assert.equal(c.balance, 200 - updatePrice(4), 'the notes it did not read come back');

    const session = { user: 'g7', email: 'merge@x.co', name: 'M', exp: now + 1e6 };
    await mergeBrowser(browser, session.email);
    assert.equal((await creditsOf(null, browser, config, now)).balance, 0, 'the browser closes');
    assert.equal((await creditsOf(null, browser, config, now)).closed, true);
    const account = await creditsOf(session, browser, config, now);
    assert.equal(account.balance, 200 - updatePrice(4), 'one free 200, however it was spent');
    await mergeBrowser(browser, session.email);
    assert.equal((await creditsOf(session, browser, config, now)).balance, 200 - updatePrice(4));

    await recordOrder(session.email, 'p1', 'paid', at(24), '22');
    const bought = await creditsOf(session, browser, config, now);
    assert.equal(bought.balance, PACK_CREDITS + 200 - updatePrice(4));
    assert.equal(bought.bought, true);
  });
});
