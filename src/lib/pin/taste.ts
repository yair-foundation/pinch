import type { Collection, Rule } from './learnings';
import { sortTopics, type Topic } from './model';

/*
 * The taste check (D102): a dozen either-or questions on the choices designers split on, each
 * answer a rule in the author's own taste library, with no screenshot to mark. Generic design
 * guidance barely moved an agent toward a designer's taste in the rules benchmark, and the
 * tastes their notes left vague (a true black dark theme, a humanist headline face, a fade-up
 * as sections scroll in) were the ones agents missed; here the author picks them outright.
 * Each option is a look the page draws (`taste-check.tsx`), so the picks name it exactly.
 */

export type TasteOption = {
  id: string;
  /** The option's name on its preview: one to three words. */
  label: string;
  /** The rule it makes, one sentence for an agent. */
  rule: string;
  /** The rule's short name on its card (D95). */
  title: string;
};

export type TasteQuestion = {
  id: string;
  ask: string;
  topics: Topic[];
  options: TasteOption[];
};

export const TASTE: TasteQuestion[] = [
  {
    id: 'dark',
    ask: 'In dark mode, the background is…',
    topics: ['visual'],
    options: [
      {
        id: 'black',
        label: 'True black',
        rule: 'In dark mode, use a true black background with neutral grey borders and no colour cast.',
        title: 'True black dark mode',
      },
      {
        id: 'tinted',
        label: 'Tinted dark grey',
        rule: 'In dark mode, use a dark grey background with a slight tint, never pure black.',
        title: 'Tinted dark grey, not black',
      },
    ],
  },
  {
    id: 'accent',
    ask: 'Colour on the screen…',
    topics: ['visual'],
    options: [
      {
        id: 'one',
        label: 'One accent',
        rule: 'Use one accent colour on neutral surfaces, for actions and selection only.',
        title: 'One accent on neutrals',
      },
      {
        id: 'several',
        label: 'Several colours',
        rule: 'Use several bold colours to give sections and categories their own character.',
        title: 'Bold colours by section',
      },
    ],
  },
  {
    id: 'depth',
    ask: 'Surfaces are…',
    topics: ['visual'],
    options: [
      {
        id: 'flat',
        label: 'Flat',
        rule: 'Keep surfaces flat: no gradients or heavy drop shadows; set them apart with space or a light border.',
        title: 'Flat surfaces, no gloss',
      },
      {
        id: 'soft',
        label: 'Soft depth',
        rule: 'Give raised surfaces soft, layered shadows so it is clear what sits above what.',
        title: 'Soft shadows for depth',
      },
    ],
  },
  {
    id: 'corners',
    ask: 'Corners are…',
    topics: ['visual'],
    options: [
      {
        id: 'round',
        label: 'Rounded',
        rule: 'Round corners well, with pill-shaped buttons, for a friendly feel.',
        title: 'Rounded, friendly corners',
      },
      {
        id: 'square',
        label: 'Square',
        rule: 'Keep corners square or barely rounded.',
        title: 'Square corners',
      },
    ],
  },
  {
    id: 'headlines',
    ask: 'Headlines are set in…',
    topics: ['visual'],
    options: [
      {
        id: 'humanist',
        label: 'A humanist sans',
        rule: 'Set headlines in a humanist sans with warm, varied strokes, not a geometric or monospace face.',
        title: 'Humanist sans headlines',
      },
      {
        id: 'geometric',
        label: 'A geometric sans',
        rule: 'Set headlines in a geometric sans built from circles and straight lines.',
        title: 'Geometric sans headlines',
      },
      {
        id: 'serif',
        label: 'A serif',
        rule: 'Set headlines in a serif.',
        title: 'Serif headlines',
      },
    ],
  },
  {
    id: 'labels',
    ask: 'Above a section heading…',
    topics: ['visual', 'layout'],
    options: [
      {
        id: 'label',
        label: 'A small label',
        rule: 'Put a small uppercase label above section headings to name and group them.',
        title: 'Small labels over headings',
      },
      {
        id: 'none',
        label: 'Nothing',
        rule: 'Let section headings stand alone, with no small label above them.',
        title: 'Headings stand alone',
      },
    ],
  },
  {
    id: 'density',
    ask: 'Tables and lists are…',
    topics: ['layout'],
    options: [
      {
        id: 'dense',
        label: 'Dense',
        rule: 'Make tables and lists dense, with many rows visible at once.',
        title: 'Dense tables and lists',
      },
      {
        id: 'roomy',
        label: 'Roomy',
        rule: 'Give table and list rows room, with fewer of them visible at once.',
        title: 'Roomy tables and lists',
      },
    ],
  },
  {
    id: 'grouping',
    ask: 'Sections are set apart by…',
    topics: ['layout'],
    options: [
      {
        id: 'space',
        label: 'Space',
        rule: 'Set sections apart with space, not lines or boxes.',
        title: 'Space between sections',
      },
      {
        id: 'lines',
        label: 'Lines and boxes',
        rule: 'Set sections apart with dividers or outlined boxes.',
        title: 'Lines between sections',
      },
    ],
  },
  {
    id: 'figures',
    ask: 'A screen’s headline figure is…',
    topics: ['visual'],
    options: [
      {
        id: 'big',
        label: 'Big and bold',
        rule: 'Show the headline figure on a screen big and bold; keep other figures at text size.',
        title: 'Big headline figures',
      },
      {
        id: 'text',
        label: 'Text size',
        rule: 'Keep figures at text size, headline ones too; no big display numbers.',
        title: 'Figures at text size',
      },
    ],
  },
  {
    id: 'motion',
    ask: 'As sections scroll into view…',
    topics: ['interaction'],
    options: [
      {
        id: 'fade',
        label: 'A subtle fade-up',
        rule: 'As sections scroll into view, fade them up subtly: short, and only once.',
        title: 'Subtle fade-up on scroll',
      },
      {
        id: 'still',
        label: 'They stay still',
        rule: "Don't animate sections as they scroll in; keep motion for answering what people do.",
        title: 'No motion on scroll',
      },
    ],
  },
  {
    id: 'imagery',
    ask: 'Pages show…',
    topics: ['visual'],
    options: [
      {
        id: 'product',
        label: 'The product',
        rule: "Show the product's own screens, never stock photos of people.",
        title: 'Real product screens',
      },
      {
        id: 'people',
        label: 'People',
        rule: 'Show photos of people and real scenes to make the product feel human.',
        title: 'Photos of people',
      },
    ],
  },
  {
    id: 'voice',
    ask: 'The words are…',
    topics: ['copy'],
    options: [
      {
        id: 'plain',
        label: 'Plain',
        rule: 'Write plainly, with no jokes or playful phrases.',
        title: 'Plain words',
      },
      {
        id: 'playful',
        label: 'Playful',
        rule: 'Give the words a playful voice, but keep errors about money or lost work plain.',
        title: 'Playful voice, plain errors',
      },
    ],
  },
];

