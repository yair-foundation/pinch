import { CHECK_SCRIPT } from './check-script';
import {
  type Checks,
  CHECK_SCRIPT_FILE,
  CHECKS_DATA_FILE,
  checksManifest,
  checksOf,
} from './checks';
import { principleName } from './foundation';
import { type ExportedVersion, mergeExports } from './changes';
import { fingerprint } from './hash';
import {
  itemsLine,
  cleanScreenTag,
  SOURCES,
  type SourceKind,
  sortTopics,
  sourceLabel,
  TOPICS,
  type Topic,
  topicLabel,
} from './model';
import { checksGuide, CHECKS_FILE } from './package-checks';
import { type ReviewList, reviewCells, reviewFile, reviewPages, reviewSpan } from './review-sheets';
import {
  briefsLines,
  briefsOf,
  KEEP_IN_PINCH,
  LIVE_RULES_WIN,
  OPEN_CALLS,
  OUTSIDE_TARGET,
  outsideTarget,
  rolesLine,
  type ScreenNames,
  type ScreenRole,
  screenGroup,
  screenIndex,
  screenNames,
  seenOn,
  sourceRoleOf,
  seenOnLine,
} from './screen-index';

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
  /** Its screenshot's tag (D100), as the author typed it: a product, a feature, a domain. */
  screenTag?: string;
  /** The close-up's path inside the export's folder: "crops/02-pricing-note-3.jpg". */
  crop: string;
  /** The author holds this note up as the one to follow (D108). Only on a note that says what works. */
  best?: true;
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
  /**
   * A short name for it, two to five words, written by the AI (D95): with the reading, or
   * afterwards for a rule without one. Gone when the author rewrites the rule, to be named again.
   */
  title?: string;
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
  /**
   * Another rule this one pulls against, and why both may hold. `settled`: the author said each
   * holds in its place (D102), this one where it says, the other everywhere else.
   */
  conflict?: { ruleId: string; why: string; settled?: boolean };
  /**
   * The taste check's answer this rule is (D102), as `question:option`: the author's own pick,
   * with no notes until a note strengthens it.
   */
  taste?: string;
  /**
   * Agreed with the agent in conversation and kept by the author (D116): what they agreed, when
   * it was kept, and the proposal it came from, so the same proposal is never kept twice. A new
   * rule from the agent has no notes until a note strengthens it.
   */
  agreed?: { why: string; at: string; proposal?: string };
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
  /** The render checks (D109), worked out from the rules in the background. */
  checks?: Checks;
  /** What each set of screenshots is for, by the set's compared tag (`screenGroup`, D110). */
  screenRoles?: Record<string, ScreenRole>;
  /** What each product or feature is for and how it should feel, by the set's compared tag (D121). */
  briefs?: Record<string, string>;
  /** The product the free plan's agent gets, by its compared tag (D123). */
  freeProduct?: string;
  /** The rules as each recent export had them, to tell an agent what changed since its copy (D128). */
  exports?: ExportedVersion[];
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
  const bestHere = new Set<string>();
  const batchIds = new Set(into.batches.map((b) => b.id));
  const batches = [...into.batches];
  for (const b of from.batches) {
    if (batchIds.has(b.id)) continue;
    const kept: BatchNote[] = [];
    for (const n of b.notes) {
      const here = where.get(fingerprintOf(n));
      if (here) {
        moved.set(noteKey({ batchId: b.id, note: n.ref }), here);
        // A best example (D108) stays one, whichever copy of the note is kept.
        if (n.best) bestHere.add(noteKey(here));
      }
      else {
        kept.push(n);
        where.set(fingerprintOf(n), { batchId: b.id, note: n.ref });
      }
    }
    if (kept.length) batches.push({ ...b, notes: kept });
  }
  for (const [i, b] of batches.entries())
    if (b.notes.some((n) => !n.best && bestHere.has(noteKey({ batchId: b.id, note: n.ref }))))
      batches[i] = {
        ...b,
        notes: b.notes.map((n) =>
          bestHere.has(noteKey({ batchId: b.id, note: n.ref })) ? { ...n, best: true } : n,
        ),
      };
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
  // The checks this one has stay; the other's come only where this one has none (D109).
  const checks = into.checks ?? from.checks;
  // A role this one gives a set stays; the other's fill in the sets this one hasn't given (D110).
  const screenRoles = { ...from.screenRoles, ...into.screenRoles };
  // The same for briefs (D121).
  const briefs = { ...from.briefs, ...into.briefs };
  // Both one's exports, so a copy from either can be compared (D128).
  const exports = mergeExports(into.exports, from.exports);
  return {
    ...into,
    updatedAt: now,
    batches,
    rules,
    read: [...read],
    ...(checks ? { checks } : {}),
    ...(Object.keys(screenRoles).length ? { screenRoles } : {}),
    ...(Object.keys(briefs).length ? { briefs } : {}),
    ...((into.freeProduct ?? from.freeProduct)
      ? { freeProduct: into.freeProduct ?? from.freeProduct }
      : {}),
    ...(exports.length ? { exports } : {}),
  };
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

