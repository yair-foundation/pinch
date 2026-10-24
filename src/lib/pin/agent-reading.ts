import { z } from 'zod';
import {
  type CleanReading,
  cleanReading,
  type LearnResult,
  type LibraryRule,
  learnPrompt,
  learnSchema,
  learnSystem,
  MAX_LEARN_NOTES,
  MAX_LEARN_RULES,
} from './learn';
import {
  applyReading,
  type Batch,
  type BatchNote,
  type Collection,
  type NoteRef,
  noteKey,
  unreadNotes,
} from './learnings';

/*
 * Reading notes into rules with the person's own agent (D122). Pinch's own reading runs on its
 * AI and takes credits (D98); a connected agent can do the same reading on its own allowance.
 * It gets the unread notes, their close-ups and the rules so far with the same method Pinch's
 * reading follows (`learnSystem`, with the foundation), and answers in the same shape
 * (`learnSchema`). Its reading waits in the account, apart from the collection the page saves
 * whole, until the page applies it as it applies its own. Ids are the notes' and rules' own
 * keys, so nothing has to be remembered between the two calls. Pure.
 */

/** A note to read, by the key it is kept under ("batch/01.2"). */
export type NoteToRead = { key: string; batch: Batch; note: BatchNote };

/** The next unread notes, as many as one reading takes. */
export const notesToRead = (c: Collection): NoteToRead[] =>
  unreadNotes(c)
    .slice(0, MAX_LEARN_NOTES)
    .map(({ batch, note }) => ({
      key: noteKey({ batchId: batch.id, note: note.ref }),
      batch,
      note,
    }));

/** The rules a reading weighs the notes against, as the page sends them to Pinch's reading. */
export function libraryOf(c: Collection): LibraryRule[] {
  return c.rules
    .filter((r) => !r.locked && r.text.trim())
    .slice(-MAX_LEARN_RULES)
    .map((r) => ({
      id: r.id,
      text: r.text,
      context: r.context,
      topics: r.topics,
      status: r.status,
      ...(r.basis === 'interpreted' ? { basis: r.basis } : {}),
      ...(r.question ? { question: r.question.ask } : {}),
    }));
}

/** The library and the notes, as Pinch's own reading gets them. */
export const readingPrompt = (c: Collection, todo: NoteToRead[]) =>
  learnPrompt({
    rules: libraryOf(c),
    notes: todo.map(({ key, note }) => ({
      id: key,
      works: note.works,
      doesNotWork: note.doesNotWork,
      ...(note.label ? { label: note.label } : {}),
      topics: note.topics,
      source: note.source,
      ...(note.best ? { best: true } : {}),
    })),
  });

/** What the agent is told before the notes: Pinch's method, then how to answer. */
export const READING_GUIDE = `${learnSystem}

Read the notes below this way. Then call submit_reading once with every note id you read in read (those that taught nothing too), what they strengthen and the rules they propose, in the fields its schema describes. Pinch adds the reading to the person's rules when they next open Your rules, as it does its own. Call get_notes_to_read again for the next notes until none are left.`;

const p = learnSchema.shape.propose.element.shape;

/** The agent's answer: Pinch's reading shape, every field it can leave out given its default. */
export const agentReadingSchema = z.object({
  read: z
    .array(z.string())
    .describe('The ids of every note you read, including those that taught no rule.'),
  strengthen: learnSchema.shape.strengthen.default([]),
  propose: z
    .array(
      z.object({
        rule: p.rule,
        notes: p.notes,
        title: p.title.default(''),
        context: p.context.default(''),
        topics: p.topics.default([]),
        conflictsWith: p.conflictsWith.default(''),
        conflict: p.conflict.default(''),
        basis: p.basis.default('stated'),
        reading: p.reading.default(''),
        question: p.question.default(''),
        options: p.options.default([]),
        principles: p.principles.default([]),
      }),
    )
    .default([])
    .describe(learnSchema.shape.propose.description ?? ''),
});

/** `submit_reading`'s input, as JSON Schema. */
export function readingInputSchema() {
  const { $schema: _, ...schema } = z.toJSONSchema(agentReadingSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return schema;
}

/** A reading by the agent, waiting for the page to apply it. */
export type AgentReading = { id: string; at: string; read: string[]; reading: CleanReading };

export const MAX_AGENT_READINGS = 20;

/**
 * The agent's answer, checked against the notes still unread and the rules there are: a reading
 * to keep, or what is wrong with it. A note it names but didn't list in `read` counts as read.
 */
export function agentReadingOf(
  args: unknown,
  c: Collection | null,
  now: string,
  id: string,
): { reading: AgentReading } | { error: string } {
  const parsed = agentReadingSchema.safeParse(args ?? {});
  if (!parsed.success)
    return {
      error: `That isn't a reading: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ')}.`,
    };
  if (!c) return { error: 'No notes to read yet.' };
  const unread = new Set(unreadNotes(c).map(({ batch, note }) => noteKey({ batchId: batch.id, note: note.ref })));
  const named = [
    ...parsed.data.read,
    ...parsed.data.strengthen.flatMap((s) => s.notes),
    ...parsed.data.propose.flatMap((x) => x.notes),
  ];
  const read = [...new Set(named.filter((k) => unread.has(k)))];
  if (!read.length)
    return {
      error:
        'None of those notes is waiting to be read: call get_notes_to_read and use the ids it gives.',
    };
  const reading = cleanReading(
    parsed.data as LearnResult,
    read,
    c.rules.map((r) => r.id),
  );
  return { reading: { id, at: now, read, reading } };
}

/** The readings waiting, with one more; the oldest go past the cap. */
export const withAgentReading = (list: AgentReading[], r: AgentReading) =>
  [...list, r].slice(-MAX_AGENT_READINGS);

/** What a stored document holds, tidied: anything not a reading is left out. */
export function agentReadingsIn(doc: unknown): AgentReading[] {
  const list = (doc as { readings?: unknown })?.readings;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (r): r is AgentReading =>
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      Array.isArray(r.read) &&
      r.reading &&
      Array.isArray(r.reading.strengthen) &&
      Array.isArray(r.reading.propose),
  );
}

/**
 * The collection with an agent's reading applied as the page applies Pinch's own: only the notes
 * still in it and still unread, and only the rules still there.
 */
export function applyAgentReading(
  c: Collection,
  r: AgentReading,
  now: string,
  newId: () => string,
): Collection {
  const unread = new Set(unreadNotes(c).map(({ batch, note }) => noteKey({ batchId: batch.id, note: note.ref })));
  const notes = new Map<string, NoteRef>();
  for (const key of r.read) {
    if (!unread.has(key)) continue;
    const i = key.indexOf('/');
    notes.set(key, { batchId: key.slice(0, i), note: key.slice(i + 1) });
  }
  if (!notes.size) return c;
  return applyReading(c, r.reading, notes, now, newId);
}
