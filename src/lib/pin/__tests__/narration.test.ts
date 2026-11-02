import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clockText,
  createClock,
  pointOn,
  slotOf,
  wheelTurn,
} from '../narration';

describe('slotOf', () => {
  it('puts the card on show in the middle and its neighbours at the edges', () => {
    assert.equal(slotOf(3, 3), 0);
    assert.equal(slotOf(2, 3), -1);
    assert.equal(slotOf(4, 3), 1);
  });
  it('keeps every card further away at two', () => {
    assert.equal(slotOf(0, 5), -2);
    assert.equal(slotOf(9, 5), 2);
  });
});

describe('createClock', () => {
  it('counts only the time between start and pause', () => {
    let t = 1000;
    const clock = createClock(() => t);
    assert.equal(clock.time(), 0);
    clock.start();
    t = 3500;
    assert.equal(clock.time(), 2500);
    clock.pause();
    t = 60_000;
    assert.equal(clock.time(), 2500);
    assert.equal(clock.running, false);
    clock.start();
    t = 61_000;
    assert.equal(clock.time(), 3500);
    assert.equal(clock.running, true);
  });
  it('ignores a second start or a pause while stopped', () => {
    let t = 0;
    const clock = createClock(() => t);
    clock.pause();
    clock.start();
    t = 100;
    clock.start();
    t = 300;
    assert.equal(clock.time(), 300);
  });
});

describe('wheelTurn', () => {
  const idle = { built: 0, at: -Infinity };
  it('builds up small scrolls until they turn the reel', () => {
    const a = wheelTurn(idle, { deltaX: 0, deltaY: 50 }, 1000);
    assert.equal(a.turn, 0);
    const b = wheelTurn(a.wheel, { deltaX: 0, deltaY: 50 }, 1010);
    assert.equal(b.turn, 1);
    assert.deepEqual(b.wheel, { built: 0, at: 1010 });
  });
  it('turns back on a scroll up, and on with a swipe left', () => {
    assert.equal(wheelTurn(idle, { deltaX: 0, deltaY: -120 }, 0).turn, -1);
    assert.equal(wheelTurn(idle, { deltaX: 120, deltaY: 10 }, 0).turn, 1);
  });
  it('rests after a turn, so one fling turns it once', () => {
    const first = wheelTurn(idle, { deltaX: 0, deltaY: 200 }, 1000);
    assert.equal(wheelTurn(first.wheel, { deltaX: 0, deltaY: 200 }, 1300).turn, 0);
    assert.equal(wheelTurn(first.wheel, { deltaX: 0, deltaY: 200 }, 1800).turn, 1);
  });
});

describe('pointOn', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  it('gives the point as fractions of the screenshot', () => {
    assert.deepEqual(pointOn(rect, 200, 100), [0.25, 0.25]);
    assert.deepEqual(pointOn(rect, 100, 50), [0, 0]);
  });
  it('gives null off the screenshot or on an empty one', () => {
    assert.equal(pointOn(rect, 99, 100), null);
    assert.equal(pointOn(rect, 200, 251), null);
    assert.equal(pointOn({ ...rect, width: 0 }, 100, 50), null);
  });
  it('keeps four places', () => {
    assert.deepEqual(pointOn(rect, 233, 50), [0.3325, 0]);
    assert.deepEqual(pointOn({ left: 0, top: 0, width: 3, height: 3 }, 1, 2), [0.3333, 0.6667]);
  });
});

describe('the take', () => {
  it('reads the clock as minutes and seconds', () => {
    assert.equal(clockText(0), '0:00');
    assert.equal(clockText(61_999), '1:01');
    assert.equal(clockText(600_000), '10:00');
  });
});
