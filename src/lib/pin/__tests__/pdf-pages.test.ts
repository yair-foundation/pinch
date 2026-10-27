import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isPdf, pageName, pageScale } from '../pdf-pages';

describe('pdf pages', () => {
  it('knows a PDF by its type or, when the type is blank, its name', () => {
    assert.ok(isPdf({ type: 'application/pdf', name: 'deck' }));
    assert.ok(isPdf({ type: '', name: 'Deck.PDF' }));
    assert.ok(!isPdf({ type: 'image/png', name: 'shot.png' }));
  });
  it('names each page after the file, with its number', () => {
    assert.equal(pageName('Onboarding flow.pdf', 3), 'Onboarding flow p3.png');
    assert.equal(pageName('.pdf', 1), 'PDF p1.png');
  });
  it('draws a page at twice its size, less when that would go over the budget', () => {
    assert.equal(pageScale(595, 842, 16_000_000), 2);
    const big = pageScale(5000, 5000, 16_000_000);
    assert.ok(big < 1 && Math.abs(big * 5000 * big * 5000 - 16_000_000) < 1);
  });
});
