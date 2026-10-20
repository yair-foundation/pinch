import { principleName } from './foundation';
import { type SourceKind, sortTopics, sourceLabel, TOPICS, type Topic, topicLabel } from './model';

/*
 * The person's taste library (D79, D86, D87): one collection of design rules
 * an agent follows, drawn from their notes on screenshots. The notes come in
 * a batch at a time (each batch kept as its Pinch export, for the close-ups);
 * the AI reads the new ones against the rules already there and, for each,
 * strengthens a rule that says the same, writes a new one, or flags a
 * conflict with one. A rule stands on its own: it holds the notes it draws on
 * (one note can inform several rules, one rule draws on notes across images).
 * Rules are guidance as soon as Pinch writes them; the author can edit them
 * (D88). This file is the pure part; the browser keeps the collection in
 * IndexedDB (`collections-store.ts`), or the account in the Blob store.
 */

/** A note as the collection keeps it: its words and where its close-up is in the batch's export. */
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

/** A note by where it is kept: its batch, and its number in that batch. */
export type NoteRef = { batchId: string; note: string };

/**
 * Every rule is `approved`, guidance as soon as it is written (D88). Rules kept before D88 may
 * be `proposed` (read as approved) or `dismissed` (kept out of sight and out of exports, and
 * sent to the AI so it doesn't write them again).
 */
export type RuleStatus = 'proposed' | 'approved' | 'dismissed';

/** A question Pinch asks the author about a rule, each answer with the rule it makes (D90). */
export type RuleQuestion = { ask: string; options: { answer: string; rule: string }[] };

export type Rule = {
  id: string;
  /** The rule, one sentence. Empty while it is locked. */
  text: string;
  /** Where it holds, a few words ("in data tables"), or empty when it holds everywhere. */
  context: string;
  topics: Topic[];
  /** The author's own tags: a project, a client, a kind of work. */
  tags: string[];
  /** The notes it draws on, oldest first. */
  evidence: NoteRef[];
  status: RuleStatus;
  /** The AI's wording as it came, so the export can say whether the author changed it. */
  drafted?: string;
  /** Another rule this one pulls against, and why both may hold. */
  conflict?: { ruleId: string; why: string };
  /**
   * `interpreted`: Pinch's reading of the author's vaguer words, not their own (D90), with how
   * it read them in `reading`. Absent: stated, the notes' own words.
   */
  basis?: 'stated' | 'interpreted';
  reading?: string;
  /** A question the rule waits on: until the author answers, no agent gets it (D90). */
  question?: RuleQuestion;
  /**
   * The ids of the foundation's principles that helped Pinch read it (D90): they explain the
   * rule; its notes are what make it the author's.
   */
  principles?: string[];
  /** Notes added since the author last opened its evidence. */
  fresh?: number;
  /**
   * Found before Pinch was bought: shown only as a placeholder, its words never sent. Bought,
   * its notes are read again and it is written in full.
   */
  locked?: boolean;
  createdAt: string;
};

/** Before D87 a collection held one learning per note; they are read once into rules. */
export type Learning = {
  id: string;
  batchId: string;
  note: string;
  text: string;
  drafted?: string;
  topics: Topic[];
};

export type Collection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  batches: Batch[];
  rules: Rule[];
  /** The notes the AI has read, as `batchId/ref`; the rest wait for it. */
  read: string[];
  /** Before D87 only. */
  learnings?: Learning[];
};

/** The name of the one collection each person has (D86). */
export const RULES_NAME = 'My rules';

export function newCollection(name: string, id: string, now: string): Collection {
  return { id, name, createdAt: now, updatedAt: now, batches: [], rules: [], read: [] };
}

export const noteKey = (r: NoteRef) => `${r.batchId}/${r.note}`;

/**
 * What makes two notes the same note, whichever batch carried them: the image and the words.
 * Adding the open images again adds only the notes that are new or were reworded.
 */
export const noteFingerprint = (image: string, works: string, doesNotWork: string) =>
  `${image.trim()}\n${works.trim()}\n${doesNotWork.trim()}`;

