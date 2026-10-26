/**
 * The landing's demo (D135), the pure part: a cursor comes into the ring's frame and gestures
 * round something on the picture in front, as someone explaining their taste would; once the
 * gesture ends, Pinch's mark settles on that thing, as if recognised. Then the cursor grabs the
 * ring, drags the next picture in front, does the same on that one, and leaves. While it points
 * it "talks", which the waveform shows. `src/components/pin/ring-demo.tsx` draws it.
 *
 * Times are in seconds from the start of a loop. Places are on a card, `u` across and `v` down
 * from 0 to 1, or on the frame's edge as shares of its width and height. Card A is the one in
 * front when the demo starts, B the one after it; each has a target (`ring-pictures.ts`).
 */

import type { RingTarget } from './ring-pictures';

export type CardRef = 'A' | 'B';
export type OnCard = { card: CardRef; u: number; v: number };
export type Where = OnCard | { edge: [number, number] };
export type Px = [number, number];
export type Targets = Record<CardRef, RingTarget>;

/** What the ring should do: hold a card in front, and how far it is turned from it, in cards. */
export type RingCue = { hold: boolean; front: CardRef; turn: number };

/** A mark: a closed outline on a card, and how much of it shows. */
export type DemoMark = { card: CardRef; points: OnCard[]; opacity: number };

export type DemoFrame = RingCue & {
  /** Where the cursor's tip is, or null when it is out of the frame. */
  cursor: Px | null;
  /** How far the button is down, 0 to 1. */
  pressed: number;
  /** How loudly someone is talking, 0 to 1. */
  talking: number;
  marks: DemoMark[];
};

/** Where a place is now, in pixels; it depends on which card is in front and how far it's turned. */
export type Resolve = (where: Where, ring: RingCue) => Px;

/** When the first loop starts, after the ring starts to spin in. */
export const DEMO_DELAY = 3;
/** One loop: the demo, then the ring drifting on its own until the next. */
export const DEMO_LOOP = 18;
/** Seconds after the visitor last touched the ring before the demo starts over. */
export const DEMO_RESUME = 4;
/** The talking level while the cursor isn't marking anything: silent, a flat line. */
export const IDLE_TALK = 0;

const PHASES = [
  ['enter', 1.0],
  ['rest', 0.7],
  ['gestureA', 1.4],
  ['markA', 0.4],
  ['lingerA', 1.0],
  ['toGrab', 0.6],
  ['press', 0.15],
  ['drag', 1.1],
  ['drop', 0.15],
  ['pause', 0.35],
  ['toB', 0.8],
  ['gestureB', 1.4],
  ['markB', 0.4],
  ['lingerB', 1.1],
  ['exit', 1.0],
] as const;

type Phase = (typeof PHASES)[number][0];

/** How long the demo itself lasts, within a loop. */
export const DEMO_LENGTH = PHASES.reduce((sum, [, d]) => sum + d, 0);

const order = (phase: Phase) => PHASES.findIndex(([name]) => name === phase);

/** The phase at a time, and how far through it (0 to 1); null outside the demo. */
function phaseAt(t: number): { phase: Phase; p: number } | null {
  if (t < 0) return null;
  let start = 0;
  for (const [phase, d] of PHASES) {
    if (t < start + d) return { phase, p: (t - start) / d };
    start += d;
  }
  return null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const signedPow = (x: number, e: number) => Math.sign(x) * Math.abs(x) ** e;

/**
 * A loop round a target's box, clockwise on screen from its top left: a superellipse, so `n` 2 is
 * an ellipse and a large `n` a rounded rectangle. `grow` widens it past the box; `hand` makes it a
 * little uneven, like a gesture rather than a shape.
 */
function loop(card: CardRef, target: RingTarget, n: number, grow: number, hand: number) {
  const [u0, v0, u1, v1] = target.box;
  const cx = (u0 + u1) / 2;
  const cy = (v0 + v1) / 2;
  // An ellipse has to reach past the box's corners to go round it.
  const fit = n === 2 ? Math.SQRT2 : 1;
  const ax = ((u1 - u0) / 2) * fit * grow;
  const ay = ((v1 - v0) / 2) * fit * grow;
  return (p: number): OnCard => {
    const a = -0.75 * Math.PI + p * Math.PI * 2;
    const wobble = 1 + hand * Math.sin(3 * a + 1);
    return {
      card,
      u: cx + ax * wobble * signedPow(Math.cos(a), 2 / n),
      v: cy + ay * wobble * signedPow(Math.sin(a), 2 / n),
    };
  };
}

/**
 * A path walked at an even pace: `p` is the share of its length, not of its angle, which a
 * squircle's corners would otherwise rush through. Lengths are on the card, a card being 0.8 as
 * wide as it is tall.
 */
function evenly(path: (p: number) => OnCard, to = 1, steps = 240): (p: number) => OnCard {
  const points = Array.from({ length: steps + 1 }, (_, i) => path((i / steps) * to));
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const du = (points[i].u - points[i - 1].u) * 0.8;
    const dv = points[i].v - points[i - 1].v;
    lengths.push(lengths[i - 1] + Math.hypot(du, dv));
  }
  const total = lengths[steps];
  return (p) => {
    const want = clamp01(p) * total;
    let i = 1;
    while (i < steps && lengths[i] < want) i++;
    const span = lengths[i] - lengths[i - 1] || 1;
    const f = (want - lengths[i - 1]) / span;
    const [a, b] = [points[i - 1], points[i]];
    return { card: a.card, u: lerp(a.u, b.u, f), v: lerp(a.v, b.v, f) };
  };
}

