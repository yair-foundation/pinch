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
});
