import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Asset, Mark } from '../model';
import { batchSummary, imageSummary, noteLine, whereText } from '../summary';

const mark = (over: Partial<Mark> = {}): Mark => ({
  id: 'm1',
  shape: { kind: 'dot', x: 0.3, y: 0.33 },
  label: '',
  good: '',
  bad: '',
  origin: 'user',
  ...over,
});

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  name: 'Pricing page.png',
  type: 'image/png',
  width: 1600,
  height: 1000,
  note: '',
  marks: [],
  ...over,
});

describe('clipboard summary', () => {
  it('says where a note sits in whole percentages', () => {
    assert.equal(whereText({ kind: 'dot', x: 0.3, y: 0.333 }), 'dot at x 30%, y 33%');
    assert.equal(
      whereText({ kind: 'area', x: 0.31, y: 0.44, w: 0.37, h: 0.17 }),
      'area x 31–68%, y 44–61%',
    );
    assert.equal(
      whereText({ kind: 'arrow', x: 0.12, y: 0.4, x2: 0.8, y2: 0.41 }),
      'arrow from x 12%, y 40% to x 80%, y 41%',
    );
    assert.equal(
      noteLine(
        mark({ bad: 'Move it.', shape: { kind: 'arrow', x: 0.12, y: 0.4, x2: 0.8, y2: 0.41 } }),
        '01.1',
      ),
      '- 01.1 arrow from x 12%, y 40% to x 80%, y 41% · doesn\'t: "Move it."',
    );
  });

  it('writes one line per note with the name, both fields and the AI flags', () => {
    const both = mark({
      label: 'headline',
      good: 'Huge and\n alone.',
      bad: 'Six chips.',
      shape: { kind: 'area', x: 0.31, y: 0.44, w: 0.37, h: 0.17 },
    });
    assert.equal(
      noteLine(both, '02.3'),
      '- 02.3 area x 31–68%, y 44–61% · headline · works: "Huge and alone." · doesn\'t: "Six chips."',
    );
    const ai = mark({ bad: 'Grey on grey.', origin: 'ai', quote: 'grey', confirmed: false });
    assert.equal(
      noteLine(ai, '01.1'),
      '- 01.1 dot at x 30%, y 33% · doesn\'t: "Grey on grey." (AI, not checked)',
    );
    assert.doesNotMatch(noteLine({ ...ai, confirmed: true }, '01.1'), /not checked/);
    const accepted = mark({ good: 'Clear.', accepted: { good: 'Clear.' } });
    assert.match(noteLine(accepted, '01.1'), /works \(AI suggestion\): "Clear\."/);
    const edited = mark({ good: 'Very clear.', accepted: { good: 'Clear.' } });
    assert.match(noteLine(edited, '01.1'), /works \(AI suggestion, edited\): "Very clear\."/);
  });

  it('summarises one image with its header, source, overall note and notes in batch order', () => {
    const a = asset({
      note: 'Calm overall.',
      source: { kind: 'ours' },
      marks: [
        mark({ id: 'e', shape: { kind: 'dot', x: 0.9, y: 0.9 } }),
        mark({ good: 'Huge and alone.', label: 'headline' }),
        mark({
          id: 'm2',
          bad: 'Six chips.',
          shape: { kind: 'area', x: 0.1, y: 0.5, w: 0.5, h: 0.2 },
        }),
      ],
    });
    assert.equal(
      imageSummary(a, 1, 3),
      [
        '[pinch · Pricing page.png · 2 notes]',
        'Source: Ours',
        'Overall: "Calm overall."',
        '- 02.1 dot at x 30%, y 33% · headline · works: "Huge and alone."',
        '- 02.2 area x 10–60%, y 50–70% · doesn\'t: "Six chips."',
        'Positions are percentages of the image: x from the left edge, y from the top.',
        '',
      ].join('\n'),
    );
    // An image with nothing written: the header alone, no coordinates line.
    assert.equal(imageSummary(asset(), 0, 1), '[pinch · Pricing page.png · 0 notes]\n');
  });

  it('summarises a batch, leaving out images with nothing on them but keeping their numbers', () => {
    const blank = asset({ id: 'a0', name: 'blank.png' });
    const first = asset({ marks: [mark({ good: 'Clear.' })] });
    const third = asset({
      id: 'a3',
      name: 'Settings.png',
      marks: [mark({ bad: 'Dense.' }), mark({ id: 'm2', good: 'Aligned.' })],
    });
    const text = batchSummary([blank, first, third]);
    assert.equal(
      text,
      [
        '[pinch · 2 images · 3 notes]',
        '02 · Pricing page.png',
        '- 02.1 dot at x 30%, y 33% · works: "Clear."',
        '03 · Settings.png',
        '- 03.1 dot at x 30%, y 33% · doesn\'t: "Dense."',
        '- 03.2 dot at x 30%, y 33% · works: "Aligned."',
        'Positions are percentages of the image: x from the left edge, y from the top.',
        '',
      ].join('\n'),
    );
    assert.equal(batchSummary([blank]), '[pinch · 0 images · 0 notes]\n');
  });
});
