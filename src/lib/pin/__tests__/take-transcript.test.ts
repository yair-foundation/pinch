import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Take } from '../narration';
import {
  dwellOf,
  quietLine,
  quietOf,
  remarksOf,
  transcriptText,
  unsureLines,
} from '../take-transcript';
import type { TimedWord } from '../voice-tags';

/** Words 300ms apart from `t`. */
function say(text: string, t: number): TimedWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token, i) => ({ text: token, start: t + i * 300, end: t + i * 300 + 250 }));
}

const take = (words: TimedWord[], more: Partial<Take> = {}): Take => ({
  id: 'aaaa-bbbb',
  version: 1,
  recordedAt: '2026-11-11T07:35:48.000Z',
  durationMs: 40_000,
  mimeType: 'audio/webm',
  screens: ['one', 'two', 'three'].map((id) => ({
    id,
    name: `${id}.png`,
    width: 1000,
    height: 1000,
  })),
  shown: [
    { t: 0, screen: 0 },
    { t: 10_000, screen: 1 },
    { t: 20_000, screen: 2 },
    { t: 30_000, screen: null },
  ],
  pointer: [],
  words,
  ...more,
});

describe('the transcript of a take (D188)', () => {
  it('lists what was said in order, with what became of each remark', () => {
    const remarks = remarksOf(
      take([
        ...say('The header is loud.', 1000),
        ...say('Remove this screenshot.', 11_000),
        ...say('Oh, wait.', 21_000),
        ...say('Delete this slide.', 24_000),
      ]),
    );
    assert.deepEqual(
      remarks.map((r) => [r.screen, r.kind, r.text]),
      [
        [0, 'note', 'The header is loud.'],
        [1, 'tag', 'Remove this screenshot. (Removed)'],
        [2, 'left', 'Oh, wait.'],
        [2, 'note', 'Delete this slide.'],
      ],
    );
  });

  it('is unsure of a tag that took something away, and of words left out', () => {
    const remarks = remarksOf(
      take([...say('Remove this screenshot.', 11_000), ...say('Oh, wait.', 21_000), ...say('Okay.', 25_000)]),
    );
    assert.match(remarks[0].unsure ?? '', /^Taken as a command: this screenshot left the batch/);
    assert.equal(remarks[1].unsure, 'Too short to be a note.');
    // A filler alone is left out, and nothing to ask about.
    assert.deepEqual([remarks[2].kind, remarks[2].unsure], ['left', undefined]);
  });

  it('is not unsure of a tag that sets something', () => {
    const [tag] = remarksOf(take(say('Tag this as Checkout.', 1000)));
    assert.deepEqual([tag.kind, tag.unsure], ['tag', undefined]);
  });

  it('is unsure of a note that names only the screen: its start may be missing', () => {
    const [a, b] = remarksOf(take([...say('This slide.', 1000), ...say('Slide.', 11_000)]));
    assert.match(a.unsure ?? '', /its start may be missing/);
    assert.match(b.unsure ?? '', /its start may be missing/);
    assert.equal(remarksOf(take(say('Delete this slide.', 1000)))[0].unsure, undefined);
  });

  it('is unsure of a note said as the reel turned, and names the next screen', () => {
    // "Delete this" over the first screen, "slide." just after the turn: it stays on the first.
    const [note] = remarksOf(take(say('Delete this slide.', 9500)));
    assert.equal(note.screen, 0);
    assert.equal(note.unsure, 'Said as the reel turned to two.png.');
  });

  it('writes the file an agent reads, by screen, with the time of each remark', () => {
    const text = transcriptText([
      take([
        ...say('The header is loud.', 1000),
        ...say('Remove this screenshot.', 11_000),
        ...say('Okay.', 21_000),
      ]),
    ]);
    assert.match(text, /^# Everything I said, in order\n/);
    assert.match(text, /\n3 screens shown, 3 with something said\.\n/);
    assert.match(text, /\n## one\.png\n\n- 0:01 The header is loud\.\n/);
    assert.match(
      text,
      /\n## two\.png\n\n- 0:11 Remove this screenshot\. \(Removed\) \[Taken as a command: this screenshot left the batch, so it has no notes\.\]\n/,
    );
    assert.match(text, /\n## three\.png\n\n- 0:21 Okay\. \[Not a note\.\]\n/);
  });

  it('writes nothing for a take with nothing said, and heads each of several takes', () => {
    assert.equal(transcriptText([take([])]), '');
    assert.equal(transcriptText([]), '');
    const text = transcriptText([
      take(say('The header is loud.', 1000)),
      take(say('The footer is fine.', 1000), { recordedAt: '2026-11-11T08:00:00.000Z' }),
    ]);
    assert.match(text, /\n## Take recorded 2026-11-11 07:35\n/);
    assert.match(text, /\n## Take recorded 2026-11-11 08:00\n/);
    assert.match(text, /\n### one\.png\n/);
  });

  it('lists the remarks to ask about, with the screen, the time and the words', () => {
    const lines = unsureLines([
      take([...say('The header is loud.', 1000), ...say('Remove this screenshot.', 11_000)]),
    ]);
    assert.deepEqual(lines, [
      '- `two.png` at 0:11: "Remove this screenshot." Taken as a command: this screenshot left the batch, so it has no notes.',
    ]);
  });

  it('leaves out words timed after the recording ended', () => {
    assert.deepEqual(remarksOf(take(say('Thank you.', 45_000))), []);
  });
});

describe('the screens nothing was said over (D189)', () => {
  // Four screens: the first spoken over, the second passed in a flash, the third looked at in
  // silence, the fourth never reached.
  const four = (words: TimedWord[], more: Partial<Take> = {}) =>
    take(words, {
      screens: ['one', 'two', 'three', 'four'].map((id) => ({
        id,
        name: `${id}.png`,
        width: 1000,
        height: 1000,
      })),
      shown: [
        { t: 0, screen: 0 },
        { t: 10_000, screen: 1 },
        { t: 10_300, screen: 2 },
        { t: 30_000, screen: null },
      ],
      ...more,
    });
  const said = say('The header is loud.', 1000);

  it('knows how long each screen was on show, over every visit', () => {
    assert.deepEqual(dwellOf(four(said)), [10_000, 300, 19_700, 0]);
    const back = four(said, {
      shown: [
        { t: 0, screen: 0 },
        { t: 5000, screen: 1 },
        { t: 6000, screen: 0 },
        { t: 9000, screen: 1 },
      ],
    });
    assert.deepEqual(dwellOf(back), [8000, 32_000, 0, 0]);
  });

  it('tells a screen passed in silence from one only glanced at, and from one never shown', () => {
    assert.deepEqual(quietOf(four(said)), {
      quiet: [
        { screen: 1, glanced: true },
        { screen: 2, glanced: false },
      ],
      unseen: [3],
    });
  });

  it('counts a screen as spoken over whatever became of the words', () => {
    const { quiet } = quietOf(four([...said, ...say('Remove this screenshot.', 12_000)]));
    assert.deepEqual(quiet, [{ screen: 1, glanced: true }]);
  });

  it('lists them at the end of the transcript, the glanced ones marked', () => {
    const text = transcriptText([four(said)]);
    assert.match(
      text,
      /\n## Nothing said\n\nI said nothing over these 2 screens\. The 1 marked \* was on show for under half a second\.\n\n- two\.png \*\n- three\.png\n/,
    );
    assert.match(
      text,
      /\n## Never shown\n\nThe take ended before this screen came up\.\n\n- four\.png\n$/,
    );
    assert.ok(text.indexOf('## one.png') < text.indexOf('## Nothing said'));
  });

  it('marks none where every one was glanced at, or none was', () => {
    const flashed = four(said, {
      shown: [
        { t: 0, screen: 0 },
        { t: 39_800, screen: 1 },
      ],
    });
    assert.match(
      transcriptText([flashed]),
      /I said nothing over this screen\. It was on show for under half a second\.\n\n- two\.png\n/,
    );
    const looked = four(said, {
      shown: [
        { t: 0, screen: 0 },
        { t: 10_000, screen: 1 },
        { t: 20_000, screen: 2 },
        { t: 30_000, screen: 3 },
      ],
    });
    assert.match(transcriptText([looked]), /I said nothing over these 3 screens\.\n\n- two\.png\n/);
    assert.doesNotMatch(transcriptText([looked]), /Never shown|\*/);
  });

  it('has no list when every screen was spoken over', () => {
    const all = take([
      ...say('The header is loud.', 1000),
      ...say('The list reads well.', 11_000),
      ...say('The footer is fine.', 21_000),
    ]);
    assert.doesNotMatch(transcriptText([all]), /Nothing said|Never shown/);
    assert.equal(quietLine([all]), '');
  });

  it('says in a line for the notes how many, and where they are listed', () => {
    assert.equal(
      quietLine([four(said)]),
      'I said nothing over 2 of the 3 screens I was shown. One screen was never shown. They are listed at the end of `transcript.md`.',
    );
    assert.equal(
      quietLine([four(said), four(said)]),
      'The screens I said nothing over in each take are listed in `transcript.md`.',
    );
    assert.equal(quietLine([four([])]), '');
    assert.equal(quietLine([]), '');
  });
});
