import type { Shape } from './model';

/*
 * A mark said in words (D166): where it sits, the text under it and its main colours, as a line
 * under its note. In the author's trial this, with close-ups dimmed around the spot, won 5 of 6
 * pairs against the mark drawn on the close-up (docs/hand-vs-pinch.md). Pure: the text comes from
 * `screen-text.ts` and the pixels from `render.ts`.
 */

/** A part of an image, in fractions of it. */
export type Spot = { x: number; y: number; w: number; h: number };
/** A line of text read off a screen, in fractions of it. */
export type TextLine = Spot & { text: string };

/** A dot's spot reaches this far either side of it, as a fraction of the image's width. */
const DOT_REACH = 0.03;
const MOST_OF_THE_SCREEN = 0.4;
const MOST_WORDS = 12;
const MOST_COLOURS = 3;
/** A colour under this share of the spot is a speck. */
const SPECK = 0.04;
/** Colours closer than this count as one. */
const NEAR = 32;

export function spotOf(shape: Shape, width: number, height: number): Spot {
  if (shape.kind === 'area') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const reach = (DOT_REACH * width) / height;
  return {
    x: Math.max(0, shape.x - DOT_REACH),
    y: Math.max(0, shape.y - reach),
    w: 2 * DOT_REACH,
    h: 2 * reach,
  };
}

export const isWholeScreen = (q: Spot) => q.w >= 0.999 && q.h >= 0.999;

export function placeOf(q: Spot): string {
  if (q.w * q.h >= MOST_OF_THE_SCREEN) return 'most of the screen';
  const x = q.x + q.w / 2;
  const y = q.y + q.h / 2;
  const row = y < 1 / 3 ? 'top' : y < 2 / 3 ? 'middle' : 'bottom';
  const column = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'centre' : 'right';
  return row === 'middle' && column === 'centre' ? 'the middle' : `${row} ${column}`;
}

/**
 * A line without what icons get read as: stray characters, often at high confidence, so their
 * confidence can't tell them. A word stays with two letters or digits in a row, or as a number.
 */
export const cleanLine = (text: string) =>
  text
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]{2}/u.test(w) || /^[$£€#@+]?\p{N}/u.test(w))
    .join(' ');

/** The text under a spot: the lines whose middle is inside it, top to bottom, once each. */
export function textIn(lines: readonly TextLine[], q: Spot): string {
  const inside = lines
    .filter((l) => {
      const x = l.x + l.w / 2;
      const y = l.y + l.h / 2;
      return x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((l) => cleanLine(l.text))
    .filter((text, i, all) => text && all.indexOf(text) === i);
  if (!inside.length) return '';
  const words = inside.join(' / ').split(/\s+/);
  return words.length > MOST_WORDS ? `${words.slice(0, MOST_WORDS).join(' ')} …` : words.join(' ');
}

const hex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** A spot's main colours, most first, from its pixels as a canvas gives them. */
export function mainColours(data: Uint8ClampedArray): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += data[i];
    bucket.g += data[i + 1];
    bucket.b += data[i + 2];
    buckets.set(key, bucket);
  }
  const total = data.length / 4;
  const kept: number[][] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    if (b.n / total < SPECK) break;
    const c = [b.r / b.n, b.g / b.n, b.b / b.n];
    if (kept.some((k) => Math.hypot(k[0] - c[0], k[1] - c[1], k[2] - c[2]) < NEAR)) continue;
    kept.push(c);
  }
  return kept.slice(0, MOST_COLOURS).map(hex);
}

/** A pixel's colour, from its bytes as a canvas gives them. */
export const colourOf = (data: Uint8ClampedArray) => hex([data[0], data[1], data[2]]);

/**
 * `at` is the colour right under a point (D188): "this color" was said with the pointer on a coral
 * dot, the spot's main colours were the map around it, and the agent took one of those.
 */
export function whereLine(
  q: Spot,
  text: string,
  colours: readonly string[],
  at?: string,
): string {
  const whole = isWholeScreen(q);
  const place = whole ? 'the whole screen' : placeOf(q);
  const on = !whole && text ? `, on "${text}"` : '';
  const point = !whole && at ? ` At the point: ${at}.` : '';
  return `Where: ${place}${on}.${point} Colours: ${colours.join(', ')}.`;
}
