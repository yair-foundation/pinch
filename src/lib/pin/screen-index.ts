import type { Collection, ExportedNote, ExportedRule } from './learnings';
import { cleanScreenTag, SOURCES, type SourceKind, sourceLabel } from './model';
import type { ReviewList } from './review-sheets';

/**
 * The index of a rules package (D105): the screenshots' notes sorted by source and screen tag,
 * with counts, so an agent can tell which sets of notes match its task before it opens any.
 * Pure, like the rest of the package.
 */

/**
 * A screen tag compared across spellings: case, spacing, punctuation and a plural "s" don't
 * count, so "Marketing Assets - Unified Inbox", "marketing asset – unified inbox" and
 * "Price Optimiser" / "PriceOptimiser" are each one set. A tag with nothing to compare (no
 * letters or digits) is compared as typed.
 */
export function screenGroup(tag: string): string {
  const words = tag
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) =>
      /^[a-z]{4,}$/.test(w) && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w,
    );
  return words.join('') || tag.trim().toLowerCase();
}

export type ScreenNames = {
  /** The name a set goes by: the spelling the author used most, the first met on a tie. */
  name: (tag: string) => string;
  /** The other spellings of the same set, most used first. */
  others: (tag: string) => string[];
};

/** How the collection's screen tags are named, each set under one spelling. */
export function screenNames(c: Collection): ScreenNames {
  const spellings = new Map<string, Map<string, number>>();
  for (const b of c.batches)
    for (const n of b.notes) {
      const tag = cleanScreenTag(n.screenTag);
      if (!tag) continue;
      const key = screenGroup(tag);
      const seen = spellings.get(key) ?? new Map<string, number>();
      seen.set(tag, (seen.get(tag) ?? 0) + 1);
      spellings.set(key, seen);
    }
  const ranked = (tag: string) =>
    [...(spellings.get(screenGroup(tag))?.entries() ?? [])]
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  return {
    name: (tag) => ranked(tag)[0] ?? cleanScreenTag(tag),
    others: (tag) => ranked(tag).slice(1),
  };
}

/** Where a rule was seen: the notes' sources, each with the screen tags on its screenshots. */
export type SeenOn = { source: SourceKind | null; tags: string[] };

/** The sources and screen tags a rule's notes come from, sources in the usual order. */
export function seenOn(notes: ExportedNote[], names: ScreenNames): SeenOn[] {
  const by = new Map<SourceKind | null, string[]>();
  for (const { note } of notes) {
    const tags = by.get(note.source) ?? [];
    const tag = cleanScreenTag(note.screenTag);
    if (tag && !tags.includes(names.name(tag))) tags.push(names.name(tag));
    by.set(note.source, tags);
  }
  const order = [...SOURCES.map((s) => s.kind), null];
  return order.filter((k) => by.has(k)).map((source) => ({ source, tags: by.get(source) ?? [] }));
}

/** A rule's "seen on" in one line: "Ours (Co-pilot, Inbox); Other product". */
export const seenOnLine = (seen: SeenOn[]) =>
  seen
    .map((s) => {
      const who = s.source ? sourceLabel(s.source) : 'Source not set';
      return s.tags.length ? `${who} (${s.tags.join(', ')})` : who;
    })
    .join('; ');

type Cell = {
  name: string;
  images: Set<string>;
  notes: number;
  works: number;
  doesNot: number;
  rules: number;
};

const NO_TAG = '(no tag)';
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `index.md`: the reading order, then every source with its sets of screenshots, by screen tag.
 * Counts are of the notes in every batch, whether or not a rule draws on them, and of the
 * rules that draw on each set.
 */