/**
 * The collection with a note marked as one of the author's best examples, or no longer (D108).
 * Only a note that says what works can be one; anything else is left as it is.
 */
export function withBest(c: Collection, ref: NoteRef, best: boolean, now: string): Collection {
  const batch = c.batches.find((b) => b.id === ref.batchId);
  const note = batch?.notes.find((n) => n.ref === ref.note);
  if (!batch || !note || Boolean(note.best) === best || (best && !note.works.trim())) return c;
  const { best: _, ...rest } = note;
  const next: BatchNote = best ? { ...rest, best: true } : rest;
  return {
    ...c,
    updatedAt: now,
    batches: c.batches.map((b) =>
      b === batch ? { ...b, notes: b.notes.map((n) => (n === note ? next : n)) } : b,
    ),
  };
}

/** Whether the author marked any note as a best example, so the agent is told how to weigh one. */
export const hasBest = (c: Collection) => c.batches.some((b) => b.notes.some((n) => n.best));

/**
 * The rules that came from a batch's notes alone (D115): they go with it. A taste-check pick
 * a note strengthened stays, the author's own choice with no notes again.
 */
const onlyFrom = (c: Collection, batchId: string) =>
  new Set(
    c.rules
      .filter((r) => !r.taste && r.evidence.length && r.evidence.every((e) => e.batchId === batchId))
      .map((r) => r.id),
  );

/** What removing a batch takes with it, for the author to confirm (D115). */
export function batchReach(c: Collection, batchId: string) {
  const batch = c.batches.find((b) => b.id === batchId);
  const gone = onlyFrom(c, batchId);
  const live = (r: Rule) => r.status !== 'dismissed';
  return {
    notes: batch?.notes.length ?? 0,
    images: batch?.images ?? 0,
    /** Rules, not removed before, that go with it. */
    rules: c.rules.filter((r) => live(r) && gone.has(r.id)).length,
    /** Rules that keep other notes and lose these. */
    fewer: c.rules.filter(
      (r) => live(r) && !gone.has(r.id) && r.evidence.some((e) => e.batchId === batchId),
    ).length,
  };
}

/**
 * The collection without one batch of notes (D115): its notes leave every rule that drew on
 * them, a rule that came from them alone goes too (deleted, not dismissed: the author removed
 * the notes, not the rule, so Pinch may write it again from others), a rule set against one of
 * those loses the pull, and none of its notes waits to be read. Its zip is the caller's to
 * delete, once this is saved.
 */
export function withoutBatch(c: Collection, batchId: string, now: string): Collection {
  if (!c.batches.some((b) => b.id === batchId)) return c;
  const gone = onlyFrom(c, batchId);
  return {
    ...c,
    updatedAt: now,
    batches: c.batches.filter((b) => b.id !== batchId),
    read: c.read.filter((k) => !k.startsWith(`${batchId}/`)),
    rules: c.rules.flatMap((r) => {
      if (gone.has(r.id)) return [];
      const evidence = r.evidence.filter((e) => e.batchId !== batchId);
      const pullGone = r.conflict !== undefined && gone.has(r.conflict.ruleId);
      if (evidence.length === r.evidence.length && !pullGone) return [r];
      const { conflict, ...rest } = r;
      return [{ ...rest, evidence, ...(conflict && !pullGone ? { conflict } : {}) }];
    }),
  };
}

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

/**
 * A screen tag compared as the same whatever its case, spacing, punctuation or plural (D105,
 * D108): "Marketing Asset - Inbox" is "marketing assets – inbox".
 */