/** The gesture: loose, a little wide of the target, and round once and a bit more. */
const gesture = (card: CardRef, target: RingTarget) =>
  evenly(loop(card, target, target.shape === 'circle' ? 2 : 4, 1.12, 0.045), 1.08);

/** The mark Pinch settles on the target: clean and closed, a rounded rectangle or an ellipse. */
function outline(card: CardRef, target: RingTarget, scale: number, steps = 96): OnCard[] {
  const path = loop(card, target, target.shape === 'circle' ? 2 : 10, 1.04 * scale, 0);
  return Array.from({ length: steps + 1 }, (_, i) => path(i / steps));
}

/** What the ring should do at a time: held from the cursor's arrival until it has left. */
export function ringCue(t: number): RingCue {
  const at = phaseAt(t);
  if (!at) return { hold: false, front: 'A', turn: 0 };
  return {
    hold: true,
    front: order(at.phase) > order('drag') ? 'B' : 'A',
    turn: at.phase === 'drag' ? -easeInOut(at.p) : 0,
  };
}

/**
 * The talking level through the demo: someone speaks only while marking something, from the
 * start of the gesture to the pause after the mark settles, and is silent while moving between.
 */
function talkingAt(phase: Phase, p: number): number {
  switch (phase) {
    // The voice leads: it starts while the cursor settles on the first picture, and on its way
    // to the second, before the gesture.
    case 'rest':
      return smooth(0, 0.4, p);
    case 'toB':
      return smooth(0.55, 0.85, p);
    case 'gestureA':
    case 'gestureB':
    case 'markA':
    case 'lingerA':
    case 'markB':
    case 'lingerB':
      return 1;
    case 'toGrab':
    case 'exit':
      return 1 - smooth(0, 0.3, p);
    default:
      return IDLE_TALK;
  }
}

/** A move between two places, eased, bowing a little to one side as a hand would. */
function move(from: Px, to: Px, p: number, bow = 0.12): Px {
  const e = easeInOut(p);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lift = Math.sin(Math.PI * e) * bow;
  return [from[0] + dx * e - dy * lift, from[1] + dy * e + dx * lift];
}

/** A point off a target's box to rest beside once it's marked, and one to grab the card by. */
const beside = (card: CardRef, { box }: RingTarget): OnCard => ({
  card,
  u: Math.min(0.92, box[2] + 0.04),
  v: Math.min(0.92, box[3] + 0.04),
});
const handle = (card: CardRef, { box }: RingTarget): OnCard => ({
  card,
  // Away from the mark, on the side the drag pulls from.
  u: 0.86,
  v: box[3] < 0.6 ? 0.78 : 0.3,
});

const ENTER_FROM: Where = { edge: [1.06, 0.92] };
const EXIT_TO: Where = { edge: [1.06, 0.18] };

