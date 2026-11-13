import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHold, REST, TAIL } from '../push-to-talk';

/** Timers run by hand: `pass(ms)` moves time on and fires what came due. */
function clock() {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        due.set(++next, { at: now + ms, fn });
        return next;
      },
      clear: (id: unknown) => {
        due.delete(id as number);
      },
    },
    pass(ms: number) {
      const until = now + ms;
      for (;;) {
        const first = [...due.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!first) break;
        due.delete(first[0]);
        now = first[1].at;
        first[1].fn();
      }
      now = until;
    },
  };
}

function setup() {
  const c = clock();
  const calls: string[] = [];
  const hold = createHold(
    {
      talk: () => calls.push('talk'),
      mute: () => calls.push('mute'),
      pause: () => calls.push('pause'),
    },
    c.timers,
  );
  return { hold, calls, pass: c.pass };
}

describe('hold to talk', () => {
  it('talks on a press, and a held key repeating changes nothing', () => {
    const { hold, calls } = setup();
    hold.press();
    hold.press();
    hold.press();
    assert.deepEqual(calls, ['talk']);
    assert.equal(hold.held, true);
  });

  it('mutes after the tail and pauses after the rest', () => {
    const { hold, calls, pass } = setup();
    hold.press();
    hold.release();
    pass(TAIL - 1);
    assert.deepEqual(calls, ['talk']);
    pass(1);
    assert.deepEqual(calls, ['talk', 'mute']);
    pass(REST - 1);
    assert.deepEqual(calls, ['talk', 'mute']);
    pass(1);
    assert.deepEqual(calls, ['talk', 'mute', 'pause']);
    assert.equal(hold.state, 'off');
  });

  it('carries on when pressed again within the tail', () => {
    const { hold, calls, pass } = setup();
    hold.press();
    hold.release();
    pass(TAIL / 2);
    hold.press();
    pass(REST * 2);
    assert.deepEqual(calls, ['talk']);
    assert.equal(hold.held, true);
  });

  it('talks again from rest, without pausing', () => {
    const { hold, calls, pass } = setup();
    hold.press();
    hold.release();
    pass(TAIL + 1000);
    hold.press();
    pass(REST * 2);
    assert.deepEqual(calls, ['talk', 'mute', 'talk']);
  });

  it('is not held while the key is up, so a microphone that opens late stays off', () => {
    const { hold } = setup();
    hold.press();
    hold.release();
    assert.equal(hold.held, false);
  });

  it('forgets everything on reset', () => {
    const { hold, calls, pass } = setup();
    hold.press();
    hold.release();
    hold.reset();
    pass(REST * 2);
    assert.deepEqual(calls, ['talk']);
    assert.equal(hold.state, 'off');
    hold.release();
    pass(REST * 2);
    assert.deepEqual(calls, ['talk']);
  });
});
