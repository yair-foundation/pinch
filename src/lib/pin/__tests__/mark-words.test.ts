import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  colourOf,
  cleanLine,
  isSmallSpot,
  isWholeScreen,
  mainColours,
  placeOf,
  spotOf,
  type TextLine,
  textIn,
  whereLine,
  whereWithoutColours,
} from '../mark-words';

const line = (text: string, x: number, y: number, w = 0.1, h = 0.02): TextLine => ({
  text,
  x,
  y,
  w,
  h,
});

/** Pixels as a canvas gives them, in runs of one colour. */
function pixels(...runs: [number, [number, number, number]][]) {
  const out: number[] = [];
  for (const [n, [r, g, b]] of runs) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}

describe('where a mark is', () => {
  it('takes an area as it is, and a dot as a small square around it', () => {
    assert.deepEqual(spotOf({ kind: 'area', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1000, 500), {
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    });
    const dot = spotOf({ kind: 'dot', x: 0.5, y: 0.5 }, 1000, 500);
    assert.equal(dot.w, 0.06);
    assert.equal(dot.h, 0.12);
    assert.equal(dot.x, 0.47);
    assert.equal(dot.y, 0.44);
  });

  it('keeps a dot at an edge on the image', () => {
    const dot = spotOf({ kind: 'dot', x: 0, y: 0 }, 1000, 1000);
    assert.equal(dot.x, 0);
    assert.equal(dot.y, 0);
  });

  it('says it in words', () => {
    assert.equal(placeOf({ x: 0, y: 0, w: 0.1, h: 0.1 }), 'top left');
    assert.equal(placeOf({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 }), 'the middle');
    assert.equal(placeOf({ x: 0.45, y: 0.9, w: 0.1, h: 0.1 }), 'bottom centre');
    assert.equal(placeOf({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }), 'most of the screen');
  });

  it('knows a mark on the whole screen', () => {
    assert.equal(isWholeScreen({ x: 0, y: 0, w: 1, h: 1 }), true);
    assert.equal(isWholeScreen({ x: 0, y: 0, w: 0.9, h: 1 }), false);
  });
});

describe('the text under a mark', () => {
  const spot = { x: 0, y: 0, w: 0.5, h: 0.5 };

  it('takes the lines whose middle is inside, top to bottom', () => {
    const lines = [
      line('Second', 0.1, 0.3),
      line('First', 0.1, 0.1),
      line('Outside', 0.8, 0.1),
      line('Half out', 0.42, 0.1),
    ];
    assert.equal(textIn(lines, spot), 'First / Half out / Second');
  });

  it('says a repeated line once, and stops at twelve words', () => {
    assert.equal(textIn([line('Same', 0.1, 0.1), line('Same', 0.1, 0.2)], spot), 'Same');
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    assert.equal(
      textIn([line(long, 0.1, 0.1)], spot),
      'one two three four five six seven eight nine ten eleven twelve …',
    );
  });

  it('is empty when there is none', () => {
    assert.equal(textIn([], spot), '');
    assert.equal(textIn([line('国', 0.1, 0.1)], spot), '');
  });

  it('drops what an icon was read as, and keeps words and numbers', () => {
    assert.equal(cleanLine('自 Admin roles documentation'), 'Admin roles documentation');
    assert.equal(cleanLine('国'), '');
    assert.equal(cleanLine('▼'), '');
    assert.equal(cleanLine('$19 a month'), '$19 month');
    assert.equal(cleanLine('0'), '0');
    assert.equal(cleanLine('设置 页面'), '设置 页面');
  });
});

describe("a spot's colours", () => {
  it('gives the main ones, most first, as hex', () => {
    const data = pixels([60, [255, 255, 255]], [40, [26, 26, 46]]);
    assert.deepEqual(mainColours(data), ['#ffffff', '#1a1a2e']);
  });

  it('counts near neighbours as one, and leaves out specks', () => {
    const data = pixels([60, [255, 255, 255]], [38, [239, 239, 239]], [2, [255, 0, 0]]);
    assert.deepEqual(mainColours(data), ['#ffffff']);
  });

  it('gives three at most', () => {
    const data = pixels(
      [30, [255, 255, 255]],
      [25, [0, 0, 0]],
      [25, [255, 0, 0]],
      [20, [0, 0, 255]],
    );
    assert.equal(mainColours(data).length, 3);
  });
});

describe('the line under a note', () => {
  it('says where, what is there and the colours', () => {
    assert.equal(
      whereLine({ x: 0.4, y: 0, w: 0.2, h: 0.1 }, 'Choose a plan', ['#f2f4f5', '#020202']),
      'Where: top centre, on "Choose a plan". Colours: #f2f4f5, #020202.',
    );
  });

  it('leaves out text it has none of, and any text on the whole screen', () => {
    assert.equal(
      whereLine({ x: 0, y: 0, w: 0.1, h: 0.1 }, '', ['#ffffff']),
      'Where: top left. Colours: #ffffff.',
    );
    assert.equal(
      whereLine({ x: 0, y: 0, w: 1, h: 1 }, 'Everything', ['#ffffff']),
      'Where: the whole screen. Colours: #ffffff.',
    );
  });

  it('says the colour right under a point, ahead of the colours around it (D188)', () => {
    assert.equal(
      whereLine({ x: 0.26, y: 0.5, w: 0.06, h: 0.06 }, 'New York', ['#072c23', '#bce5e5'], '#fa877d'),
      'Where: middle left, on "New York". At the point: #fa877d. Colours: #072c23, #bce5e5.',
    );
    assert.equal(colourOf(new Uint8ClampedArray([250, 135, 125, 255])), '#fa877d');
    assert.equal(
      whereLine({ x: 0, y: 0, w: 1, h: 1 }, '', ['#ffffff'], '#000000'),
      'Where: the whole screen. Colours: #ffffff.',
    );
  });
});

describe('a mark said without its colours (D192, D198)', () => {
  it('keeps where it is and the text there', () => {
    assert.equal(
      whereWithoutColours('Where: middle left, on "New York". At the point: #fa877d. Colours: #072c23.'),
      'Where: middle left, on "New York".',
    );
    assert.equal(whereWithoutColours('Where: top left. Colours: #ffffff.'), 'Where: top left.');
  });

  it('keeps the colour under a point with no text, to tell it from a spot beside it', () => {
    assert.equal(
      whereWithoutColours('Where: top right. At the point: #3b82f6. Colours: #ffffff, #3b82f6.'),
      'Where: top right. At the point: #3b82f6.',
    );
  });
});

describe('which spots need a close-up (D193)', () => {
  it('is a point, and an area under a hundredth of the screen', () => {
    assert.equal(isSmallSpot({ kind: 'dot', x: 0.4, y: 0.4 }), true);
    // An icon or a label.
    assert.equal(isSmallSpot({ kind: 'area', x: 0.1, y: 0.1, w: 0.05, h: 0.09 }), true);
    // A title across a third of the screen, a chart, the whole screen.
    assert.equal(isSmallSpot({ kind: 'area', x: 0.07, y: 0.04, w: 0.34, h: 0.04 }), false);
    assert.equal(isSmallSpot({ kind: 'area', x: 0.04, y: 0.38, w: 0.9, h: 0.46 }), false);
    assert.equal(isSmallSpot({ kind: 'area', x: 0, y: 0, w: 1, h: 1 }), false);
  });
  it('is an arrow between two things close together, and not one across the screen', () => {
    assert.equal(isSmallSpot({ kind: 'arrow', x: 0.3, y: 0.3, x2: 0.4, y2: 0.35 }), true);
    assert.equal(isSmallSpot({ kind: 'arrow', x: 0.66, y: 0.75, x2: 0.06, y2: 0.51 }), false);
  });
});

describe('a note with nothing pointed at (D194)', () => {
  it('says so in place of where, with no colours', () => {
    const whole = { x: 0, y: 0, w: 1, h: 1 };
    assert.equal(whereLine(whole, '', ['#ffffff'], undefined, true), 'Where: not pointed at.');
    assert.equal(whereLine(whole, '', ['#ffffff']), 'Where: the whole screen. Colours: #ffffff.');
  });
});