/** Everything the demo shows at a time within a loop, for the targets on cards A and B. */
export function demoAt(t: number, resolve: Resolve, targets: Targets): DemoFrame {
  const cue = ringCue(t);
  const at = phaseAt(t);
  if (!at) return { ...cue, cursor: null, pressed: 0, talking: IDLE_TALK, marks: [] };
  const { phase, p } = at;
  const where = (w: Where) => resolve(w, cue);
  const past = (name: Phase) => order(phase) > order(name);

  const gestureA = gesture('A', targets.A);
  const gestureB = gesture('B', targets.B);
  const restA = beside('A', targets.A);
  const grab = handle('A', targets.A);
  const restB = beside('B', targets.B);

  // The marks appear only once the gesture is over, settling from a touch larger as they fade in.
  // A slides away with its card as it's dragged off; B fades as the cursor leaves.
  const marks: DemoMark[] = [];
  if (phase === 'markA') {
    marks.push({
      card: 'A',
      points: outline('A', targets.A, lerp(1.08, 1, easeOutBack(p))),
      opacity: smooth(0, 0.6, p),
    });
  } else if (past('markA') && !past('drag')) {
    marks.push({
      card: 'A',
      points: outline('A', targets.A, 1),
      opacity: phase === 'drag' ? 1 - smooth(0.3, 0.9, p) : 1,
    });
  }
  if (phase === 'markB') {
    marks.push({
      card: 'B',
      points: outline('B', targets.B, lerp(1.08, 1, easeOutBack(p))),
      opacity: smooth(0, 0.6, p),
    });
  } else if (past('markB')) {
    marks.push({
      card: 'B',
      points: outline('B', targets.B, 1),
      opacity: phase === 'exit' ? 1 - smooth(0, 0.6, p) : 1,
    });
  }

  let cursor: Px;
  let pressed = 0;
  switch (phase) {
    case 'enter':
      cursor = move(where(ENTER_FROM), where(gestureA(0)), p, -0.15);
      break;
    case 'rest': {
      const start = gestureA(0);
      cursor = where({ ...start, u: start.u + 0.006 * Math.sin(p * Math.PI * 3) });
      break;
    }
    case 'gestureA':
      cursor = where(gestureA(easeSine(p)));
      break;
    case 'markA':
      cursor = where(gestureA(1));
      break;
    case 'lingerA':
      cursor = move(where(gestureA(1)), where(restA), p, 0);
      break;
    case 'toGrab':
      cursor = move(where(restA), where(grab), p);
      break;
    case 'press':
      cursor = where(grab);
      pressed = p;
      break;
    case 'drag':
      cursor = where(grab);
      pressed = 1;
      break;
    case 'drop':
      cursor = where(grab);
      pressed = 1 - p;
      break;
    case 'pause':
      cursor = where(grab);
      break;
    case 'toB':
      cursor = move(where(grab), where(gestureB(0)), p);
      break;
    case 'gestureB':
      cursor = where(gestureB(easeSine(p)));
      break;
    case 'markB':
      cursor = where(gestureB(1));
      break;
    case 'lingerB':
      cursor = move(where(gestureB(1)), where(restB), p, 0);
      break;
    case 'exit':
      cursor = move(where(restB), where(EXIT_TO), p, 0.1);
      break;
  }
  return { ...cue, cursor, pressed, talking: talkingAt(phase, p), marks };
}

/**
 * Where the demo is in its loop at a ring time `t`, given when the visitor last touched the ring
 * and whether they still hold it: -1 while it waits or stands aside, then seconds into the loop.
 * The first loop starts `DEMO_DELAY` in; a touch puts it off until `DEMO_RESUME` after the touch.
 */
export function showTime(t: number, touchedAt: number | null, dragging: boolean): number {
  if (dragging) return -1;
  const start = touchedAt === null ? DEMO_DELAY : Math.max(DEMO_DELAY, touchedAt + DEMO_RESUME);
  return t < start ? -1 : (t - start) % DEMO_LOOP;
}

// Value noise: smooth randomness that is the same for the same input, so the waveform is pure.
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const noise = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  return lerp(hash(i), hash(i + 1), f * f * (3 - 2 * f));
};
const noise2 = (x: number, y: number) => {
  const j = Math.floor(y);
  const f = y - j;
  return lerp(noise(x + j * 57.3), noise(x + (j + 1) * 57.3), f * f * (3 - 2 * f));
};

/**
 * The waveform's bars at a time: `count` heights from 0 to 1, louder with `level`, and flat when
 * it is 0. Shaped like speech: syllables about five a second, each as strong as it happens to be,
 * phrases with short gaps between them, and every bar flickering on its own, taller in the middle.
 */
export function waveform(count: number, t: number, level: number): number[] {
  const syllable = clamp01(noise(t * 5.2) * 1.6 - 0.25);
  const phrase = smooth(0.1, 0.3, noise(t * 0.7 + 17));
  const loud = level * (0.35 + 0.65 * syllable) * (0.45 + 0.55 * phrase);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1);
    const envelope = 0.3 + 0.7 * Math.sin(Math.PI * x);
    // Squared, so most bars sit lower and a few spike well above them.
    const voice = (0.25 + 0.6 * noise2(i * 0.45, t * 7) + 0.3 * noise2(i * 1.3 + 9, t * 19)) ** 2;
    out.push(clamp01(0.05 + envelope * loud * voice * 1.5));
  }
  return out;
}
