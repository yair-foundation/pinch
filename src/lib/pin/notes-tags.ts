import { createHash } from 'node:crypto';
import { THRESHOLD } from '@/lib/jev';
import type { LogDay, LogEntry } from './notes-log';

/*
 * Tagging saved notes by area with Jev (TypeSafe's decision model), so the
 * owner can count what designers talk about: type, colour, layout and so on.
 * Jev answers yes/no questions about text, so each area is its own question
 * and a note can be about several. This file is the pure part: the areas,
 * the questions, how answers become tags, which notes need (re)tagging, and
 * the month summary. The calls themselves are in `notes-tagger.ts`.
 *
 * Only the note's own words go to Jev: its label, what works, what doesn't
 * and an overall note's text. Never ids, the day, the shape or the source.
 */

/** What each area means, in the words Jev is asked. The first six were the first areas defined; the rest were added for Pinch. */
export const AREAS: Record<string, string> = {
  type: 'typography: fonts, text size, weight, line height, letter spacing, legibility of the text itself',
  colour: 'colour: palette, contrast, theme, light or dark mode, tints, how colours are used',
  layout: 'layout: spacing, alignment, grouping, grid, structure, where things sit on the screen',
  density:
    'density: clutter, crowding, too much or too little on screen, whitespace, room to breathe',
  motion: 'motion: animation, transitions, hover and press feedback, loading states, timing',
  copy: 'copy: wording, labels, tone of voice, microcopy, headings, error messages',
  hierarchy:
    'hierarchy: what stands out first, order of importance, focal point, emphasis, visual weight',
  components:
    'specific UI elements and how they behave: buttons, inputs, tables, charts, cards, navigation, menus, modals',
  imagery: 'imagery: icons, illustration, photos, logos, brand marks, graphics',
  accessibility:
    'accessibility: readability for everyone, size of tap or click targets, keyboard use, screen readers, colour blindness',
};

/** An area needs at least this probability; the bar Jev's yes/no answers are read at. */
export const TAG_THRESHOLD = THRESHOLD;
/** Notes shorter than this say too little to tag. */
export const MIN_TAG_CHARS = 12;

/**
 * What a stored note carries once tagged: `areas` at or above TAG_THRESHOLD,
 * highest first (empty when nothing cleared it), Jev's `scores` for every
 * area asked, the `model`, and `for`, the `textKey` of the words the tags
 * describe, so a changed note is tagged again.
 */
export type Tags = NonNullable<LogDay['entries'][string]['tags']>;

/** The words of a note that go to Jev: its label and verdicts, or an overall note's text. */
export function tagText(e: Pick<LogEntry, 'label' | 'works' | 'doesNotWork' | 'text'>): string {
  return [e.label, e.works, e.doesNotWork, e.text]
    .map((s) => s?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

/** A short key of a note's text, kept with its tags to tell when the text changed. */
export const textKey = (text: string) =>
  createHash('sha256').update(text).digest('base64url').slice(0, 12);

/** One yes/no question per area, over the note's text. */
export function areaQuestions(): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  for (const [id, meaning] of Object.entries(AREAS)) {
    questions[id] = {
      type: 'noul',
      instructions: `Is this design note about ${meaning}?`,
      criteria: {
        true: `The note comments on, praises or criticises ${meaning}`,
        false: 'The note is about something else, or says nothing about this',
      },
    };
  }
  return questions;
}

type Answers = Record<string, { noul?: number }>;

/** Turns Jev's answers into tags for the text with key `forKey`. */
export function toTags(answers: Answers, model: string, forKey: string): Tags {
  const scores: Record<string, number> = {};
  for (const id of Object.keys(AREAS)) {
    const p = answers[id]?.noul;
    if (typeof p === 'number') scores[id] = Math.round(p * 1000) / 1000;
  }
  const areas = Object.entries(scores)
    .filter(([, p]) => p >= TAG_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  return { areas, scores, model, for: forKey };
}

export type Taggable = { id: string; text: string };

/**
 * Whether a note saved now needs tagging: it says enough, and it has no tags
 * for its current text. `previous` is what the day held under the same id.
 */
export function needsTagging(entry: LogEntry, previous?: { tags?: Tags }): boolean {
  const text = tagText(entry);
  if (text.length < MIN_TAG_CHARS) return false;
  return previous?.tags?.for !== textKey(text);
}

/**
 * The tags to keep on a re-sent note: the earlier ones when they describe its
 * current text, none otherwise, so tags never describe words that are gone.
 */
export function carriedTags(entry: LogEntry, previous?: { tags?: Tags }): Tags | undefined {
  const tags = previous?.tags;
  return tags && tags.for === textKey(tagText(entry)) ? tags : undefined;
}

/** How many of `wanted` calls a day with `used` calls and a cap of `cap` can still make. */
export const grantCalls = (used: number, wanted: number, cap: number) =>
  Math.max(0, Math.min(wanted, cap - used));

export type TagSummary = {
  month: string;
  days: number;
  notes: number;
  /** Notes with tags for their current text. */
  tagged: number;
  /** Tagged notes where no area cleared the threshold. */
  noArea: number;
  /** Notes long enough to tag that have no tags (not tried yet, or Jev failed). */
  untagged: number;
  /** Notes too short to tag. */
  tooShort: number;
  /** Tagged notes per area, over the month. */
  areas: Record<string, number>;
  /** Areas by count, most common first. */
  top: string[];
  byDay: Record<string, { notes: number; tagged: number }>;
};

/** Counts over a month's day documents, for `GET /api/pin/notes?summary=YYYY-MM`. */
export function summarizeTags(month: string, days: Record<string, LogDay>): TagSummary {
  const areas: Record<string, number> = Object.fromEntries(Object.keys(AREAS).map((a) => [a, 0]));
  const out: TagSummary = {
    month,
    days: 0,
    notes: 0,
    tagged: 0,
    noArea: 0,
    untagged: 0,
    tooShort: 0,
    areas,
    top: [],
    byDay: {},
  };
  for (const day of Object.keys(days).sort()) {
    const entries = Object.values(days[day].entries);
    out.days += 1;
    const counts = { notes: entries.length, tagged: 0 };
    for (const e of entries) {
      out.notes += 1;
      const text = tagText(e);
      if (text.length < MIN_TAG_CHARS) {
        out.tooShort += 1;
        continue;
      }
      if (!e.tags || e.tags.for !== textKey(text)) {
        out.untagged += 1;
        continue;
      }
      out.tagged += 1;
      counts.tagged += 1;
      if (!e.tags.areas.length) out.noArea += 1;
      for (const a of e.tags.areas) areas[a] = (areas[a] ?? 0) + 1;
    }
    out.byDay[day] = counts;
  }
  out.top = Object.entries(areas)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([a]) => a);
  return out;
}
