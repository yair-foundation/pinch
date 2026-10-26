import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEMO_DELAY,
  DEMO_LENGTH,
  DEMO_RESUME,
  DEMO_LOOP,
  type DemoFrame,
  demoAt,
  type Resolve,
  ringCue,
  showTime,
  type Targets,
  waveform,
} from '../ring-demo';
import { RING_PICTURES } from '../ring-pictures';

/**
 * A flat stand-in for the ring: cards side by side, 300px apart, the one in front at 350px, and
 * a turn moving them along as the real ring does.
 */
const resolve: Resolve = (where, ring) => {
  if ('edge' in where) return [where.edge[0] * 1000, where.edge[1] * 600];
  const shift = (where.card === 'B' ? 1 : 0) - (ring.front === 'B' ? 1 : 0) + ring.turn;
  return [350 + (shift + where.u) * 300, 100 + where.v * 400];
};

// Every pair of neighbours on the ring, so each picture's target is tried as A and as B.
const pairs: Targets[] = RING_PICTURES.map((p, i) => ({
  A: p.target,
  B: RING_PICTURES[(i + 1) % RING_PICTURES.length].target,
}));

const frames = (targets: Targets, step = 0.001) => {
  const out: [number, DemoFrame][] = [];
  for (let t = 0; t < DEMO_LENGTH; t += step) out.push([t, demoAt(t, resolve, targets)]);
  return out;
};

describe('ring demo: the cursor', () => {
  it('moves without jumping, from entering the frame to leaving it, for every picture', () => {
    for (const targets of pairs) {
      let last: [number, number] | null = null;
      for (const [t, f] of frames(targets, 0.002)) {
        assert.ok(f.cursor, `a cursor at ${t.toFixed(3)}s`);
        if (last) {
          const jump = Math.hypot(f.cursor[0] - last[0], f.cursor[1] - last[1]);
          assert.ok(jump < 12, `${jump.toFixed(1)}px at ${t.toFixed(3)}s`);
        }
        last = f.cursor;
      }
    }
  });

  it('starts and ends outside the frame, and is gone between loops', () => {
    const [targets] = pairs;
    assert.ok((demoAt(0, resolve, targets).cursor?.[0] ?? 0) > 1000);
    assert.ok((demoAt(DEMO_LENGTH - 0.001, resolve, targets).cursor?.[0] ?? 0) > 1000);
    assert.equal(demoAt(DEMO_LENGTH + 0.1, resolve, targets).cursor, null);
    assert.ok(DEMO_LOOP > DEMO_LENGTH + 3);
  });

  it('presses only to drag', () => {
    for (const [t, f] of frames(pairs[0], 0.01))
      if (ringCue(t).turn !== 0)
        assert.equal(f.pressed, 1, `pressed while turning at ${t.toFixed(2)}s`);
  });
});

describe('ring demo: the ring', () => {
  it('holds a card in front, turns it to the next and lets it drift again', () => {
    const cues = frames(pairs[0], 0.01).map(([t]) => ringCue(t));
    assert.ok(cues.every((c) => c.hold));
    assert.equal(cues[0].front, 'A');
    assert.equal(cues.at(-1)?.front, 'B');
    assert.ok(Math.min(...cues.map((c) => c.turn)) < -0.99);
    assert.equal(ringCue(DEMO_LENGTH + 0.1).hold, false);
  });
});

