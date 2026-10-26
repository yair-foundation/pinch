import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cardPoint,
  coverScale,
  frontAngle,
  introAngle,
  introTurn,
  introVelocity,
  lens,
  modelMatrix,
  multiply,
  perspective,
  pictureFor,
  pose,
  project,
  RING_DEFAULTS,
  ringGeometry,
  TAU,
  translate,
} from '../ring-motion';

const o = RING_DEFAULTS;

describe('ring: pictures on cards', () => {
  it('puts every picture on the ring and none beside itself, across the seam too', () => {
    for (let n = 2; n <= 24; n++) {
      for (const count of [ringGeometry(n, o).count, n + 1, 2 * n + 1]) {
        // Two pictures can't alternate round an odd ring.
        if (n === 2 && count % 2) continue;
        const cards = Array.from({ length: count }, (_, i) => pictureFor(i, n, count));
        assert.equal(new Set(cards).size, n, `${n} pictures on ${count}`);
        for (let i = 0; i < count; i++)
          assert.notEqual(cards[i], cards[(i + 1) % count], `${n} pictures on ${count}, card ${i}`);
      }
    }
  });

  it('gives one card per picture past the minimum', () => {
    assert.equal(ringGeometry(15, o).count, 15);
    assert.equal(ringGeometry(3, o).count, o.minCards);
    assert.equal(pictureFor(0, 0, 10), -1);
  });

  it('fills a card like cover', () => {
    assert.deepEqual(coverScale(2, 1), [0.5, 1]);
    assert.deepEqual(coverScale(0.5, 1), [1, 0.5]);
  });
});

describe('ring: the intro', () => {
  const g = ringGeometry(15, o);
  const turn = introTurn(o, g, -1);
  const drift = o.autoSpeed;

  it('spins whole cards, so it lands with a card in front', () => {
    const cards = turn / g.step;
    assert.ok(Math.abs(cards - Math.round(cards)) < 1e-9);
    assert.ok(Math.abs(turn) > TAU);
  });

  it('lands on card 0 already drifting, so the drift carries on without a stop', () => {
    assert.ok(Math.abs(introAngle(o.introDuration, turn, drift, o.introDuration)) < 1e-12);
    assert.equal(introVelocity(o.introDuration, turn, drift, o.introDuration), drift);
    const dt = 1e-4;
    const before = introAngle(o.introDuration - dt, turn, drift, o.introDuration);
    assert.ok(Math.abs(-before / dt - drift) < 1e-3);
  });

  it('starts fast and slows down', () => {
    const v = (t: number) => Math.abs(introVelocity(t, turn, drift, o.introDuration));
    assert.ok(v(0) > 15);
    assert.ok(v(0.5) < v(0) && v(1) < v(0.5) && v(1.5) < v(1));
  });

  it('grows from a speck into the settled pose', () => {
    assert.ok(pose(0, o).scale < 0.1);
    assert.deepEqual(pose(3, o, true), pose(10, o, true));
    assert.equal(pose(0, o, true).pitch, o.pitch);
  });
});

describe('ring: the camera', () => {
  // The settled ring seen through the lens, for a canvas of this shape.
  function extent(aspect: number) {
    const g = ringGeometry(15, o);
    const { distance, tanY } = lens(aspect, g.radius);
    const m = multiply(
      multiply(perspective(tanY, aspect, 0.05, 50), translate(0, 0, -distance)),
      modelMatrix(pose(0, o, true), g.radius),
    );
    let x = 0;
    let y = 0;
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.01)
      for (const h of [-0.5, 0.5]) {
        const [px, py] = project(m, Math.sin(a) * g.radius, h, Math.cos(a) * g.radius);
        x = Math.max(x, Math.abs(px));
        y = Math.max(y, Math.abs(py));
      }
    return { x, y };
  }

  for (const [name, aspect] of [
    ['a phone', 375 / 300],
    ['a laptop strip', 1440 / 300],
    ['a square', 1],
  ] as const)
    it(`fits the ring on ${name}`, () => {
      const { x, y } = extent(aspect);
      assert.ok(x <= 1 && y <= 1, `x ${x.toFixed(2)}, y ${y.toFixed(2)}`);
    });
});

describe('ring: points on a card', () => {
  const g = ringGeometry(15, o);
  const aspect = 1440 / 600;
  const { distance, tanY } = lens(aspect, g.radius);
  const m = multiply(
    multiply(perspective(tanY, aspect, 0.05, 50), translate(0, 0, -distance)),
    modelMatrix(pose(0, o, true), g.radius),
  );

  it('maps across to the right and down to down, on screen', () => {
    const [x0, y0] = cardPoint(m, g, 0, 0.2, 0.2);
    const [x1, y1] = cardPoint(m, g, 0, 0.8, 0.8);
    assert.ok(x1 > x0, 'across');
    assert.ok(y1 < y0, 'down (clip space grows upwards)');
  });

  it('keeps the front card on screen, and moves a card left as the ring turns left', () => {
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const [x, y] = cardPoint(m, g, 0, u, v);
      assert.ok(Math.abs(x) < 1 && Math.abs(y) < 1);
    }
    assert.ok(cardPoint(m, g, -g.step / 2, 0.5, 0.5)[0] < cardPoint(m, g, 0, 0.5, 0.5)[0]);
  });

  it('finds the nearest angle with a card in front', () => {
    assert.equal(frontAngle(g.step * 2.4, g), g.step * 2);
    assert.equal(frontAngle(-g.step * 0.6, g), -g.step);
  });
});
