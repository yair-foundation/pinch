import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emptyLogDay, type LogDay, type LogEntry, logEntrySchema } from '../notes-log';
import {
  AREAS,
  areaQuestions,
  carriedTags,
  grantCalls,
  MIN_TAG_CHARS,
  needsTagging,
  summarizeTags,
  TAG_THRESHOLD,
  type Tags,
  tagText,
  textKey,
  toTags,
} from '../notes-tags';

const note = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'n1abcd',
  image: 'img1abcd',
  kind: 'note',
  label: 'Header',
  works: 'The title stands out',
  doesNotWork: 'The grey label text is too small to read',
  ...over,
});

const taggedFor = (text: string, areas: string[] = ['type']): Tags => ({
  areas,
  scores: Object.fromEntries(areas.map((a) => [a, 0.9])),
  model: 'jev-test',
  for: textKey(text),
});

describe('tagText', () => {
  it('joins the label and both verdicts of a note', () => {
    assert.equal(
      tagText(note()),
      'Header\nThe title stands out\nThe grey label text is too small to read',
    );
  });

  it('takes an overall note from its text and skips blanks', () => {
    assert.equal(tagText({ text: '  Too crowded overall  ', label: '  ' }), 'Too crowded overall');
  });
});

describe('areaQuestions', () => {
  it('asks one yes/no question per area, each a noul with both criteria', () => {
    const questions = areaQuestions() as Record<
      string,
      { type: string; instructions: string; criteria: object }
    >;
    assert.deepEqual(Object.keys(questions), Object.keys(AREAS));
    for (const q of Object.values(questions)) {
      assert.equal(q.type, 'noul');
      assert.match(q.instructions, /design note/);
      assert.deepEqual(Object.keys(q.criteria), ['true', 'false']);
    }
  });

  it("keeps the six original area names", () => {
    for (const a of ['type', 'colour', 'layout', 'density', 'motion', 'copy'])
      assert.ok(a in AREAS, a);
  });
});

describe('toTags', () => {
  it('keeps areas at or above the threshold, highest first, and every score', () => {
    const tags = toTags(
      {
        type: { noul: 0.7 },
        colour: { noul: 0.95 },
        layout: { noul: TAG_THRESHOLD - 0.01 },
        density: { noul: TAG_THRESHOLD },
        bogus: { noul: 1 },
      },
      'jev-1.13.0',
      'k',
    );
    assert.deepEqual(tags.areas, ['colour', 'type', 'density']);
    assert.deepEqual(tags.scores, { type: 0.7, colour: 0.95, layout: 0.59, density: 0.6 });
    assert.equal(tags.model, 'jev-1.13.0');
    assert.equal(tags.for, 'k');
  });

  it('has no areas when nothing clears the threshold, but is still a tagging', () => {
    const tags = toTags({ type: { noul: 0.2 }, copy: { noul: 0.1 } }, 'm', 'k');
    assert.deepEqual(tags.areas, []);
    assert.deepEqual(Object.keys(tags.scores), ['type', 'copy']);
  });

  it('ignores answers without a number', () => {
    const tags = toTags({ type: {}, colour: { noul: 0.8 } }, 'm', 'k');
    assert.deepEqual(tags.scores, { colour: 0.8 });
  });
});

describe('needsTagging and carriedTags', () => {
  it('tags a new note that says enough', () => {
    assert.equal(needsTagging(note()), true);
  });

  it('skips a note under the minimum length', () => {
    const short = note({ label: 'Nav', works: 'ok', doesNotWork: undefined });
    assert.ok(tagText(short).length < MIN_TAG_CHARS);
    assert.equal(needsTagging(short), false);
    assert.equal(
      needsTagging(note({ label: undefined, works: undefined, doesNotWork: undefined })),
      false,
    );
  });

  it('does not tag again while the stored tags are for the same text', () => {
    const e = note();
    const previous = { tags: taggedFor(tagText(e)) };
    assert.equal(needsTagging(e, previous), false);
    assert.deepEqual(carriedTags(e, previous), previous.tags);
  });

  it('tags again, and drops the old tags, once the text changed', () => {
    const e = note();
    const previous = { tags: taggedFor(tagText(note({ works: 'The old title stood out' }))) };
    assert.equal(needsTagging(e, previous), true);
    assert.equal(carriedTags(e, previous), undefined);
  });

  it('keeps the tags when only the shape or position changed', () => {
    const e = note({ shape: 'area' });
    const previous = { tags: taggedFor(tagText(note({ shape: 'dot' }))) };
    assert.deepEqual(carriedTags(e, previous), previous.tags);
    assert.equal(needsTagging(e, previous), false);
  });
});