const fingerprintOf = (n: BatchNote) => noteFingerprint(n.image, n.works, n.doesNotWork);

/** The fingerprints of every note the collection holds. */
export const knownNotes = (c: Collection) =>
  new Set(c.batches.flatMap((b) => b.notes.map(fingerprintOf)));

/** The notes of a batch the collection doesn't hold yet. */
export const newNotes = (c: Collection, notes: BatchNote[]) => {
  const known = knownNotes(c);
  return notes.filter((n) => (n.works || n.doesNotWork) && !known.has(fingerprintOf(n)));
};

/**
 * A collection as kept, brought up to date: arrays where older records had none, and the
 * learnings of before D87 as approved rules (keeping a rule was agreeing with it, D80), each
 * on its one note. Notes whose learning was never written wait to be read.
 */
export function upgradeCollection(raw: Collection, newId: () => string): Collection {
  const c: Collection = {
    ...raw,
    batches: raw.batches ?? [],
    rules: (raw.rules ?? []).map((r) => ({
      ...r,
      tags: r.tags ?? [],
      context: r.context ?? '',
      status: r.status === 'proposed' ? 'approved' : r.status,
    })),
    read: raw.read ?? [],
  };
  if (!raw.learnings) return c;
  const read = new Set(c.read);
  for (const l of raw.learnings) {
    const ref = { batchId: l.batchId, note: l.note };
    if (l.text.trim()) {
      c.rules.push({
        id: newId(),
        text: l.text.trim(),
        context: '',
        topics: sortTopics(l.topics ?? []),
        tags: [],
        evidence: [ref],
        status: 'approved',
        ...(l.drafted ? { drafted: l.drafted } : {}),
        createdAt: raw.updatedAt ?? raw.createdAt,
      });
      read.add(noteKey(ref));
    } else if (l.drafted === '') read.add(noteKey(ref));
  }
  const { learnings: _, ...rest } = c;
  return { ...rest, read: [...read] };
}

/**
 * Another collection's notes and rules added to this one, for the one collection a person
 * keeps (D86): what this one already has is left as it is. A note this one already holds
 * (the same image and words) is not kept twice: the other's rules point at this one's copy,
 * and a batch left with no new note is dropped. A rule worded the same as one here adds its
 * notes to it instead of showing twice.
 */
export function mergeCollection(into: Collection, from: Collection, now: string): Collection {
  const where = new Map<string, NoteRef>();
  for (const b of into.batches)
    for (const n of b.notes) where.set(fingerprintOf(n), { batchId: b.id, note: n.ref });
  const moved = new Map<string, NoteRef>();
  const batchIds = new Set(into.batches.map((b) => b.id));
  const batches = [...into.batches];
  for (const b of from.batches) {
    if (batchIds.has(b.id)) continue;
    const kept: BatchNote[] = [];
    for (const n of b.notes) {
      const here = where.get(fingerprintOf(n));
      if (here) moved.set(noteKey({ batchId: b.id, note: n.ref }), here);
      else {
        kept.push(n);
        where.set(fingerprintOf(n), { batchId: b.id, note: n.ref });
      }
    }
    if (kept.length) batches.push({ ...b, notes: kept });
  }
  const at = (r: NoteRef) => moved.get(noteKey(r)) ?? r;
  const once = (refs: NoteRef[]) => [...new Map(refs.map((r) => [noteKey(r), r])).values()];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  let rules = [...into.rules];
  for (const r of from.rules) {
    if (rules.some((x) => x.id === r.id)) continue;
    const evidence = once(r.evidence.map(at));
    const twin = r.text.trim() ? rules.find((x) => !x.locked && same(x.text, r.text)) : undefined;
    if (twin)
      rules = rules.map((x) =>
        x === twin ? { ...x, evidence: once([...x.evidence, ...evidence]) } : x,
      );
    else rules.push({ ...r, evidence });
  }
  const read = new Set(into.read);
  for (const k of from.read) {
    const i = k.indexOf('/');
    read.add(noteKey(at({ batchId: k.slice(0, i), note: k.slice(i + 1) })));
  }
  return { ...into, updatedAt: now, batches, rules, read: [...read] };
}

