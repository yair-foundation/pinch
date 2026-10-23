import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { saveQueue } from '../save-queue';

/** A store whose writes finish only when the test says so, as a slow network would. */
function slowStore() {
  const stored = new Map<string, number>();
  const sent: { key: string; value: number; finish: (fail?: boolean) => void }[] = [];
  const send = (key: string, value: number) =>
    new Promise<void>((resolve, reject) => {
      sent.push({
        key,
        value,
        finish: (fail) => {
          if (fail) return reject(new Error('offline'));
          stored.set(key, value);
          resolve();
        },
      });
    });
  return { stored, sent, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('saving one document in order (D113)', () => {
  it('sends only the newest of writes asked for together', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    const done = [1, 2, 3].map((v) => q.write('c', v));
    await tick();
    assert.deepEqual(
      s.sent.map((x) => x.value),
      [3],
    );
    s.sent[0].finish();
    await Promise.all(done);
    assert.equal(s.stored.get('c'), 3);
  });

  it('sends one write at a time, and only the newest of those waiting', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    const done = [q.write('c', 1)];
    await tick();
    done.push(...[2, 3, 4].map((v) => q.write('c', v)));
    await tick();
    assert.deepEqual(
      s.sent.map((x) => x.value),
      [1],
    );
    s.sent[0].finish();
    await tick();
    assert.deepEqual(
      s.sent.map((x) => x.value),
      [1, 4],
    );
    s.sent[1].finish();
    await Promise.all(done);
    assert.equal(s.stored.get('c'), 4);
  });

  it('keeps the newest even when an older write would have finished last', async () => {
    // Side by side, the write of 2 could land after 3 and undo it; in the queue 3 goes after.
    const s = slowStore();
    const q = saveQueue(s.send);
    const a = q.write('c', 1);
    await tick();
    const b = q.write('c', 2);
    const c = q.write('c', 3);
    s.sent[0].finish();
    await a;
    await tick();
    s.sent[1].finish();
    await Promise.all([b, c]);
    assert.equal(s.stored.get('c'), 3);
    assert.equal(s.sent.length, 2);
  });

  it('settles a replaced write only once the newer one is written', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    void q.write('c', 1);
    await tick();
    const replaced = q.write('c', 2);
    let settled = false;
    void replaced.then(() => {
      settled = true;
    });
    void q.write('c', 3);
    await tick();
    s.sent[0].finish();
    await tick();
    assert.equal(settled, false);
    s.sent[1].finish();
    await replaced;
    assert.equal(s.stored.get('c'), 3);
  });

  it('goes on after a failed write, and tells its callers', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    const failed = q.write('c', 1);
    await tick();
    const next = q.write('c', 2);
    s.sent[0].finish(true);
    await assert.rejects(failed, /offline/);
    await tick();
    s.sent[1].finish();
    await next;
    assert.equal(s.stored.get('c'), 2);
  });

  it('keeps different documents apart', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    void q.write('a', 1);
    void q.write('b', 1);
    await tick();
    assert.deepEqual(
      s.sent.map((x) => x.key),
      ['a', 'b'],
    );
  });

  it('is idle once every write asked for has finished, even a failed one', async () => {
    const s = slowStore();
    const q = saveQueue(s.send);
    void q.write('c', 1).catch(() => undefined);
    await tick();
    void q.write('c', 2);
    let idle = false;
    void q.idle('c').then(() => {
      idle = true;
    });
    s.sent[0].finish(true);
    await tick();
    assert.equal(idle, false);
    s.sent[1].finish();
    await q.idle('c');
    assert.equal(idle, true);
    await q.idle('nothing');
  });
});
