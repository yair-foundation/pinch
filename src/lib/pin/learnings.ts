import {
  type SourceKind,
  sourceLabel,
  TOPICS,
  type Topic,
  topicLabel,
} from './model';

/*
 * Collections: what a designer keeps from batch to batch. A collection holds
 * batches (each kept as its Pinch export, so it can be opened again) and one
 * learning per note: a rule the note teaches, drafted by the AI or written by
 * the author. Keeping a
 * rule is agreeing with it; the author edits or deletes the ones that miss
 * (D78). Rules export as a rules file an agent follows, each with the close-up
 * it came from, all of them or the topics a task needs. This file
 * is the pure part; the browser keeps collections in IndexedDB
 * (`collections-store.ts`).
 */

/** A note as a collection keeps it: its words and where its close-up is in the batch's export. */
export type BatchNote = {
  /** Its number in the export: "02.3", the third note on image 02. */
  ref: string;
  /** The image's file name. */
  image: string;
  source: SourceKind | null;
  topics: Topic[];
  works: string;
  doesNotWork: string;
  label?: string;
  /** The close-up's path inside the export's folder: "crops/02-pricing-note-3.jpg". */
  crop: string;
};

export type Batch = {
  id: string;
  /** The export's name: "pinch-2026-10-20". */
  name: string;
  addedAt: string;
  exportedAt: string;
  /** The export's folder inside its zip: "pinch-2026-10-20/". */
  root: string;
  images: number;
  notes: BatchNote[];
};

export type Learning = {
  id: string;
  batchId: string;
  /** The note it comes from, by its number in the batch: "02.3". */
  note: string;
  /** The rule, one sentence. Empty until drafted or written. */
  text: string;
  /** The AI's draft as it came, so the export can say whether the author changed it. */
  drafted?: string;
  topics: Topic[];
};

export type Collection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  batches: Batch[];
  learnings: Learning[];
};

export function newCollection(name: string, id: string, now: string): Collection {
  return { id, name, createdAt: now, updatedAt: now, batches: [], learnings: [] };
}

/** The name of the one collection each person has (D86). */
export const RULES_NAME = 'My rules';

/**
 * Another collection's batches and rules added to this one, for the one
 * collection a person keeps (D86): what this one already has is left as it is.
 */
export function mergeCollection(into: Collection, from: Collection, now: string): Collection {
  const batchIds = new Set(into.batches.map((b) => b.id));
  const learningIds = new Set(into.learnings.map((l) => l.id));
  return {
    ...into,
    updatedAt: now,
    batches: [...into.batches, ...from.batches.filter((b) => !batchIds.has(b.id))],
    learnings: [...into.learnings, ...from.learnings.filter((l) => !learningIds.has(l.id))],
  };
}

/** The collection with a batch added, and an empty learning for each of its notes. */
export function withBatch(
  c: Collection,
  batch: Batch,
  now: string,
  newId: () => string,
): Collection {
  const drafts: Learning[] = batch.notes.map((n) => ({
    id: newId(),
    batchId: batch.id,
    note: n.ref,
    text: '',
    topics: n.topics,
  }));
  return {
    ...c,
    updatedAt: now,
    batches: [...c.batches, batch],
    learnings: [...c.learnings, ...drafts],
  };
}

export const withLearning = (
  c: Collection,
  id: string,
  change: Partial<Learning>,
  now: string,
): Collection => ({
  ...c,
  updatedAt: now,
  learnings: c.learnings.map((l) => (l.id === id ? { ...l, ...change } : l)),
});

export const withoutLearning = (c: Collection, id: string, now: string): Collection => ({
  ...c,
  updatedAt: now,
  learnings: c.learnings.filter((l) => l.id !== id),
});

/** The note a learning comes from. */
export function noteOf(c: Collection, l: Learning): { batch: Batch; note: BatchNote } | undefined {
  const batch = c.batches.find((b) => b.id === l.batchId);
  const note = batch?.notes.find((n) => n.ref === l.note);
  return batch && note ? { batch, note } : undefined;
}

/** Learnings with nothing written and never drafted: what the AI is asked to draft. */
export const unwritten = (c: Collection) =>
  c.learnings.filter((l) => !l.text.trim() && l.drafted === undefined);

/** Whose words a learning is: the AI's as drafted, the AI's edited by the author, or the author's. */
export function originOf(l: Learning): 'ai' | 'ai-edited' | 'author' {
  if (l.drafted === undefined || !l.drafted.trim()) return 'author';
  return l.text.trim() === l.drafted.trim() ? 'ai' : 'ai-edited';
}

export type TopicGroup = { topic: Topic | null; label: string; learnings: Learning[] };

/**
 * Learnings by topic, in the topics' order, each under its first topic (so a
 * learning shows once), and those without one last, under "Not tagged".
 */
