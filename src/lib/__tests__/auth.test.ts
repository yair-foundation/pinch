import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adminAccess, adminRealm, isAuthorized, isSameOriginWrite } from '../auth';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('admin auth', () => {
  it('accepts the password under any user name, and nothing else', () => {
    assert.ok(isAuthorized(basic('anyone', 's3cret:with colon'), 's3cret:with colon'));
    assert.ok(!isAuthorized(basic('anyone', 'wrong'), 's3cret'));
    assert.ok(!isAuthorized(null, 's3cret'));
    assert.ok(!isAuthorized('Bearer s3cret', 's3cret'));
    assert.ok(!isAuthorized(basic('a', ''), ''));
  });

  it('hides the route in production without a password, and asks with one', () => {
    assert.equal(adminAccess(null, undefined, false), 'hide');
    assert.equal(adminAccess(null, undefined, true), 'allow');
    assert.equal(adminAccess(null, 'pw', true), 'ask');
    assert.equal(adminAccess(basic('u', 'pw'), 'pw', false), 'allow');
    assert.equal(adminRealm, 'Pinch admin');
  });
});

describe('isSameOriginWrite', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it('trusts Sec-Fetch-Site, then falls back to Origin', () => {
    assert.ok(isSameOriginWrite(h({ 'sec-fetch-site': 'same-origin' }), 'https://a.example'));
    assert.ok(
      !isSameOriginWrite(
        h({ 'sec-fetch-site': 'cross-site', origin: 'https://a.example' }),
        'https://a.example',
      ),
    );
    assert.ok(isSameOriginWrite(h({ origin: 'https://a.example' }), 'https://a.example'));
    assert.ok(!isSameOriginWrite(h({ origin: 'https://evil.example' }), 'https://a.example'));
    assert.ok(!isSameOriginWrite(h({}), 'https://a.example'));
  });

  it('refuses a copied Sec-Fetch-Site next to a foreign Origin, and takes the forwarded host', () => {
    const same = { 'sec-fetch-site': 'same-origin' };
    // What a browser sends on a same-origin POST.
    assert.ok(isSameOriginWrite(h({ ...same, origin: 'https://a.example' }), 'https://a.example'));
    assert.ok(
      !isSameOriginWrite(h({ ...same, origin: 'https://evil.example' }), 'https://a.example'),
    );
    assert.ok(!isSameOriginWrite(h({ ...same, origin: 'null' }), 'https://a.example'));
    // Behind the platform the request's own origin can differ from the public host.
    assert.ok(
      isSameOriginWrite(
        h({ ...same, origin: 'https://pinch.example', 'x-forwarded-host': 'pinch.example' }),
        'http://localhost:3000',
      ),
    );
    assert.ok(
      isSameOriginWrite(
        h({ origin: 'http://localhost:3213', host: 'localhost:3213' }),
        'http://127.0.0.1:3213',
      ),
    );
    assert.ok(
      !isSameOriginWrite(
        h({ ...same, origin: 'https://evil.example', host: 'pinch.example' }),
        'http://localhost:3000',
      ),
    );
  });
});
