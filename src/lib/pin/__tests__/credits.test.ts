import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  balanceOf,
  canUpdate,
  FREE_CREDITS,
  FREE_GRANT,
  type Grant,
  PACK_CREDITS,
  STALE_MS,
  takenBy,
  type Update,
  updatePrice,
} from '../credits';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const free: Grant = { id: FREE_GRANT, credits: FREE_CREDITS, at: '2026-10-01T00:00:00Z' };
const pack = (id: string, at: string, refundedAt?: string): Grant => ({
  id,
  credits: PACK_CREDITS,
  at,
  ...(refundedAt ? { refundedAt } : {}),
});
const update = (at: string, notes: number, over: Partial<Update> = {}): Update => ({
  id: at,
  at,
  notes,
  read: notes,
  done: true,
  ...over,
});

describe('credits (D98)', () => {
  it('prices an update at 20 credits and 3 a note', () => {
    assert.equal(updatePrice(0), 0);
    assert.equal(updatePrice(1), 23);
    assert.equal(updatePrice(5), 35);
    assert.equal(updatePrice(30), 110);
    assert.equal(Math.floor(PACK_CREDITS / updatePrice(1)), 86);
    assert.equal(Math.floor(PACK_CREDITS / updatePrice(5)), 57);
    assert.equal(Math.floor(PACK_CREDITS / updatePrice(30)), 18);
    assert.equal(updatePrice(30) + updatePrice(20), 190, 'the free 200 read 50 notes in two');
  });

  it('holds the whole price while an update runs, then takes what it read', () => {
    const running = update('2026-10-21T11:59:00Z', 12, { read: 0, done: false });
    assert.equal(takenBy(running, NOW), updatePrice(12));
    assert.equal(takenBy({ ...running, read: 12, done: true }, NOW), updatePrice(12));
    assert.equal(takenBy({ ...running, read: 5, done: true }, NOW), updatePrice(5));
    assert.equal(
      takenBy({ ...running, read: 0, done: true }, NOW),
      0,
      'nothing read, nothing taken',
    );
    const stalled = { ...running, at: new Date(NOW - STALE_MS - 1).toISOString(), read: 4 };
    assert.equal(
      takenBy(stalled, NOW),
      updatePrice(4),
      'one that never finished takes what it read',
    );
  });

  it('spends the free credits first, then packs oldest first', () => {
    const grants = [free, pack('a', '2026-10-02T00:00:00Z'), pack('b', '2026-10-03T00:00:00Z')];
    assert.equal(balanceOf(grants, [], NOW), 4200);
    const updates = [update('2026-10-04T00:00:00Z', 30), update('2026-10-04T01:00:00Z', 30)];
    assert.equal(balanceOf(grants, updates, NOW), 4200 - 220);
    // Refunding the second pack takes back all of it: nothing was drawn from it yet.
    const refunded = [grants[0], grants[1], { ...grants[2], refundedAt: '2026-10-05T00:00:00Z' }];
    assert.equal(balanceOf(refunded, updates, NOW), 2200 - 220);
  });

  it('takes back only what is left of a refunded pack, never a debt', () => {
    const used = [update('2026-10-04T00:00:00Z', 30), update('2026-10-04T01:00:00Z', 100)];
    // 110 + 320 = 430: the free 200, then 230 of the pack.
    const grants = [free, pack('a', '2026-10-02T00:00:00Z', '2026-10-06T00:00:00Z')];
    assert.equal(balanceOf(grants, used, NOW), 0);
    // A pack bought after gives all it says.
    const again = [...grants, pack('b', '2026-10-07T00:00:00Z')];
    assert.equal(balanceOf(again, used, NOW), PACK_CREDITS);
    // Spending after the refund draws on the new pack only.
    const later = [...used, update('2026-10-08T00:00:00Z', 1)];
    assert.equal(balanceOf(again, later, NOW), PACK_CREDITS - 23);
  });

  it('keeps used credits used when a pack is refunded after it ran out', () => {
    const grants = [free, pack('a', '2026-10-02T00:00:00Z', '2026-10-09T00:00:00Z')];
    const updates = Array.from({ length: 20 }, (_, i) =>
      update(`2026-10-03T${String(i).padStart(2, '0')}:00:00Z`, 30),
    );
    assert.equal(balanceOf(grants, updates, NOW), 0);
  });

  it('spends the free credits first even when a pack was bought before signing in', () => {
    const early = pack('a', '2026-09-30T00:00:00Z', '2026-10-06T00:00:00Z');
    const updates = [update('2026-10-02T00:00:00Z', 30)];
    // The 110 came out of the free 200, so refunding the pack takes all of it back.
    assert.equal(balanceOf([early, free], updates, NOW), FREE_CREDITS - 110);
  });

  it('never goes below nothing when more was taken than there was', () => {
    assert.equal(balanceOf([free], [update('2026-10-02T00:00:00Z', 100)], NOW), 0);
  });

  it('starts an update only when its whole price is there', () => {
    const updates = [update('2026-10-02T00:00:00Z', 30)];
    assert.equal(canUpdate([free], updates, 20, NOW), true, '90 left, 80 needed');
    assert.equal(canUpdate([free], updates, 24, NOW), false, '90 left, 92 needed');
    const running = [...updates, update('2026-10-21T11:59:00Z', 20, { read: 0, done: false })];
    assert.equal(canUpdate([free], running, 1, NOW), false, 'a running update holds its price');
  });
});