const screenKey = (v: string) => screenGroup(cleanScreenTag(v));

/**
 * The tags of a rule's screenshots (D100): every one its notes' screenshots carry, each once,
 * spelled as the author spelled it most (D108). Read from the notes, so it stays current.
 */
export function screenOf(c: Collection, r: Rule, names: ScreenNames = screenNames(c)): string[] {
  const out: string[] = [];
  for (const { note } of evidenceOf(c, r)) {
    const v = note.screenTag;
    if (v && !out.some((x) => screenKey(x) === screenKey(v))) out.push(names.name(v));
  }
  return out;
}

/** The screen tags across some rules, with how many rules carry each, most first. */
export function screenTagsIn(c: Collection, rules: Rule[]): { value: string; n: number }[] {
  const out: { value: string; n: number }[] = [];
  const names = screenNames(c);
  for (const r of rules)
    for (const v of screenOf(c, r, names)) {
      const have = out.find((x) => screenKey(x.value) === screenKey(v));
      if (have) have.n++;
      else out.push({ value: v, n: 1 });
    }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * The collection with its notes' screen tags brought up to date from the open images (D100),
 * by each note's fingerprint, so a tag typed after a note was kept still reaches its rules. The
 * same collection back when nothing changed.
 */
export function withScreenTags(
  c: Collection,
  byPrint: ReadonlyMap<string, string | undefined>,
  now: string,
): Collection {
  let changed = false;
  const batches = c.batches.map((b) => {
    let touched = false;
    const notes = b.notes.map((n) => {
      const print = fingerprintOf(n);
      if (!byPrint.has(print)) return n;
      const tag = cleanScreenTag(byPrint.get(print));
      if (tag === (n.screenTag ?? '')) return n;
      touched = true;
      const { screenTag: _, ...rest } = n;
      return tag ? { ...rest, screenTag: tag } : rest;
    });
    if (!touched) return b;
    changed = true;
    return { ...b, notes };
  });
  return changed ? { ...c, updatedAt: now, batches } : c;
}

/**
 * The collection with best examples (D110) brought in from the open images, by each note's
 * fingerprint, like their tags: a note the author marked or unmarked on its image takes that;
 * one never marked there keeps what Your rules says. The same collection back when nothing changed.
 */
export function withOpenBest(
  c: Collection,
  byPrint: ReadonlyMap<string, boolean>,
  now: string,
): Collection {
  let changed = false;
  const batches = c.batches.map((b) => {
    let touched = false;
    const notes = b.notes.map((n) => {
      const best = byPrint.get(fingerprintOf(n));
      if (best === undefined || Boolean(n.best) === (best && Boolean(n.works.trim()))) return n;
      touched = true;
      const { best: _, ...rest } = n;
      return best && n.works.trim() ? { ...rest, best: true as const } : rest;
    });
    if (!touched) return b;
    changed = true;
    return { ...b, notes };
  });
  return changed ? { ...c, updatedAt: now, batches } : c;
}

/** A note's fingerprint, to find it among the open images. */
export const printOf = (n: BatchNote) => fingerprintOf(n);

/** How many images a rule's notes are on. */
export const imagesOf = (c: Collection, r: Rule) =>
  new Set(evidenceOf(c, r).map(({ batch, note }) => `${batch.id}/${note.image}`)).size;

/** What the AI made of some notes, by the notes' and rules' own ids (see `learn.ts`). */
export type Reading = {
  strengthen: { rule: string; notes: string[] }[];
  propose: {
    rule: string;
    title?: string;
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
      ...(p.title?.trim() && !p.locked ? { title: p.title.trim() } : {}),
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

/** Titles named for rules that had none (D95); a rule given one meanwhile keeps its own. */
export function withTitles(
  c: Collection,
  titles: { id: string; title: string }[],
  now: string,
): Collection {
  const by = new Map(titles.map((t) => [t.id, t.title]));
  let changed = false;
  const rules = c.rules.map((r) => {
    const title = by.get(r.id);
    if (!title || r.title || r.locked) return r;
    changed = true;
    return { ...r, title };
  });
  return changed ? { ...c, rules, updatedAt: now } : c;
}

/**
 * A rule waits for its author (D91): on its question, or, read from vaguer words, until they
 * confirm Pinch's reading. Until then no export or agent gets it.
 */
export const waiting = (r: Pick<Rule, 'question' | 'basis'>) =>
  Boolean(r.question) || r.basis === 'interpreted';

/** The author confirms Pinch's reading of a rule: it is theirs now, and their agent gets it. */
export const confirmRule = (c: Collection, id: string, now: string): Collection =>
  withRule(c, id, ownWords({}), now);

/**
 * The author settles a conflict in one step (D102): each rule in its place, or this one wins and
 * the rule it pulls against is removed (kept as dismissed, so Pinch doesn't write it again).
 */
export function settleConflict(
  c: Collection,
  id: string,
  how: 'place' | 'wins',
  now: string,
): Collection {
  const conflict = c.rules.find((r) => r.id === id)?.conflict;
  if (!conflict) return c;
  if (how === 'place') return withRule(c, id, { conflict: { ...conflict, settled: true } }, now);
  return withRule(
    withRule(c, conflict.ruleId, { status: 'dismissed' }, now),
    id,
    { conflict: undefined },
    now,
  );
}

/**
 * The author answers a rule's question: the rule becomes that answer's, as if they had said it
 * (D90), and their agent gets it from now on.
 */
export function answerRule(c: Collection, id: string, option: number, now: string): Collection {
  const o = c.rules.find((r) => r.id === id)?.question?.options[option];
  if (!o) return c;
  return withRule(c, id, ownWords({ text: o.rule, drafted: o.rule, title: undefined }), now);
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
  /**
   * By its screenshots' tags (D100): a rule is taken when one of its notes' screenshots carries
   * one of these, whatever their case. Needs the collection.
   */
  screen?: readonly string[];
};

/** Whether a rule's screenshots carry a tag a pick asks for; true when it asks for none. */
const screenPicked = (c: Collection | undefined, r: Rule, want: RulePick['screen']) =>
  !want?.length ||
  (c !== undefined &&
    evidenceOf(c, r).some(
      ({ note }) => note.screenTag && want.some((w) => screenKey(w) === screenKey(note.screenTag ?? '')),
    ));

export const picked = (r: Rule, pick: RulePick, c?: Collection) =>
  screenPicked(c, r, pick.screen) &&
  (!pick.topics ||
    (r.topics.length
      ? r.topics.some((t) => pick.topics?.includes(t))
      : pick.topics.includes(null))) &&
  (!pick.tags ||
    (r.tags.length ? r.tags.some((t) => pick.tags?.includes(t)) : pick.tags.includes(null))) &&
  (!pick.principles || (r.principles ?? []).some((p) => pick.principles?.includes(p)));

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** One note of an exported rule, with its batch. */
export type ExportedNote = { batch: Batch; note: BatchNote };

/** A rule as it is exported: its number, the rule, and its notes. */
export type ExportedRule = { id: string; rule: Rule; notes: ExportedNote[] };

/**
 * The rules an agent gets: the ones the pick takes (never a dismissed or locked one, nor one
 * waiting for its author), by topic, then oldest first. Numbered R1, R2, … in that order.
 */
export function rulesOf(c: Collection, pick: RulePick = {}): ExportedRule[] {
  const topicOrder = (r: Rule) => {
    const i = TOPICS.findIndex((t) => r.topics.includes(t.kind));
    return i < 0 ? TOPICS.length : i;
  };
  const chosen = c.rules
    .filter(
      (r) =>
        r.status === 'approved' &&
        !r.locked &&
        !waiting(r) &&
        r.text.trim() &&
        picked(r, pick, c),
    )
    .sort((a, b) => topicOrder(a) - topicOrder(b) || a.createdAt.localeCompare(b.createdAt));
  return chosen.map((rule, i) => ({ id: `R${i + 1}`, rule, notes: evidenceOf(c, rule) }));
}

/**
 * The rules' version (D125): a fingerprint of what an agent reads in them (each rule's number,
 * words, place, topics and tags, and the briefs), so a copy of the rules in a package can be told
 * from the current ones. A note added to a rule doesn't change it; a change to its words does.
 */
export const rulesVersion = (c: Collection): string =>
  fingerprint(
    JSON.stringify([
      rulesOf(c).map(({ rule: r }) => [r.id, r.text.trim(), r.context.trim(), r.topics, r.tags]),
      briefsOf(c),
    ]),
  );

/** Where a note came from, in one line: "note 02.3 on pricing.png (Competitor)". */
const fromLine = (n: ExportedNote) => `note ${n.note.ref} on ${n.note.image}${noteAbout(n.note)}`;

/**
 * Whose design a note's screenshot is, its tag (D100) and whether the author holds it up as a
 * best example (D108), as " (Competitor; tag Linear; the author's best example)".
 */
export function noteAbout(n: Pick<BatchNote, 'source' | 'screenTag' | 'best'>): string {
  const about = [
    n.source ? sourceLabel(n.source) : '',
    n.screenTag ? `tag ${n.screenTag}` : '',
    n.best ? "the author's best example" : '',
  ];
  const parts = about.filter(Boolean);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

const said = (n: BatchNote) =>
  [
    n.works.trim() ? `works: "${itemsLine(n.works)}"` : '',
    n.doesNotWork.trim() ? `doesn't: "${itemsLine(n.doesNotWork)}"` : '',
  ]
    .filter(Boolean)
    .join('; ');

/**
 * The rules as text for an agent: what Copy as text puts on the clipboard and get_design_rules
 * answers. Each rule with where it holds, what it is about, and the notes it draws on; before
 * them, the briefs (D121): for the screen tags asked for, or every one, then any `more` lines
 * the answer carries (D125: what the products asked for lack, the author's corrections).
 */
export function rulesText(
  c: Collection,
  rules: ExportedRule[],
  screen?: readonly string[],
  more: readonly string[] = [],
): string {
  // The designer's taste comes before any general design guidance the agent also has (D102).
  const lines = [
    `Design rules from ${oneLine(c.name)} (Pinch), ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}. Follow them in this task; a rule with "where" holds there only. They are this designer's taste: where general design guidance or a design skill you also follow says otherwise, these rules win. When one conflicts with the task, the task wins: say which rule you set aside.${hasBest(c) ? " A note marked the author's best example is one they hold up to follow: weigh it above the others." : ''} Refer to rules by number. ${OPEN_CALLS} ${KEEP_IN_PINCH} ${LIVE_RULES_WIN}`,
    ...(rolesLine(c) ? [rolesLine(c)] : []),
    ...briefsLines(c, screen),
    ...more,
  ];
  const numbers = new Map(rules.map((r) => [r.rule.id, r.id]));
  for (const r of rules) {
    const about = [...r.rule.topics.map(topicLabel), ...r.rule.tags].join(', ');
    lines.push(
      '',
      `${r.id}. ${oneLine(r.rule.text)}${r.rule.context.trim() ? ` (where: ${oneLine(r.rule.context)})` : ''}${about ? ` [${about}]` : ''}`,
    );
    const against = r.rule.conflict && numbers.get(r.rule.conflict.ruleId);
    if (r.rule.conflict && against) lines.push(`   ${pullLine(r.rule, against)}`);
    if (principlesOf(r.rule).length)
      lines.push(`   Explained by: ${principlesOf(r.rule).join(', ')}.`);
    if (r.rule.taste) lines.push("   - the designer's own pick in Pinch's taste check");
    if (r.rule.agreed)
      lines.push(`   - agreed with the designer in conversation: ${oneLine(r.rule.agreed.why)}`);
    for (const n of r.notes) lines.push(`   - ${fromLine(n)}: ${said(n.note)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * How a rule that pulls against another tells the agent which to follow (D102): where it holds,
 * this one; everywhere else, the other. Unsettled, the newer one is followed, and the agent is
 * told the designer hasn't settled it.
 */
function pullLine(r: Rule, against: string): string {
  const where = oneLine(r.context);
  const which = where
    ? `Follow this one ${where}, ${against} elsewhere.`
    : 'Follow this one, the newer.';
  if (r.conflict?.settled) return `Holds over ${against}. ${which}`;
  const why = oneLine(r.conflict?.why ?? '');
  return `Pulls against ${against}, not settled by the designer yet${why ? `: ${why.replace(/[.\s]+$/, '')}` : ''}. ${which}`;
}

/** A file-safe name: "Acme dashboard" becomes "acme-dashboard". */
export const collectionSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'collection';

/** A file of the rules package, as the zip writer takes it. */
export type PackageFile = { name: string; data: Uint8Array };

/** The package's folder: "pinch-rules-my-rules-2026-10-22/". */
export const packageRoot = (c: Collection, stamp: string) =>
  `pinch-rules-${collectionSlug(c.name)}-${stamp.slice(0, 10)}/`;

/** A batch by its place and name, as its folder in the package is named: "02-pinch-2026-10-20". */
export const batchLabel = (i: number, b: Batch) =>
  `${String(i + 1).padStart(2, '0')}-${collectionSlug(b.name)}`;

/** A batch's folder inside the package: "batches/02-pinch-2026-10-20/". */
const batchFolder = (i: number, b: Batch) => `batches/${batchLabel(i, b)}/`;

/**
 * The whole collection as a package to keep (D104): `design-rules.md` and `rules.json` to read,
 * `collection.json` as it is kept (every rule, with the ones waiting for their author and the
 * removed, and every batch with its notes), and each batch's files (screenshots, marked copies,
 * close-ups, `notes.json`) in a folder of its own. `files` is each batch's export read back, by
 * batch id; a batch whose export can't be read is left out and counted in `missing`, with the
 * notes whose close-up isn't in it. `sheets` is each batch's review sheets as drawn (D106), by
 * batch id, written beside its other files and listed in the index.
 */
export function rulesPackage(
  c: Collection,
  files: ReadonlyMap<string, ReadonlyMap<string, Uint8Array> | null>,
  stamp: string,
  sheets: ReadonlyMap<string, Uint8Array[]> = new Map(),
): { files: PackageFile[]; rules: number; missing: number } {
  const root = packageRoot(c, stamp);
  const rules = rulesOf(c);
  const names = screenNames(c);
  const reviews: ReviewList = [];
  const encode = (s: string) => new TextEncoder().encode(s);
  const out: PackageFile[] = [];
  const folders = new Map<string, string>();
  let missing = 0;
  for (const [i, b] of c.batches.entries()) {
    const folder = batchFolder(i, b);
    folders.set(b.id, folder);
    const found = files.get(b.id);
    if (!found) {
      missing += b.notes.length;
      continue;
    }
    for (const [name, data] of found)
      out.push({
        name: root + folder + (name.startsWith(b.root) ? name.slice(b.root.length) : name),
        data,
      });
    missing += b.notes.filter((n) => !found.has(b.root + n.crop)).length;
    const drawn = sheets.get(b.id) ?? [];
    if (!drawn.length) continue;
    const pages = reviewPages(reviewCells(b, rules, names));
    const listed = drawn.slice(0, pages.length).map((data, p) => {
      out.push({ name: root + folder + reviewFile(p), data });
      return { file: reviewFile(p), notes: reviewSpan(pages[p]) };
    });
    reviews.push({ folder, sheets: listed });
  }
  const fileOf = (n: ExportedNote) => (folders.get(n.batch.id) ?? '') + n.note.crop;
  out.unshift(
    { name: `${root}README.md`, data: encode(packageReadme(c, rules.length, stamp)) },
    { name: `${root}index.md`, data: encode(screenIndex(c, rules, stamp, reviews, folders)) },
    { name: root + CHECKS_FILE, data: encode(checksGuide(c, rules, stamp)) },
    // The checks worked out from the rules and the script that runs them (D109), when there are any.
    ...(checksOf(c).length
      ? [
          {
            name: root + CHECKS_DATA_FILE,
            data: encode(`${JSON.stringify(checksManifest(c, rules, stamp), null, 2)}\n`),
          },
          { name: root + CHECK_SCRIPT_FILE, data: encode(CHECK_SCRIPT) },
        ]
      : []),
    { name: `${root}design-rules.md`, data: encode(rulesMarkdown(c, rules, stamp, fileOf)) },
    {
      name: `${root}rules.json`,
      data: encode(`${JSON.stringify(rulesManifest(c, rules, stamp, fileOf), null, 2)}\n`),
    },
    { name: `${root}collection.json`, data: encode(`${JSON.stringify(c, null, 2)}\n`) },
  );
  return { files: out, rules: rules.length, missing };
}

function packageReadme(c: Collection, rules: number, stamp: string): string {
  return `${[
    `# ${oneLine(c.name)}: a Pinch backup`,
    '',
    `Exported from Pinch on ${stamp.slice(0, 10)}: ${rules} ${rules === 1 ? 'rule' : 'rules'} in ${c.batches.length} ${c.batches.length === 1 ? 'batch' : 'batches'} of notes.`,
    '',
    '- `index.md`: where to start. The notes sorted by source and screen tag, with counts and a reading order, to find the sets that match your task.',
    `- \`${CHECKS_FILE}\`: how to turn the rules a rendered page can decide into checks in your own project, so they hold every time.`,
    ...(checksOf(c).length
      ? [
          `- \`${CHECKS_DATA_FILE}\` and \`${CHECK_SCRIPT_FILE}\`: checks Pinch worked out from the rules, ready to run on any rendered page in a browser.`,
        ]
      : []),
    '- `design-rules.md`: the rules to read, or to put where your agent reads its instructions. Each rule names its notes and their close-ups.',
    '- `rules.json`: the same rules as data.',
    '- `collection.json`: everything as Pinch keeps it, the rules waiting for you and the removed ones too.',
    '- `batches/`: one folder for each batch of notes. Each has the screenshots, their marked copies, the close-ups in `crops/`, a contact sheet, review sheets when they could be drawn (`review-01.jpg` and on: the close-ups with their notes, nine to a sheet) and `notes.json`. To open one again in Pinch, zip that folder and drop it in.',
  ].join('\n')}\n`;
}

const BEST_LINE =
  'A note marked "the author\'s best example" is one they hold up as the one to follow: weigh it above the others. `index.md` lists them all.';
const OUTSIDE_LINE =
  "A rule drawn from someone else's product (Competitor, Other product, Concept) carries a principle; never copy that design.";

const HOW_TO_USE = [
  'These are design rules the author keeps, each drawn from notes they wrote on screenshots. Follow them in design and front-end work for this author.',
  'The author\'s own taste comes before any general design guidance or design skill you also follow: where they say otherwise, these rules win.',
  'A rule with "Where" holds there only; one without holds everywhere. Where two rules pull different ways, each holds in its own place.',
  '"Seen on" says whose design the rule\'s notes are on (Ours, Competitor, Other product, Concept) and the screen tags of those screenshots. `index.md` sorts all the notes the same way, with a reading order.',
  BEST_LINE,
  'A screen tag in "Seen on" may carry the role the author gave its set: target style is the look to aim for; how it looks today shows the product as it is, so take what exists from it, not its look; principle only gives the idea, never the look.',
  '"Explained by" names the design principles Pinch read the notes with. They explain the rule; the author\'s notes are what make it their preference, so never apply a principle further than its rule.',
  'Refer to rules by number ("R4"), so the author can find them.',
  'Each rule lists the notes it comes from and their close-ups. Open a close-up when you need to see what the rule means; the note says what the author saw there.',
  OUTSIDE_LINE,
  "When a rule conflicts with what the task asks for, the task wins: say which rule you set aside and why. Don't ask the author to restate a rule; read its notes and close-ups first.",
  OPEN_CALLS,
  KEEP_IN_PINCH,
  LIVE_RULES_WIN,
];

/** The rules file an agent reads: `design-rules.md`. */
export function rulesMarkdown(
  c: Collection,
  rules: ExportedRule[],
  exportedAt: string,
  fileOf: (n: ExportedNote) => string,
): string {
  const lines = [
    `# Design rules: ${oneLine(c.name)}`,
    '',
    `Exported from Pinch on ${exportedAt.slice(0, 10)}: ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, version ${rulesVersion(c)}.`,
    '',
    // A copy goes stale when the author changes a rule; the version tells (D125).
    `When you're connected to Pinch, call list_rule_topics with version "${rulesVersion(c)}": it says whether this copy is current and, if it isn't, which rules are new, changed or gone since. Those win over this file.`,
    '',
    '## How to use these',
    '',
    // Best examples only when there are some; never copy, unless the author made someone else's
    // product the target style (D111), and then how far that goes (D114).
    ...HOW_TO_USE.flatMap((l) => {
      if (l === BEST_LINE) return hasBest(c) ? [`- ${l}`] : [];
      if (l === OUTSIDE_LINE && outsideTarget(c))
        return [
          `- A rule drawn from someone else's product (Competitor, Other product, Concept) carries a principle, never a copy, unless the author made it the target style. ${OUTSIDE_TARGET}`,
        ];
      return [`- ${l}`];
    }),
    // What each product or feature is for, as the author wrote it (D121).
    ...(briefsOf(c).length
      ? [
          '',
          '## Briefs',
          '',
          'What the author says each product or feature is for and how it should feel. Let it decide what the rules leave open; where a rule says otherwise, the rule wins.',
          '',
          ...briefsOf(c).map((b) => `- **${b.tag}**: ${b.brief}`),
        ]
      : []),
  ];
  const numbers = new Map(rules.map((r) => [r.rule.id, r.id]));
  const names = screenNames(c);
  for (const group of byTopic(rules.map((r) => r.rule))) {
    lines.push('', `## ${group.label}`);
    for (const rule of group.rules) {
      const r = rules.find((x) => x.rule === rule) as ExportedRule;
      const others = rule.topics.slice(1).map(topicLabel);
      lines.push('', `**${r.id}.** ${oneLine(rule.text)}`);
      if (rule.context.trim()) lines.push('', `Where: ${oneLine(rule.context)}.`);
      const against = rule.conflict && numbers.get(rule.conflict.ruleId);
      if (rule.conflict && against) lines.push('', pullLine(rule, against));
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
      const seen = seenOnLine(seenOn(r.notes, names), c);
      if (seen) lines.push('', `Seen on: ${seen}.`);
      if (rule.taste) lines.push('', "The designer's own pick in Pinch's taste check.");
      if (rule.agreed)
        lines.push('', `Agreed with the author in conversation: ${oneLine(rule.agreed.why)}`);
      // A rule with no notes, such as a taste-check pick (D102) or one agreed (D116), has nothing to list.
      if (r.notes.length)
        lines.push('', `From ${r.notes.length} ${r.notes.length === 1 ? 'note' : 'notes'}:`);
      for (const n of r.notes) lines.push(`- \`${fileOf(n)}\`, ${fromLine(n)}: ${said(n.note)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `rules.json`: the same rules as data. */
export function rulesManifest(
  c: Collection,
  rules: ExportedRule[],
  exportedAt: string,
  fileOf: (n: ExportedNote) => string,
) {
  const names = screenNames(c);
  return {
    tool: 'Pinch',
    kind: 'rules',
    version: 4,
    collection: c.name,
    exportedAt,
    // What list_rule_topics compares to say whether this copy is current (D125).
    rulesVersion: rulesVersion(c),
    guide: 'design-rules.md',
    // What each set of screenshots is for, as the author says (D110).
    ...(Object.keys(c.screenRoles ?? {}).length
      ? {
          screenRoles: [
            ...SOURCES.flatMap((s) => {
              const role = sourceRoleOf(c, s.kind);
              return role ? [{ source: s.kind, role }] : [];
            }),
            ...screenNames(c)
              .all()
              .flatMap((tag) => {
                const role = c.screenRoles?.[screenGroup(tag)];
                return role ? [{ tag, role }] : [];
              }),
          ],
        }
      : {}),
    ...(briefsOf(c).length ? { briefs: briefsOf(c) } : {}),
    rules: rules.map((r) => ({
      id: r.id,
      // The same from one export to the next, where the number isn't: for checks kept by rule (D108).
      key: r.rule.id,
      text: oneLine(r.rule.text),
      ...(r.rule.context.trim() ? { where: oneLine(r.rule.context) } : {}),
      topics: r.rule.topics,
      tags: r.rule.tags,
      origin: originOf(r.rule),
      ...(r.rule.agreed ? { agreed: oneLine(r.rule.agreed.why) } : {}),
      seenOn: seenOn(r.notes, names),
      ...(r.rule.principles?.length ? { principles: r.rule.principles } : {}),
      notes: r.notes.map((n) => ({
        evidence: fileOf(n),
        ref: n.note.ref,
        batch: n.batch.name,
        image: n.note.image,
        source: n.note.source,
        ...(n.note.best ? { best: true } : {}),
        ...(n.note.screenTag ? { tag: n.note.screenTag } : {}),
        ...(n.note.works.trim() ? { works: n.note.works.trim() } : {}),
        ...(n.note.doesNotWork.trim() ? { doesNotWork: n.note.doesNotWork.trim() } : {}),
      })),
    })),
  };
}
