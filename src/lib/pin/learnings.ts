import { type SourceKind, sourceLabel, TOPICS, type Topic, topicLabel } from './model';

/*
 * Collections: what a designer keeps from batch to batch. A collection holds
 * batches (each kept as its Pinch export, so it can be opened again) and one
 * learning per note: a rule the note teaches, drafted by the AI or written by
 * the author, which the author approves, edits or rejects, and marks as their
 * personal taste or as this project's. Approved learnings export as a rules
 * file an agent follows, each with the close-up it came from. This file is the
 * pure part; the browser keeps collections in IndexedDB (`collections-store.ts`).
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

/** Personal taste holds everywhere; a project's rule holds for that project only. */
export type Scope = 'personal' | 'project';
export const SCOPES: { kind: Scope; label: string }[] = [
  { kind: 'personal', label: 'Personal taste' },
  { kind: 'project', label: 'This project' },
];
export const scopeLabel = (s: Scope) => SCOPES.find((x) => x.kind === s)?.label ?? s;

export type LearningStatus = 'draft' | 'approved' | 'rejected';

export type Learning = {
  id: string;
  batchId: string;
  /** The note it comes from, by its number in the batch: "02.3". */
  note: string;
  /** The rule, one sentence. Empty until drafted or written. */
  text: string;
  /** The AI's draft as it came, so the export can say whether the author changed it. */
  drafted?: string;
  status: LearningStatus;
  scope: Scope;
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

/** A note from our own product teaches about this project; anyone else's, about taste. */
export const defaultScope = (source: SourceKind | null): Scope =>
  source === 'ours' ? 'project' : 'personal';

export function newCollection(name: string, id: string, now: string): Collection {
  return { id, name, createdAt: now, updatedAt: now, batches: [], learnings: [] };
}

/** The collection with a batch added, and an empty draft learning for each of its notes. */
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
    status: 'draft',
    scope: defaultScope(n.source),
    topics: n.topics,
  }));
  return {
    ...c,
    updatedAt: now,
    batches: [...c.batches, batch],
    learnings: [...c.learnings, ...drafts],
  };
}

/** The collection without a batch, and without the learnings drawn from it. */
export const withoutBatch = (c: Collection, batchId: string, now: string): Collection => ({
  ...c,
  updatedAt: now,
  batches: c.batches.filter((b) => b.id !== batchId),
  learnings: c.learnings.filter((l) => l.batchId !== batchId),
});

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

/** Drafts with nothing written yet: what the AI is asked to draft. */
export const unwritten = (c: Collection) =>
  c.learnings.filter((l) => l.status === 'draft' && !l.text.trim() && l.drafted === undefined);

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
 * The rules an export carries: the approved learnings among `ids` that have
 * words and a note, personal taste first, then by topic, then in the order the
 * batches were added. Numbered R1, R2, … in that order, each with its close-up's
 * file name in `evidence/`.
 */
export function rulesOf(c: Collection, ids: ReadonlySet<string>): Rule[] {
  const scopeOrder = (s: Scope) => SCOPES.findIndex((x) => x.kind === s);
  const topicOrder = (l: Learning) => {
    const i = TOPICS.findIndex((t) => l.topics.includes(t.kind));
    return i < 0 ? TOPICS.length : i;
  };
  const batchOrder = (l: Learning) => c.batches.findIndex((b) => b.id === l.batchId);
  const chosen = c.learnings
    .filter((l) => ids.has(l.id) && l.status === 'approved' && l.text.trim() && noteOf(c, l))
    .sort(
      (a, b) =>
        scopeOrder(a.scope) - scopeOrder(b.scope) ||
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
  'These are design rules the author approved, each drawn from a note they wrote on a screenshot. Follow them in design and front-end work for this author.',
  '"Personal taste" rules hold for everything the author makes. "This project" rules hold for the project this file sits in.',
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
  for (const scope of SCOPES) {
    const inScope = rules.filter((r) => r.learning.scope === scope.kind);
    if (!inScope.length) continue;
    lines.push('', `## ${scope.label}`);
    for (const group of byTopic(inScope.map((r) => r.learning))) {
      lines.push('', `### ${group.label}`);
      for (const l of group.learnings) {
        const r = inScope.find((x) => x.learning === l) as Rule;
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
      scope: r.learning.scope,
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

/** A file-safe name for a collection: "Acme dashboard" → "acme-dashboard". */
export const collectionSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'collection';