/** The collection with a batch added; its notes wait for the AI. */
export const withBatch = (c: Collection, batch: Batch, now: string): Collection => ({
  ...c,
  updatedAt: now,
  batches: [...c.batches, batch],
});

export const withRule = (c: Collection, id: string, change: Partial<Rule>, now: string) => ({
  ...c,
  updatedAt: now,
  rules: c.rules.map((r) => (r.id === id ? { ...r, ...change } : r)),
});

/** Every note the AI hasn't read yet, oldest batch first. */
export function unreadNotes(c: Collection): { batch: Batch; note: BatchNote }[] {
  const read = new Set(c.read);
  return c.batches.flatMap((batch) =>
    batch.notes
      .filter((note) => !read.has(noteKey({ batchId: batch.id, note: note.ref })))
      .map((note) => ({ batch, note })),
  );
}

/** A note by its reference, with its batch. */
export function noteAt(c: Collection, ref: NoteRef): { batch: Batch; note: BatchNote } | undefined {
  const batch = c.batches.find((b) => b.id === ref.batchId);
  const note = batch?.notes.find((n) => n.ref === ref.note);
  return batch && note ? { batch, note } : undefined;
}

/** The notes a rule draws on that the collection still holds. */
export const evidenceOf = (c: Collection, r: Rule) =>
  r.evidence.map((e) => noteAt(c, e)).filter((x) => x !== undefined);

/** How many images a rule's notes are on. */
export const imagesOf = (c: Collection, r: Rule) =>
  new Set(evidenceOf(c, r).map(({ batch, note }) => `${batch.id}/${note.image}`)).size;

/** What the AI made of some notes, by the notes' and rules' own ids (see `learn.ts`). */
export type Reading = {
  strengthen: { rule: string; notes: string[] }[];
  propose: {
    rule: string;
    context: string;
    topics: Topic[];
    notes: string[];
    conflictsWith?: string;
    conflict?: string;
    basis?: 'stated' | 'interpreted';
    reading?: string;
    question?: RuleQuestion;
    principles?: string[];
    locked?: boolean;
  }[];
};

/**
 * A reading applied: the notes it was given count as read, the rules they strengthen gain
 * them as evidence, and each new rule joins as guidance (or `locked`, unseen until Pinch is
 * bought). `notes` maps the ids the AI saw to the notes they stand for.
 */
export function applyReading(
  c: Collection,
  reading: Reading,
  notes: Map<string, NoteRef>,
  now: string,
  newId: () => string,
): Collection {
  const refs = (ids: string[]) => {
    const seen = new Set<string>();
    const out: NoteRef[] = [];
    for (const id of ids) {
      const ref = notes.get(id);
      if (!ref || seen.has(noteKey(ref))) continue;
      seen.add(noteKey(ref));
      out.push(ref);
    }
    return out;
  };
  const rules = c.rules.map((r) => {
    const add = reading.strengthen
      .filter((s) => s.rule === r.id)
      .flatMap((s) => refs(s.notes))
      .filter((ref) => !r.evidence.some((e) => noteKey(e) === noteKey(ref)));
    if (!add.length) return r;
    return {
      ...r,
      evidence: [...r.evidence, ...add],
      fresh: (r.fresh ?? 0) + add.length,
    };
  });
  for (const p of reading.propose) {
    const evidence = refs(p.notes);
    if (!evidence.length || (!p.locked && !p.rule.trim())) continue;
    const other = p.conflictsWith ? c.rules.find((r) => r.id === p.conflictsWith) : undefined;
    rules.push({
      id: newId(),
      text: p.locked ? '' : p.rule.trim(),
      context: p.locked ? '' : p.context.trim(),
      topics: sortTopics(p.topics),
      tags: [],
      evidence,
      status: 'approved',
      ...(p.locked ? { locked: true } : { drafted: p.rule.trim() }),
      ...(other && !p.locked
        ? { conflict: { ruleId: other.id, why: (p.conflict ?? '').trim() } }
        : {}),
      ...(p.basis === 'interpreted' && !p.locked ? { basis: 'interpreted' as const } : {}),
      ...(p.reading?.trim() && !p.locked ? { reading: p.reading.trim() } : {}),
      ...(p.question && !p.locked ? { question: p.question } : {}),
      ...(p.principles?.length && !p.locked ? { principles: p.principles } : {}),
      createdAt: now,
    });
  }
  const read = new Set(c.read);
  for (const ref of notes.values()) read.add(noteKey(ref));
  return { ...c, updatedAt: now, rules, read: [...read] };
}