/** A question's answer as a rule keeps it. */
export const tasteKey = (question: string, option: string) => `${question}:${option}`;

/** The option a question was answered with in this collection, if it was. */
export function answerOf(c: Collection, question: string): string | null {
  const r = c.rules.find((x) => x.taste?.startsWith(`${question}:`) && x.status !== 'dismissed');
  return r?.taste?.slice(question.length + 1) ?? null;
}

/**
 * The author's answers written into their rules: one rule per answered question. Answered again
 * the same, a rule keeps the author's own edits and its notes, and comes back if it was removed;
 * answered otherwise, it takes the new answer's words, and its notes, which backed the old one,
 * are let go. A question skipped leaves its rule as it was.
 */
export function withTaste(
  c: Collection,
  answers: Record<string, string>,
  now: string,
  newId: () => string,
): Collection {
  let rules = c.rules;
  for (const q of TASTE) {
    const o = q.options.find((x) => x.id === answers[q.id]);
    if (!o) continue;
    const key = tasteKey(q.id, o.id);
    const had = rules.find((r) => r.taste?.startsWith(`${q.id}:`));
    const fresh: Partial<Rule> = {
      text: o.rule,
      title: o.title,
      context: '',
      topics: sortTopics(q.topics),
      evidence: [],
      taste: key,
    };
    if (!had) {
      rules = [
        ...rules,
        { id: newId(), tags: [], status: 'approved', createdAt: now, ...fresh } as Rule,
      ];
      continue;
    }
    const change: Partial<Rule> = had.taste === key ? {} : fresh;
    rules = rules.map((r) => (r === had ? { ...r, ...change, status: 'approved' } : r));
  }
  return rules === c.rules ? c : { ...c, rules, updatedAt: now };
}
