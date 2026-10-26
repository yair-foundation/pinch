/**
 * The pictures on the landing's ring (D133), in order, and for each one the place the demo's
 * cursor points at (D135): something a designer would stop on and say why. The boxes are on the
 * card as it shows the picture (cropped to `RING_DEFAULTS.cardAspect`, 0.8, like `object-fit:
 * cover`), `[u0, v0, u1, v1]` from the top left, 0 to 1. A circle suits a round thing, an area
 * anything else. `why` is what the person would be saying; it isn't shown.
 */

export type RingTarget = {
  shape: 'area' | 'circle';
  box: [number, number, number, number];
  why: string;
};

export type RingPicture = { src: string; target: RingTarget };

const picture = (n: number, target: RingTarget): RingPicture => ({
  src: `/pin-notes/ring/${String(n).padStart(2, '0')}.webp`,
  target,
});

export const RING_PICTURES: RingPicture[] = [
  picture(1, {
    shape: 'area',
    box: [0.27, 0.486, 0.745, 0.594],
    why: 'A promo card with the next one peeking at the edge: the cut-off tells you it scrolls.',
  }),
  picture(2, {
    shape: 'area',
    box: [0.09, 0.2, 0.54, 0.41],
    why: 'A light serif at display size: the headline carries the voice without any bold.',
  }),
  picture(3, {
    shape: 'area',
    box: [0.425, 0.62, 0.915, 0.75],
    why: 'A heavy serif in capitals on a quiet paper panel: the headline carries the weight.',
  }),
  picture(4, {
    shape: 'area',
    box: [0.03, 0.57, 0.97, 0.83],
    why: 'Four subjects, four colours: the colour does the labelling.',
  }),
  picture(5, {
    shape: 'area',
    box: [0.47, 0.03, 0.71, 0.27],
    why: 'A quiet mono list in the empty top of the photo, clear of the fruit.',
  }),
  picture(6, {
    shape: 'area',
    box: [0.53, 0.23, 0.98, 0.78],
    why: 'Negative space: a whole dark panel holding one small form.',
  }),
  picture(7, {
    shape: 'area',
    box: [0.3, 0.555, 0.7, 0.645],
    why: 'A calm alert: a soft amber tint, an icon and one line, no red.',
  }),
  picture(8, {
    shape: 'circle',
    box: [0.22, 0.3, 0.66, 0.62],
    why: 'The brand made into an object you can hold.',
  }),
  picture(9, {
    shape: 'area',
    box: [0.1, 0.42, 0.86, 0.69],
    why: 'Status by colour and icon together, each state aligned on the right.',
  }),
  picture(10, {
    shape: 'circle',
    box: [0.32, 0.47, 0.54, 0.63],
    why: 'One control, labelled on the metal itself.',
  }),
  picture(11, {
    shape: 'area',
    box: [0.37, 0.265, 0.63, 0.335],
    why: 'The balance is the one big number; the decimals drop back.',
  }),
  picture(12, {
    shape: 'area',
    box: [0.21, 0.28, 0.79, 0.42],
    why: 'The name, then one line: the card says what it is in two steps.',
  }),
  picture(13, {
    shape: 'area',
    box: [0.33, 0.55, 0.97, 0.86],
    why: 'Room to breathe: half the panel left empty between the line and the button.',
  }),
  picture(14, {
    shape: 'area',
    box: [0.16, 0.025, 0.86, 0.095],
    why: 'A floating nav in a pill keeps the picture full-bleed.',
  }),
  picture(15, {
    shape: 'area',
    box: [0.2, 0.56, 0.92, 0.88],
    why: 'Suggestions as pills, each with its own coloured icon: the colour tells the kind.',
  }),
];