export function byTopic(learnings: Learning[]): TopicGroup[] {
  const groups: TopicGroup[] = [
    ...TOPICS.map((t) => ({ topic: t.kind, label: t.label, learnings: [] as Learning[] })),
    { topic: null, label: 'Not tagged', learnings: [] },
  ];
  for (const l of learnings) {
    const first = TOPICS.find((t) => l.topics.includes(t.kind))?.kind ?? null;
    groups.find((g) => g.topic === first)?.learnings.push(l);
  }
  return groups.filter((g) => g.learnings.length);
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A rule as it is exported: its number, the learning, the note and batch it came from, and its close-up. */
export type Rule = {
  id: string;
  learning: Learning;
  batch: Batch;
  note: BatchNote;
  evidence: string;
};

/**
 * Which rules a task needs: the topics to take. A rule is taken when any of
 * its topics is among `topics` (`null` stands for a rule with no topic).
 * Leaving it out takes them all.
 */
export type RulePick = { topics?: readonly (Topic | null)[] };

const picked = (l: Learning, pick: RulePick) =>
  !pick.topics ||
  (l.topics.length
    ? l.topics.some((t) => pick.topics?.includes(t))
    : pick.topics.includes(null));

/**
 * The rules an export carries: every learning with words and a note that the
 * pick takes, by topic, then in the order the
 * batches were added. Numbered R1, R2, … in that order, each with its
 * close-up's file name in `evidence/`.
 */
export function rulesOf(c: Collection, pick: RulePick = {}): Rule[] {
  const topicOrder = (l: Learning) => {
    const i = TOPICS.findIndex((t) => l.topics.includes(t.kind));
    return i < 0 ? TOPICS.length : i;
  };
  const batchOrder = (l: Learning) => c.batches.findIndex((b) => b.id === l.batchId);
  const chosen = c.learnings
    .filter((l) => l.text.trim() && noteOf(c, l) && picked(l, pick))
    .sort(
      (a, b) =>
        topicOrder(a) - topicOrder(b) ||
        batchOrder(a) - batchOrder(b) ||
        a.note.localeCompare(b.note, undefined, { numeric: true }),
    );
  const width = chosen.length > 99 ? 3 : 2;
  return chosen.map((learning, i) => {
    const found = noteOf(c, learning) as { batch: Batch; note: BatchNote };
    const id = `R${i + 1}`;
    return {
      id,
      learning,
      ...found,
      evidence: `evidence/r${String(i + 1).padStart(width, '0')}.jpg`,
    };
  });
}

/** Where a rule came from, in one line: "note 02.3 on pricing.png (Competitor)". */
const fromLine = (r: Rule) =>
  `note ${r.note.ref} on ${r.note.image}${r.note.source ? ` (${sourceLabel(r.note.source)})` : ''}, ${r.batch.name}`;

const HOW_TO_USE = [
  'These are design rules the author keeps, each drawn from a note they wrote on a screenshot. Follow them in design and front-end work for this author.',
  'Refer to rules by number ("R4"), so the author can find them.',
  'Each rule names its close-up in `evidence/` and the note it came from. Open the close-up when you need to see what the rule means; the note says what the author saw there.',
  "A rule drawn from someone else's product (Competitor, Other product, Concept) carries a principle; never copy that design.",
  "When a rule conflicts with what the task asks for, the task wins: say which rule you set aside and why. Don't ask the author to restate a rule; read its note and close-up first.",
];

/** The rules file an agent reads: `design-rules.md`. */
export function rulesMarkdown(c: Collection, rules: Rule[], exportedAt: string): string {
  const lines = [
    `# Design rules: ${oneLine(c.name)}`,
    '',
    `Exported from Pinch on ${exportedAt.slice(0, 10)}: ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}.`,
    '',
    '## How to use these',
    '',
    ...HOW_TO_USE.map((l) => `- ${l}`),
  ];
  for (const group of byTopic(rules.map((r) => r.learning))) {
    lines.push('', `## ${group.label}`);
    for (const l of group.learnings) {
      const r = rules.find((x) => x.learning === l) as Rule;
      const others = l.topics.slice(1).map(topicLabel);
      lines.push(
        '',
        `**${r.id}.** ${oneLine(l.text)}`,
        '',
        `Evidence: \`${r.evidence}\`, from ${fromLine(r)}.${others.length ? ` Also about: ${others.join(', ')}.` : ''}`,
      );
      if (r.note.works.trim()) lines.push(`What works: ${oneLine(r.note.works)}`);
      if (r.note.doesNotWork.trim()) lines.push(`What doesn't: ${oneLine(r.note.doesNotWork)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `rules.json`: the same rules as data. */
export function rulesManifest(c: Collection, rules: Rule[], exportedAt: string) {
  return {
    tool: 'Pinch',
    kind: 'rules',
    version: 1,
    collection: c.name,
    exportedAt,
    guide: 'design-rules.md',
    rules: rules.map((r) => ({
      id: r.id,
      text: oneLine(r.learning.text),
      topics: r.learning.topics,
      origin: originOf(r.learning),
      evidence: r.evidence,
      note: {
        ref: r.note.ref,
        batch: r.batch.name,
        image: r.note.image,
        source: r.note.source,
        ...(r.note.works.trim() ? { works: r.note.works.trim() } : {}),
        ...(r.note.doesNotWork.trim() ? { doesNotWork: r.note.doesNotWork.trim() } : {}),
      },
    })),
  };
}

/**
 * The rules as text to paste into a chat with an agent for one task: the same
 * rules and notes as `design-rules.md`, without the close-ups.
 */
export function rulesText(c: Collection, rules: Rule[]): string {
  const lines = [
    `Design rules from ${oneLine(c.name)} (Pinch), ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}. Follow them in this task. When one conflicts with the task, the task wins: say which rule you set aside. Refer to rules by number.`,
  ];
  for (const r of rules) {
    const about = r.learning.topics.map(topicLabel).join(', ');
    const said = [
      r.note.works.trim() ? `works: "${oneLine(r.note.works)}"` : '',
      r.note.doesNotWork.trim() ? `doesn't: "${oneLine(r.note.doesNotWork)}"` : '',
    ].filter(Boolean);
    lines.push(
      '',
      `${r.id}. ${oneLine(r.learning.text)} ${about ? `(${about})` : ''}`,
      `   From a note on ${r.note.image}${r.note.source ? ` (${sourceLabel(r.note.source)})` : ''}: ${said.join('; ')}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A file-safe name for a collection: "Acme dashboard" → "acme-dashboard". */
export const collectionSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'collection';
