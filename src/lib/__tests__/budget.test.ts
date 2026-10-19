import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { costUsd, refusal, today, visitorKey } from '../budget';

describe('costUsd', () => {
  it('prices Sonnet 5.5 input, output, cache reads and both cache writes', () => {
    const usd = costUsd('claude-sonnet-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
    });
    // 2 + 1 + 0.2 + 2.5 + 4
    assert.equal(Math.round(usd * 100) / 100, 9.7);
  });

  it('prices Opus and Haiku at their own rates', () => {
    assert.equal(costUsd('claude-opus-5-5', { input_tokens: 1_000_000 }), 4);
    assert.equal(costUsd('claude-haiku-5-5', { output_tokens: 1_000_000 }), 0.5);
  });

  it('prices an unknown model at the dearest rate, so the cap errs safe', () => {
    assert.equal(costUsd('some-new-model', { output_tokens: 1_000_000 }), 50);
  });

  it('treats a total-only cache write as a 1-hour write', () => {
    assert.equal(costUsd('claude-sonnet-5-5', { cache_creation_input_tokens: 1_000_000 }), 4);
  });

  it('ignores missing and negative counts', () => {
    assert.equal(costUsd('claude-sonnet-5-5', { input_tokens: null, output_tokens: -5 }), 0);
  });
});

describe('refusal', () => {
  const caps = { usd: 5, perVisitor: 2, requests: 3 };
  it('refuses past the budget, the visitor limit and the daily ceiling', () => {
    assert.equal(refusal({ usd: 4.2, requests: 0, visitors: {} }, 'a', 0.95, caps), 'budget');
    assert.equal(refusal({ usd: 0, requests: 0, visitors: { a: 2 } }, 'a', 0.95, caps), 'visitor');
    assert.equal(refusal({ usd: 0, requests: 3, visitors: {} }, 'a', 0.95, caps), 'busy');
    assert.equal(refusal({ usd: 4, requests: 2, visitors: { a: 1 } }, 'a', 0.95, caps), null);
  });
});

describe('visitorKey', () => {
  it('hashes the IP with the salt, never returning the IP itself', async () => {
    const key = await visitorKey('203.0.113.9');
    assert.equal(key.length, 16);
    assert.ok(!key.includes('203'));
    assert.equal(await visitorKey('203.0.113.9'), key);
    assert.notEqual(await visitorKey('203.0.113.10'), key);
  });

  it('changes with VISITOR_SALT', async () => {
    const before = await visitorKey('203.0.113.9');
    process.env.VISITOR_SALT = 'another';
    try {
      assert.notEqual(await visitorKey('203.0.113.9'), before);
    } finally {
      delete process.env.VISITOR_SALT;
    }
  });
});

describe('today', () => {
  it('is the UTC day', () => {
    assert.equal(today(new Date('2026-10-19T23:59:59Z')), '2026-10-19');
    assert.equal(today(new Date('2026-10-20T00:00:00Z')), '2026-10-20');
  });
});