describe('textKey', () => {
  it('is short, stable and differs for different text', () => {
    assert.equal(textKey('a note'), textKey('a note'));
    assert.notEqual(textKey('a note'), textKey('a note.'));
    assert.match(textKey('a note'), /^[A-Za-z0-9_-]{12}$/);
  });
});

describe('grantCalls', () => {
  it('grants what the cap still allows and nothing past it', () => {
    assert.equal(grantCalls(0, 10, 2000), 10);
    assert.equal(grantCalls(1995, 10, 2000), 5);
    assert.equal(grantCalls(2000, 10, 2000), 0);
    assert.equal(grantCalls(2500, 10, 2000), 0);
    assert.equal(grantCalls(5, 0, 2000), 0);
  });
});

describe('logEntrySchema', () => {
  it('never takes tags from the browser', () => {
    const parsed = logEntrySchema.safeParse({ ...note(), tags: taggedFor('x', ['colour']) });
    assert.ok(parsed.success);
    assert.equal('tags' in parsed.data, false);
  });
});

describe('summarizeTags', () => {
  const day = (entries: (LogEntry & { tags?: Tags })[]): LogDay => {
    const doc = emptyLogDay();
    for (const e of entries) doc.entries[e.id] = { ...e, at: '2026-10-19T10:00Z' };
    return doc;
  };

  it('counts tagged notes per area over the month, with the untagged and the short', () => {
    const a = note({ id: 'a' });
    const b = note({ id: 'b', works: 'Great contrast on the blue' });
    const c = note({ id: 'c', works: 'Spacing is uneven' });
    const stale = note({ id: 'd' });
    const short = note({ id: 'e', label: 'Nav', works: 'ok', doesNotWork: undefined });
    const none = note({ id: 'f', works: 'Hmm, not sure about this one' });
    const summary = summarizeTags('2026-10', {
      '2026-10-19': day([
        { ...a, tags: taggedFor(tagText(a), ['type']) },
        { ...b, tags: taggedFor(tagText(b), ['colour', 'type']) },
        stale,
        short,
      ]),
      '2026-10-20': day([
        { ...c, tags: taggedFor(tagText(c), ['layout']) },
        { ...stale, tags: taggedFor('words that are gone', ['copy']) },
        { ...none, tags: taggedFor(tagText(none), []) },
      ]),
    });
    assert.equal(summary.month, '2026-10');
    assert.equal(summary.days, 2);
    assert.equal(summary.notes, 7);
    assert.equal(summary.tagged, 4);
    assert.equal(summary.noArea, 1);
    assert.equal(summary.untagged, 2);
    assert.equal(summary.tooShort, 1);
    assert.equal(summary.areas.type, 2);
    assert.equal(summary.areas.colour, 1);
    assert.equal(summary.areas.layout, 1);
    assert.equal(summary.areas.copy, 0);
    assert.deepEqual(summary.top, ['type', 'colour', 'layout']);
    assert.deepEqual(summary.byDay, {
      '2026-10-19': { notes: 4, tagged: 2 },
      '2026-10-20': { notes: 3, tagged: 2 },
    });
  });

  it('is empty for a month with no days', () => {
    const summary = summarizeTags('2026-09', {});
    assert.equal(summary.days, 0);
    assert.equal(summary.notes, 0);
    assert.deepEqual(summary.top, []);
    assert.deepEqual(Object.keys(summary.areas), Object.keys(AREAS));
  });
});
