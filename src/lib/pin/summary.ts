import { scaleOf, spacingText } from './measure';
import { rhythmText } from './rhythm';
import {
  type Asset,
  currentRhythm,
  currentSpacing,
  type Mark,
  type Shape,
  sortTopics,
  sourceLine,
  suggestionUse,
  topicLabel,
  verdictOf,
} from './model';

/*
 * The short text that goes on the clipboard with the marked image ("Copy for
 * agent"), after Scrawl's summary: a bracketed header, then one line per note
 * naming its number on the image, where it sits and what the author said.
 * The README in the zip export stays the long form; this is what fits in a
 * chat message next to a picture.
 */

const whole = (n: number) => String(Math.round(n * 100));
const percent = (n: number) => `${whole(n)}%`;
const range = (from: number, to: number) => `${whole(from)}–${whole(to)}%`;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const written = (a: Asset) => a.marks.filter((m) => verdictOf(m) !== 'empty');
const numberOf = (index: number, total: number) =>
  String(index + 1).padStart(total > 99 ? 3 : 2, '0');

/**
 * Where a note sits, in whole percentages: `dot at x 30%, y 33%`, `area x 31–68%, y 44–61%`
 * or `arrow from x 12%, y 40% to x 80%, y 41%` (tail to head).
 */
export function whereText(shape: Shape): string {
  if (shape.kind === 'dot') return `dot at x ${percent(shape.x)}, y ${percent(shape.y)}`;
  if (shape.kind === 'arrow')
    return `arrow from x ${percent(shape.x)}, y ${percent(shape.y)} to x ${percent(shape.x2)}, y ${percent(shape.y2)}`;
  return `area x ${range(shape.x, shape.x + shape.w)}, y ${range(shape.y, shape.y + shape.h)}`;
}

const aiTag = (m: Mark, field: 'good' | 'bad') => {
  const use = suggestionUse(m, field);
  return use === 'as-is' ? ' (AI suggestion)' : use === 'edited' ? ' (AI suggestion, edited)' : '';
};

/**
 * One note as a line:
 * `- 02.3 area x 31–68%, y 44–61% · headline · about: Copy, Layout · works: "…" · doesn't: "…"`,
 * then its measured spacing when it has some, read at `scale` (the image's, `scaleOf`).
 */
export function noteLine(
  m: Mark,
  number: string,
  scale: ReturnType<typeof scaleOf> = { scale: 1, guessed: true },
): string {
  const parts = [`${number} ${whereText(m.shape)}`];
  if (m.label.trim()) parts.push(oneLine(m.label));
  const topics = sortTopics(m.topics ?? []);
  if (topics.length) parts.push(`about: ${topics.map(topicLabel).join(', ')}`);
  if (m.good.trim()) parts.push(`works${aiTag(m, 'good')}: "${oneLine(m.good)}"`);
  if (m.bad.trim()) parts.push(`doesn't${aiTag(m, 'bad')}: "${oneLine(m.bad)}"`);
  const spacing = currentSpacing(m);
  if (spacing) parts.push(`spacing: ${spacingText(spacing, scale.scale, scale.guessed)}`);
  const rhythm = currentRhythm(m);
  if (rhythm) parts.push(`rhythm: ${rhythmText(rhythm, scale.scale, scale.guessed)}`);
  const line = `- ${parts.join(' · ')}`;
  return m.origin === 'ai' && !m.confirmed ? `${line} (AI, not checked)` : line;
}

/** The lines about one image: its source and overall note, then its notes, numbered `NN.j`. */
function imageLines(a: Asset, number: string): string[] {
  const lines: string[] = [];
  if (a.source) lines.push(sourceLine(a.source));
  if (a.note.trim()) lines.push(`Overall: "${oneLine(a.note)}"`);
  for (const [j, m] of written(a).entries())
    lines.push(noteLine(m, `${number}.${j + 1}`, scaleOf(a)));
  return lines;
}

const COORDINATES = 'Positions are percentages of the image: x from the left edge, y from the top.';

/**
 * The summary for one image, the one whose marked copy sits beside it on the
 * clipboard. `index` and `total` are its place in the batch, so the numbers
 * match the filmstrip and the markers drawn on the image.
 */
export function imageSummary(asset: Asset, index: number, total: number): string {
  const notes = written(asset);
  const lines = [
    `[pinch · ${oneLine(asset.name)} · ${count(notes.length, 'note')}]`,
    ...imageLines(asset, numberOf(index, total)),
  ];
  if (notes.length) lines.push(COORDINATES);
  return `${lines.join('\n')}\n`;
}