/**
 * The author answers a rule's question: the rule becomes that answer's, as if they had said it
 * (D90), and their agent gets it from now on.
 */
export function answerRule(c: Collection, id: string, option: number, now: string): Collection {
  const o = c.rules.find((r) => r.id === id)?.question?.options[option];
  if (!o) return c;
  return withRule(c, id, ownWords({ text: o.rule, drafted: o.rule }), now);
}

/**
 * A change that makes a rule the author's own words: no reading, no question. The principles
 * stay: they explain the notes, which haven't changed, and the rule is still browsed by them.
 */
export const ownWords = (change: Partial<Rule>): Partial<Rule> => ({
  ...change,
  basis: 'stated',
  reading: undefined,
  question: undefined,
});

/** The names of the principles that helped read a rule, for the author and their agent. */
export const principlesOf = (r: Pick<Rule, 'principles'>) =>
  (r.principles ?? []).flatMap((id) => principleName(id) ?? []);

/**
 * Bought: the locked rules go, and their notes wait to be read again, now to be written in
 * full. A note a written rule already holds is read again too, and only strengthens it.
 */
export function unlockRules(c: Collection, now: string): Collection {
  const locked = c.rules.filter((r) => r.locked);
  if (!locked.length) return c;
  const again = new Set(locked.flatMap((r) => r.evidence.map(noteKey)));
  return {
    ...c,
    updatedAt: now,
    rules: c.rules.filter((r) => !r.locked),
    read: c.read.filter((k) => !again.has(k)),
  };
}

/** Whose words a rule is: the AI's as drafted, the AI's edited by the author, or the author's. */
export function originOf(r: Pick<Rule, 'text' | 'drafted'>): 'ai' | 'ai-edited' | 'author' {
  if (r.drafted === undefined || !r.drafted.trim()) return 'author';
  return r.text.trim() === r.drafted.trim() ? 'ai' : 'ai-edited';
}

/** Every tag the author gave a rule, in the order first used. */
export const tagsOf = (rules: Rule[]) => [...new Set(rules.flatMap((r) => r.tags))];

/** A tag as the author typed it, tidied: one line, 30 characters at most. */
export const cleanTag = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 30);

export type TopicGroup = { topic: Topic | null; label: string; rules: Rule[] };

/**
 * Rules by topic, in the topics' order, each under its first topic (so a rule shows once),
 * and those without one last, under "Not tagged".
 */
export function byTopic(rules: Rule[]): TopicGroup[] {
  const groups: TopicGroup[] = [
    ...TOPICS.map((t) => ({ topic: t.kind, label: t.label, rules: [] as Rule[] })),
    { topic: null, label: 'Not tagged', rules: [] },
  ];
  for (const r of rules) {
    const first = TOPICS.find((t) => r.topics.includes(t.kind))?.kind ?? null;
    groups.find((g) => g.topic === first)?.rules.push(r);
  }
  return groups.filter((g) => g.rules.length);
}

/**
 * Which rules a view or a task takes, sliced by tags: a rule is taken when any of its topics
 * is among `topics`, and any of its own tags among `tags` (`null` stands for none, in both).
 * Leaving either out takes them all.
 */
