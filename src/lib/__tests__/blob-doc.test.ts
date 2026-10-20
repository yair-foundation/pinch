import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strongEtag } from '../blob-doc';

test('a weak ETag from get is made strong for ifMatch', () => {
  assert.equal(strongEtag('W/"e604c82f"'), '"e604c82f"');
});

test('a strong ETag is left alone', () => {
  assert.equal(strongEtag('"e604c82f"'), '"e604c82f"');
  assert.equal(strongEtag('abc'), 'abc');
});