export function screenIndex(
  c: Collection,
  rules: ExportedRule[],
  stamp: string,
  reviews: ReviewList = [],
): string {
  const names = screenNames(c);
  const sources = new Map<SourceKind | null, Map<string, Cell>>();
  const cellOf = (source: SourceKind | null, tag: string | undefined) => {
    const sets = sources.get(source) ?? new Map<string, Cell>();
    sources.set(source, sets);
    const clean = cleanScreenTag(tag);
    const key = clean ? screenGroup(clean) : '';
    const have = sets.get(key) ?? {
      name: clean ? names.name(clean) : NO_TAG,
      images: new Set<string>(),
      notes: 0,
      works: 0,
      doesNot: 0,
      rules: 0,
    };
    sets.set(key, have);
    return have;
  };
  let notes = 0;
  const images = new Set<string>();
  for (const b of c.batches)
    for (const n of b.notes) {
      const have = cellOf(n.source, n.screenTag);
      // By the number in its ref ("02" of "02.3"): two screenshots can share a file name.
      const image = `${b.id}/${n.ref.split('.')[0]}`;
      have.images.add(image);
      images.add(image);
      have.notes++;
      notes++;
      if (n.works.trim()) have.works++;
      if (n.doesNotWork.trim()) have.doesNot++;
    }
  for (const r of rules) {
    const drawn = new Set<Cell>();
    for (const { note } of r.notes) drawn.add(cellOf(note.source, note.screenTag));
    for (const have of drawn) have.rules++;
  }

  const lines = [
    `# Index: ${c.name.replace(/\s+/g, ' ').trim()}`,
    '',
    `Exported from Pinch on ${stamp.slice(0, 10)}: ${plural(images.size, 'image')} with notes, ${plural(notes, 'note')}, ${plural(rules.length, 'rule')}. This page sorts the notes into sets by who made the design (Source) and what it shows (the screen tag, as the author typed it), so you can find the sets that match your task.`,
    '',
    '## Reading order',
    '',
    '1. Read `design-rules.md`. The rules are the author’s taste, and each one names the notes it comes from.',
    '2. Find the sets below that match your task: its product or feature in the tag, and the kind of design in the Source. Several tags often apply, such as the product itself, the kind of feature, and a general pool of the author’s own work.',
    '3. Read each matching set’s notes in `batches/`, the larger sets first.',
    reviews.length
      ? '4. Before you apply a rule, open the close-up behind it. A rule is one line; the close-up shows what the author saw. To look at many at once, open a batch’s review sheets (listed at the end): its close-ups with their notes beside them, nine to a sheet.'
      : '4. Before you apply a rule, open the close-up behind it. A rule is one line; the close-up shows what the author saw.',
    '5. The author’s target style is the sum of everything their notes say works, in every set and whatever its source. A note on what doesn’t work says what is wrong in its screenshot, and a few say it as what the author would prefer instead (“I prefer a white border”): look at the close-up, avoid what the screenshot does there and follow what the words ask for. Works and Doesn’t count the notes of each kind for each set. A design from someone else’s product (Competitor, Other product, Concept) gives a principle, never a copy.',
    '',
    'A tag is one set whatever its case, spacing, punctuation or plural, so “Marketing Asset - Inbox” and “Marketing Assets - inbox” are counted together under the spelling used most. A tag that is a longer form of another (“Marketing Assets” and “Marketing Assets - Inbox”) is a set of its own.',
  ];
  const order = [...SOURCES.map((s) => s.kind), null];
  for (const source of order) {
    const sets = sources.get(source);
    if (!sets) continue;
    const all = [...sets.values()];
    const total = all.reduce((n, s) => n + s.notes, 0);
    const imgs = new Set(all.flatMap((s) => [...s.images])).size;
    lines.push(
      '',
      `## ${source ? sourceLabel(source) : 'Source not set'}`,
      '',
      `${plural(imgs, 'image')}, ${plural(total, 'note')}.`,
      '',
      '| Screen tag | Images | Notes | Works | Doesn’t | Rules | Also typed as |',
      '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    );
    const rows = [...sets.entries()].sort(
      ([ka, a], [kb, b]) =>
        (ka === '' ? 1 : 0) - (kb === '' ? 1 : 0) || a.name.localeCompare(b.name),
    );
    for (const [key, s] of rows)
      lines.push(
        `| ${cell(s.name)} | ${s.images.size} | ${s.notes} | ${s.works} | ${s.doesNot} | ${s.rules} | ${key ? cell(names.others(s.name).join(', ')) : ''} |`,
      );
  }
  if (reviews.length) {
    lines.push(
      '',
      '## Review sheets',
      '',
      'Each batch’s close-ups with their notes, nine to a sheet, in note order. A cell shows the close-up, its note number, whose design it is and its screen tag, what works and what doesn’t, and the rules that draw on it (“No rule yet” if none). Long notes are cut; `notes.json` in the batch has them whole.',
    );
    for (const r of reviews) {
      lines.push('', `**${r.folder.replace(/^batches\//, '').replace(/\/$/, '')}**`, '');
      for (const s of r.sheets) lines.push(`- \`${r.folder}${s.file}\`: notes ${s.notes}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