/** Which rules to take: by topic, by the author's tag, by the principle that explains them. */
export type RulePick = {
  topics?: readonly (Topic | null)[];
  tags?: readonly (string | null)[];
  principles?: readonly string[];
};

export const picked = (r: Rule, pick: RulePick) =>
  (!pick.topics ||
    (r.topics.length
      ? r.topics.some((t) => pick.topics?.includes(t))
      : pick.topics.includes(null))) &&
  (!pick.tags ||
    (r.tags.length ? r.tags.some((t) => pick.tags?.includes(t)) : pick.tags.includes(null))) &&
  (!pick.principles || (r.principles ?? []).some((p) => pick.principles?.includes(p)));

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** One note of an exported rule, with its close-up's name in `evidence/`. */
export type ExportedNote = { batch: Batch; note: BatchNote; file: string };

/** A rule as it is exported: its number, the rule, and its notes. */
export type ExportedRule = { id: string; rule: Rule; notes: ExportedNote[] };

/**
 * The rules an export carries: the ones the pick takes (never a dismissed or locked one, nor one
 * waiting on its question), by topic, then oldest
 * first. Numbered R1, R2, … in that order; each note's close-up is `evidence/r01-1.jpg` and on.
 */
export function rulesOf(c: Collection, pick: RulePick = {}): ExportedRule[] {
  const topicOrder = (r: Rule) => {
    const i = TOPICS.findIndex((t) => r.topics.includes(t.kind));
    return i < 0 ? TOPICS.length : i;
  };
  const chosen = c.rules
    .filter(
      (r) =>
        r.status === 'approved' && !r.locked && !r.question && r.text.trim() && picked(r, pick),
    )
    .sort((a, b) => topicOrder(a) - topicOrder(b) || a.createdAt.localeCompare(b.createdAt));
  const width = chosen.length > 99 ? 3 : 2;
  return chosen.map((rule, i) => {
    const n = String(i + 1).padStart(width, '0');
    return {
      id: `R${i + 1}`,
      rule,
      notes: evidenceOf(c, rule).map((e, j) => ({ ...e, file: `evidence/r${n}-${j + 1}.jpg` })),
    };
  });
}

/** Where a note came from, in one line: "note 02.3 on pricing.png (Competitor)". */
const fromLine = (n: ExportedNote) =>
  `note ${n.note.ref} on ${n.note.image}${n.note.source ? ` (${sourceLabel(n.note.source)})` : ''}`;

const said = (n: BatchNote) =>
  [
    n.works.trim() ? `works: "${oneLine(n.works)}"` : '',
    n.doesNotWork.trim() ? `doesn't: "${oneLine(n.doesNotWork)}"` : '',
  ]
    .filter(Boolean)
    .join('; ');

const HOW_TO_USE = [
  'These are design rules the author keeps, each drawn from notes they wrote on screenshots. Follow them in design and front-end work for this author.',
  'A rule with "Where" holds there only; one without holds everywhere. Where two rules pull different ways, each holds in its own place.',
  'A rule with "Pinch\'s reading" is Pinch\'s interpretation of vaguer words, not the author\'s own: follow it, and lean on its notes where it doesn\'t fit the task.',
  '"Explained by" names the design principles Pinch read the notes with. They explain the rule; the author\'s notes are what make it their preference, so never apply a principle further than its rule.',
  'Refer to rules by number ("R4"), so the author can find them.',
  'Each rule lists the notes it comes from and their close-ups in `evidence/`. Open a close-up when you need to see what the rule means; the note says what the author saw there.',
  "A rule drawn from someone else's product (Competitor, Other product, Concept) carries a principle; never copy that design.",
  "When a rule conflicts with what the task asks for, the task wins: say which rule you set aside and why. Don't ask the author to restate a rule; read its notes and close-ups first.",
];

