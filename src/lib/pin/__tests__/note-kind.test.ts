import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { approves, asks, kindOf, takesBack } from '../note-kind';

describe('what a note said aloud is (D195)', () => {
  it('takes the plain ways of saying something is right, as the author said them', () => {
    for (const said of [
      'This slide is okay.',
      'This is okay.',
      'This is OK.',
      'Keep this slide.',
      'This background is actually cool with this pattern.',
      'Actually you can use this color.',
      'I like this.',
      "That's good.",
      'This works.',
      'Nice.',
    ])
      assert.ok(approves(said), said);
  });

  it('leaves a correction alone, whatever word of praise is in it', () => {
    for (const said of [
      'Off-brand.',
      'No margins.',
      'Not good.',
      'This is not good.',
      'We don’t color Text like this.',
      'Do not place assets like this in the middle.',
      'This is right aligned and should be centred.',
      'I like to see more margin here.',
      'You can remove this.',
      'This slide is not a disaster.',
      'Again, the color combination, is not very good.',
      'This is too good to be true.',
    ]) {
      assert.ok(!approves(said), said);
      assert.equal(kindOf(said), null, said);
    }
  });

  it('counts "Like this." only as a whole note: said on, it ends the sentence before', () => {
    assert.equal(kindOf('Like this.'), 'right');
    assert.equal(kindOf('Do not number. Like this.'), null);
    assert.equal(kindOf('Like this. And if it is not a logo, do not use the house icon.'), null);
  });

  it('says partly right where only some of a note approves', () => {
    assert.equal(kindOf('This is okay. This is OK.'), 'right');
    assert.equal(
      kindOf('This background is actually cool with this pattern. This is off-brand completely.'),
      'partly',
    );
    assert.equal(
      kindOf('Actually you can use this color. The title styling is off-brand.'),
      'partly',
    );
    assert.equal(kindOf(''), null);
  });

  it('takes as a question one put to the reader, and not every question mark', () => {
    assert.ok(asks('This is boring. Do you have an idea how to make it better, more appealing?'));
    assert.ok(asks('What do you think.'));
    for (const said of [
      'Oh boy, where do I start?',
      'What is this space? It looks random.',
      'You know what?',
      'Smaller in size and more spacing between the lines? Let’s try it.',
    ])
      assert.ok(!asks(said), said);
  });

  it('knows a note that begins by taking something back', () => {
    assert.ok(takesBack('Actually you can use this color.'));
    assert.ok(takesBack('Sorry, down left where the disclaimers are.'));
    assert.ok(takesBack('No wait, keep it.'));
    assert.ok(!takesBack('This is actually cool.'));
    assert.ok(!takesBack('Avoid this color.'));
  });
});
