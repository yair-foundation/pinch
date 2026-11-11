import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Take } from '../narration';
import { remarksOf, transcriptText, unsureLines } from '../take-transcript';
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
        ...say('Remove this.', 11_000),
        ...say('Oh, wait.', 21_000),
        ...say('Delete this slide.', 24_000),
      ]),
    );
    assert.deepEqual(
      remarks.map((r) => [r.screen, r.kind, r.text]),
      [
        [0, 'note', 'The header is loud.'],
        [1, 'tag', 'Remove this. (Removed)'],
        [2, 'left', 'Oh, wait.'],
        [2, 'note', 'Delete this slide.'],
      ],
    );
  });

  it('is unsure of a tag that took something away, and of words left out', () => {
    const remarks = remarksOf(
      take([...say('Remove this.', 11_000), ...say('Oh, wait.', 21_000), ...say('Okay.', 25_000)]),
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
        ...say('Remove this.', 11_000),
        ...say('Okay.', 21_000),
      ]),
    ]);
    assert.match(text, /^# Everything I said, in order\n/);
    assert.match(text, /\n3 screens shown, 3 with something said\.\n/);
    assert.match(text, /\n## one\.png\n\n- 0:01 The header is loud\.\n/);
    assert.match(
      text,
      /\n## two\.png\n\n- 0:11 Remove this\. \(Removed\) \[Taken as a command: this screenshot left the batch, so it has no notes\.\]\n/,
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
      take([...say('The header is loud.', 1000), ...say('Remove this.', 11_000)]),
    ]);
    assert.deepEqual(lines, [
      '- `two.png` at 0:11: "Remove this." Taken as a command: this screenshot left the batch, so it has no notes.',
    ]);
  });

  it('leaves out words timed after the recording ended', () => {
    assert.deepEqual(remarksOf(take(say('Thank you.', 45_000))), []);
  });
});