/** The rules file an agent reads: `design-rules.md`. */
export function rulesMarkdown(c: Collection, rules: ExportedRule[], exportedAt: string): string {
  const lines = [
    `# Design rules: ${oneLine(c.name)}`,
    '',
    `Exported from Pinch on ${exportedAt.slice(0, 10)}: ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}.`,
    '',
    '## How to use these',
    '',
    ...HOW_TO_USE.map((l) => `- ${l}`),
  ];
  for (const group of byTopic(rules.map((r) => r.rule))) {
    lines.push('', `## ${group.label}`);
    for (const rule of group.rules) {
      const r = rules.find((x) => x.rule === rule) as ExportedRule;
      const others = rule.topics.slice(1).map(topicLabel);
      lines.push('', `**${r.id}.** ${oneLine(rule.text)}`);
      if (rule.context.trim()) lines.push('', `Where: ${oneLine(rule.context)}.`);
      if (rule.basis === 'interpreted' && rule.reading?.trim())
        lines.push('', `Pinch's reading: ${oneLine(rule.reading)}`);
      if (principlesOf(rule).length) lines.push('', `Explained by: ${principlesOf(rule).join(', ')}.`);
      if (others.length || rule.tags.length)
        lines.push(
          '',
          [
            others.length ? `Also about: ${others.join(', ')}.` : '',
            rule.tags.length ? `Tags: ${rule.tags.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      lines.push('', `From ${r.notes.length} ${r.notes.length === 1 ? 'note' : 'notes'}:`);
      for (const n of r.notes) lines.push(`- \`${n.file}\`, ${fromLine(n)}: ${said(n.note)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `rules.json`: the same rules as data. */
export function rulesManifest(c: Collection, rules: ExportedRule[], exportedAt: string) {
  return {
    tool: 'Pinch',
    kind: 'rules',
    version: 2,
    collection: c.name,
    exportedAt,
    guide: 'design-rules.md',
    rules: rules.map((r) => ({
      id: r.id,
      text: oneLine(r.rule.text),
      ...(r.rule.context.trim() ? { where: oneLine(r.rule.context) } : {}),
      topics: r.rule.topics,
      tags: r.rule.tags,
      origin: originOf(r.rule),
      basis: r.rule.basis ?? 'stated',
      ...(r.rule.basis === 'interpreted' && r.rule.reading?.trim()
        ? { reading: oneLine(r.rule.reading) }
        : {}),
      ...(r.rule.principles?.length ? { principles: r.rule.principles } : {}),
      notes: r.notes.map((n) => ({
        evidence: n.file,
        ref: n.note.ref,
        batch: n.batch.name,
        image: n.note.image,
        source: n.note.source,
        ...(n.note.works.trim() ? { works: n.note.works.trim() } : {}),
        ...(n.note.doesNotWork.trim() ? { doesNotWork: n.note.doesNotWork.trim() } : {}),
      })),
    })),
  };
}

/**
 * The rules as text to paste into a chat with an agent for one task: the same rules and
 * notes as `design-rules.md`, without the close-ups.
 */
export function rulesText(c: Collection, rules: ExportedRule[]): string {
  const lines = [
    `Design rules from ${oneLine(c.name)} (Pinch), ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}. Follow them in this task; a rule with "where" holds there only. When one conflicts with the task, the task wins: say which rule you set aside. Refer to rules by number.`,
  ];
  for (const r of rules) {
    const about = [...r.rule.topics.map(topicLabel), ...r.rule.tags].join(', ');
    lines.push(
      '',
      `${r.id}. ${oneLine(r.rule.text)}${r.rule.context.trim() ? ` (where: ${oneLine(r.rule.context)})` : ''}${about ? ` [${about}]` : ''}`,
    );
    if (r.rule.basis === 'interpreted' && r.rule.reading?.trim())
      lines.push(`   Pinch's reading: ${oneLine(r.rule.reading)}`);
    if (principlesOf(r.rule).length)
      lines.push(`   Explained by: ${principlesOf(r.rule).join(', ')}.`);
    for (const n of r.notes) lines.push(`   - ${fromLine(n)}: ${said(n.note)}`);
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
