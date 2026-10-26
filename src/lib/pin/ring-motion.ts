/**
 * The landing's ring of pictures (D133), the pure parts: where each card sits, how the ring
 * spins in, what the camera sees and which picture goes on which card. The WebGL that draws it is
 * `src/components/pin/ring-gallery.tsx`.
 *
 * The cards stand round a cylinder of height 1, leaning back (`pitch`) and a little to one side
 * (`roll`). Angles are in radians, times in seconds; a card at angle 0 faces the camera.
 */

export const TAU = Math.PI * 2;

export type RingOptions = {
  /** Cards on the ring when there are fewer pictures. */
  minCards: number;
  /** Card width / height. */
  cardAspect: number;
  /** Space between cards, as a share of a card's width. */
  gap: number;
  /** Rounding of a card's corners, as a share of its height. */
  corner: number;
  /** Radians a second once settled; negative drifts left. */
  autoSpeed: number;
  /** Turns spun during the intro, and how long until it settles on a card. */
  introSpin: number;
  introDuration: number;
  /** Seconds of motion smeared into each frame. */
  shutter: number;
  pitch: number;
  roll: number;
};

export const RING_DEFAULTS: RingOptions = {
  minCards: 10,
  cardAspect: 0.8,
  gap: 0.14,
  corner: 0.04,
  autoSpeed: -0.09,
  introSpin: 1.5,
  introDuration: 1.7,
  shutter: 1 / 40,
  pitch: -0.24,
  roll: -0.07,
};

export type Geometry = { count: number; step: number; arc: number; radius: number };

/** The ring for so many pictures: a card per picture, at least `minCards`, each 1 tall. */
export function ringGeometry(pictures: number, o: RingOptions): Geometry {
  const count = Math.max(o.minCards, pictures);
  const step = TAU / count;
  const arc = step / (1 + o.gap);
  return { count, step, arc, radius: o.cardAspect / arc };
}

/**
 * The picture on a card of a ring of `count`. The pictures repeat in order; when that would leave
 * the first picture on the last card too, beside itself across the seam, the last card takes one
 * from the middle.
 */
export function pictureFor(card: number, pictures: number, count: number): number {
  if (pictures <= 0) return -1;
  if (card === count - 1 && pictures > 1 && count % pictures === 1) return Math.floor(pictures / 2);
  return card % pictures;
}

/** The spin of the intro: whole cards, so it lands with card 0 in front. */
export function introTurn(o: RingOptions, g: Geometry, direction: number): number {
  return Math.round((o.introSpin * TAU) / g.step) * g.step * direction;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The ring's angle during the intro: it spins hard and slows onto card 0 at `introDuration`,
 * arriving already moving at the drift speed, so the drift carries on without a stop.
 */
export function introAngle(t: number, turn: number, drift: number, duration: number): number {
  return -turn * (1 - easeOutQuart(clamp01(t / duration))) + drift * (t - duration);
}

export function introVelocity(t: number, turn: number, drift: number, duration: number): number {
  if (t >= duration) return drift;
  return drift - (turn * 4 * (1 - t / duration) ** 3) / duration;
}

export type Pose = { scale: number; y: number; pitch: number; roll: number };

/**
 * Everything but the spin, on the clock: the ring grows from a speck high up, drops to the
 * middle and leans back into place, then sways a little. `still` gives the settled pose.
 */
export function pose(t: number, o: RingOptions, still = false): Pose {
  const at = still ? 10 : t;
  const settle = easeOutCubic(clamp01(at / 0.95));
  return {
    scale: lerp(0.07, 1, easeOutCubic(clamp01(at / 0.36))),
    y: lerp(0.55, 0.1, easeInOutCubic(clamp01((at - 0.12) / 0.5))),
    pitch: lerp(-0.42, o.pitch, settle),
    roll: lerp(0.34, o.roll, settle) + (still ? 0 : 0.025 * Math.sin(at * 0.55) * clamp01(at - 1)),
  };
}

/**
 * The camera: close, for the strong perspective of the reference, with the lens widened until
 * the ring fits across and the front card fits top to bottom, whichever needs more.
 */
export function lens(aspect: number, radius: number): { distance: number; tanY: number } {
  const distance = radius * 2;
  const across = radius / Math.sqrt(distance * distance - radius * radius) / 0.94;
  const tall = 0.5 / (distance - radius) / 0.7;
  return { distance, tanY: Math.max(across / aspect, tall) };
}

/** Scales a card's texture coordinates so the picture fills it like `object-fit: cover`. */
export function coverScale(pictureAspect: number, cardAspect: number): [number, number] {
  return pictureAspect > cardAspect
    ? [cardAspect / pictureAspect, 1]
    : [1, pictureAspect / cardAspect];
}

// Column-major 4x4 matrices, as WebGL takes them.
export type Mat4 = Float32Array;

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return out;
}

export function perspective(tanHalfY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / tanHalfY;
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ]);
}

export function translate(x: number, y: number, z: number): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotateX(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateZ(a: number): Mat4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function scaleBy(s: number): Mat4 {
  return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
}

/** The ring's placement. Leaning back lifts its front, so it drops by as much to stay at `p.y`. */
export function modelMatrix(p: Pose, radius: number): Mat4 {
  const y = p.y + radius * Math.sin(p.pitch) * p.scale;
  return multiply(
    translate(0, y, 0),
    multiply(rotateZ(p.roll), multiply(rotateX(p.pitch), scaleBy(p.scale))),
  );
}

/** Where a point lands on screen, in clip space from -1 to 1. */
export function project(m: Mat4, x: number, y: number, z: number): [number, number] {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw];
}

/**
 * Where a point of a card lands on screen, in clip space: `u` across the card and `v` down it,
 * both from 0 to 1, on the card standing at `angle` round the ring (0 in front). `m` is the whole
 * projection, view and model.
 */
export function cardPoint(m: Mat4, g: Geometry, angle: number, u: number, v: number) {
  const a = angle + (u - 0.5) * g.arc;
  return project(m, Math.sin(a) * g.radius, 0.5 - v, Math.cos(a) * g.radius);
}

/** The nearest angle that puts a card in front. */
export function frontAngle(angle: number, g: Geometry): number {
  return Math.round(angle / g.step) * g.step;
}