describe('ring demo: the marks', () => {
  it('shows a mark only after the gesture round it, on A and then on B, and never drawn as it goes', () => {
    const seen: string[] = [];
    for (const [, f] of frames(pairs[0], 0.01)) {
      for (const m of f.marks) if (seen.at(-1) !== m.card) seen.push(m.card);
      // Once there, a mark is whole: closed, every time.
      for (const m of f.marks) {
        const first = m.points[0];
        const last = m.points.at(-1);
        assert.ok(last && Math.hypot(first.u - last.u, first.v - last.v) < 1e-9, 'closed');
      }
    }
    assert.deepEqual(seen, ['A', 'B']);
    const gestureEnds = frames(pairs[0], 0.01).find(([, f]) => f.marks.length > 0);
    assert.ok(gestureEnds && gestureEnds[0] > 2.7, 'not before the cursor has gone round');
  });

  it('settles on its target: round it, just outside the box', () => {
    for (const targets of pairs) {
      const settled = demoAt(4, resolve, targets).marks.find((m) => m.card === 'A');
      assert.ok(settled, 'A is marked by 4s');
      const [u0, v0, u1, v1] = targets.A.box;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      // The outline reaches past the box on every side, but not far.
      const us = settled.points.map((p) => p.u);
      const vs = settled.points.map((p) => p.v);
      assert.ok(Math.min(...us) < u0 + 1e-9 && Math.max(...us) > u1 - 1e-9);
      assert.ok(Math.min(...vs) < v0 + 1e-9 && Math.max(...vs) > v1 - 1e-9);
      for (const p of settled.points)
        assert.ok(Math.abs(p.u - cu) < u1 - u0 && Math.abs(p.v - cv) < v1 - v0, 'not far');
    }
  });

  it('is silent unless marking: nothing while entering, dragging or between the cards', () => {
    for (const [t, f] of frames(pairs[0], 0.01)) {
      const cue = ringCue(t);
      if (t < 0.99 || cue.turn !== 0 || f.pressed > 0)
        assert.equal(f.talking, 0, `at ${t.toFixed(2)}s`);
    }
    assert.equal(demoAt(DEMO_LENGTH + 1, resolve, pairs[0]).talking, 0);
  });

  it('starts talking before the cursor starts its gesture', () => {
    // The cursor rests on the first picture from 1s and starts round its target at 1.7s.
    const resting = demoAt(1.69, resolve, pairs[0]);
    assert.ok(resting.talking > 0.9, `already talking: ${resting.talking.toFixed(2)}`);
    assert.equal(resting.marks.length, 0);
  });

  it('talks between 0 and 1, loudest while marking', () => {
    const all = frames(pairs[0], 0.01);
    for (const [, f] of all) assert.ok(f.talking >= 0 && f.talking <= 1);
    assert.ok(all.some(([, f]) => f.marks.some((m) => m.opacity === 1) && f.talking === 1));
  });
});

describe('ring demo: the visitor takes over', () => {
  it('waits for the delay, stands aside while held, and starts over a few seconds after', () => {
    assert.equal(showTime(DEMO_DELAY - 0.1, null, false), -1);
    assert.equal(showTime(DEMO_DELAY + 1, null, false), 1);
    assert.equal(showTime(10, 9, true), -1, 'held');
    assert.equal(showTime(10, 9, false), -1, 'just let go');
    assert.equal(showTime(9 + DEMO_RESUME, 9, false), 0, 'from the top');
    assert.equal(showTime(9 + DEMO_RESUME + 2, 9, false), 2);
  });
});

describe('ring pictures', () => {
  it('give every picture a target box on its card, the right way round', () => {
    assert.equal(RING_PICTURES.length, 15);
    for (const { src, target } of RING_PICTURES) {
      const [u0, v0, u1, v1] = target.box;
      assert.ok(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1, src);
      assert.ok(target.why.length > 10, src);
    }
  });
});

describe('ring demo: the waveform', () => {
  it('gives every bar a height from 0 to 1, taller when talking', () => {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    for (let t = 0; t < 4; t += 0.37) {
      const bars = waveform(40, t, 1);
      assert.equal(bars.length, 40);
      assert.ok(bars.every((h) => h >= 0 && h <= 1));
      assert.ok(sum(bars) > sum(waveform(40, t, 0.25)));
      assert.ok(
        waveform(40, t, 0).every((h) => h === waveform(40, t, 0)[0]),
        'flat when silent',
      );
    }
  });
});
