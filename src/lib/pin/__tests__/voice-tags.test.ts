import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseVoiceTags, type TimedWord, type VoiceOp } from '../voice-tags';

/** Words as speech-to-text gives them, 300ms apart; "…" stands for a long pause. */
function say(text: string): TimedWord[] {
  const words: TimedWord[] = [];
  let t = 0;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token === '…') {
      t += 1500;
      continue;
    }
    words.push({ text: token, start: t, end: t + 250 });
    t += 300;
  }
  return words;
}

/** The commands read from a text, without their times. */
const ops = (text: string, known: string[] = []) =>
  parseVoiceTags(say(text), known).ops.map(({ start: _s, end: _e, ...op }) => op);
/** The words left for the notes. */
const rest = (text: string) =>
  parseVoiceTags(say(text))
    .rest.map((w) => w.text)
    .join(' ');

describe('voice tags: the screen', () => {
  it('reads a tag, capitalised, from the rest of its clause', () => {
    assert.deepEqual(ops('Tag this as checkout.'), [{ kind: 'tag', tag: 'Checkout' }]);
    assert.deepEqual(ops('The product is multi-calendar'), [
      { kind: 'tag', tag: 'Multi-Calendar' },
    ]);
    assert.deepEqual(ops('Okay, call this Agent Hub please.'), [{ kind: 'tag', tag: 'Agent Hub' }]);
  });
  it('takes the spelling the tag already has', () => {
    assert.deepEqual(ops('tag this as price optimizer', ['Price Optimizer', 'Price Optimizer']), [
      { kind: 'tag', tag: 'Price Optimizer' },
    ]);
  });
  it('reads a tag and a source said together', () => {
    assert.deepEqual(ops('Tag this as Linear, a competitor.'), [
      { kind: 'tag', tag: 'Linear' },
      { kind: 'source', source: 'competitor' },
    ]);
  });
  it('reads each source in its common wordings', () => {
    const cases: [string, VoiceOp['kind'], string][] = [
      ['This is ours.', 'source', 'ours'],
      ["It's our own product.", 'source', 'ours'],
      ['A competitor.', 'source', 'competitor'],
      ['This is another product.', 'source', 'other'],
      ["That's a mockup.", 'source', 'concept'],
      ['Source is concept.', 'source', 'concept'],
    ];
    for (const [text, kind, source] of cases) assert.deepEqual(ops(text), [{ kind, source }], text);
  });
  it('takes a source back', () => {
    assert.deepEqual(ops("It's not a competitor."), [{ kind: 'unsource', source: 'competitor' }]);
    assert.deepEqual(ops('No source.'), [{ kind: 'unsource' }]);
    assert.deepEqual(ops('Untag this.'), [{ kind: 'untag' }]);
  });
  it('reads the role of the set', () => {
    assert.deepEqual(ops('The role is target.'), [{ kind: 'role', role: 'target' }]);
    assert.deepEqual(ops('Aim for this look.'), [{ kind: 'role', role: 'target' }]);
    assert.deepEqual(ops('This is how it looks today.'), [{ kind: 'role', role: 'today' }]);
    assert.deepEqual(ops('Just the idea.'), [{ kind: 'role', role: 'principle' }]);
  });
  it('needs a lead before a one-word role that is a common word', () => {
    assert.deepEqual(ops('Today.'), []);
    assert.deepEqual(ops('Target.'), []);
    assert.deepEqual(ops('Role target.'), [{ kind: 'role', role: 'target' }]);
  });
});

describe('voice tags: a note', () => {
  it('stars the note in reach, or the one named', () => {
    assert.deepEqual(ops('Star this.'), [{ kind: 'star' }]);
    assert.deepEqual(ops('This is a best example.'), [{ kind: 'star' }]);
    assert.deepEqual(ops('Star the second one.'), [{ kind: 'star', note: 2 }]);
    assert.deepEqual(ops('Unstar that.'), [{ kind: 'unstar' }]);
  });
  it('reads topics only when every word after "about" is one', () => {
    assert.deepEqual(ops("That's about copy."), [{ kind: 'topics', topics: ['copy'] }]);
    assert.deepEqual(ops('This is about spacing and contrast.'), [
      { kind: 'topics', topics: ['layout', 'accessibility'] },
    ]);
    assert.deepEqual(ops('This is about getting people to pay.'), []);
  });
});

describe('voice tags: edits and moving', () => {
  it('drops the last note or the one named', () => {
    assert.deepEqual(ops('Drop that.'), [{ kind: 'drop', note: 'last' }]);
    assert.deepEqual(ops('Scratch that.'), [{ kind: 'drop', note: 'last' }]);
    assert.deepEqual(ops('Drop the second one.'), [{ kind: 'drop', note: 2 }]);
    assert.deepEqual(ops('Delete number three.'), [{ kind: 'drop', note: 3 }]);
  });
  it('redoes the screen, points again, and moves', () => {
    assert.deepEqual(ops('Redo this screen.'), [{ kind: 'redo' }]);
    assert.deepEqual(ops('No, not that, this.'), [{ kind: 'repoint' }]);
    assert.deepEqual(ops('Next.'), [{ kind: 'next' }]);
    assert.deepEqual(ops('Go back.'), [{ kind: 'back' }]);
  });
});

describe('voice tags: critique stays a note', () => {
  it('leaves ordinary sentences alone', () => {
    for (const text of [
      'This is our old checkout and the spacing is off.',
      'The competitor does this better than ours.',
      'I would drop that border, it is too heavy.',
      'Next to the button the label is too faint.',
      'The target here is too small to tap.',
    ])
      assert.deepEqual(ops(text), [], text);
  });
  it('takes the command out and keeps the rest for the notes', () => {
    assert.equal(
      rest('Star this, the hierarchy is great. Tag this as Linear. The legend is too faint.'),
      'the hierarchy is great. The legend is too faint.',
    );
  });
  it('ends a sentence at a long pause as at a full stop', () => {
    assert.deepEqual(ops('star this … the hierarchy is great'), [{ kind: 'star' }]);
    assert.equal(rest('star this … the hierarchy is great'), 'the hierarchy is great');
  });
});

describe('voice tags: times', () => {
  it('gives each command when it was said', () => {
    const { ops: read } = parseVoiceTags(say('The legend is faint. … Star this.'));
    assert.deepEqual(read, [{ kind: 'star', start: 2700, end: 3250 }]);
  });
});
