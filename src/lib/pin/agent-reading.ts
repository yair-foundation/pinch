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
  applyTidy,
  type Batch,
  type BatchNote,
  type Collection,
  cleanTidy,
  type NoteRef,
  noteAt,
  noteKey,
  onOwnWork,
  originOf,
  type Tidy,
  unreadNotes,
  waiting,
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
      ...(r.shows ? { shows: r.shows } : {}),
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
      ...(note.said ? { said: true } : {}),
    })),
  });

/** What the agent is told before the notes: Pinch's method, then how to answer. */
export const READING_GUIDE = `${learnSystem}

Read the notes below this way. Then call submit_reading once with every note id you read in read (those that taught nothing too), what they strengthen and the rules they propose, in the fields its schema describes. Pinch adds the reading to the person's rules when they next open Your rules, as it does its own. Call get_notes_to_read again, with method: false, for the next notes until none are left. After the last notes it asks you once to tidy the rules: do that, and the reading is done.`;

/**
 * How the agent tidies the rules once every note is read (D149). The examples are on purpose
 * none the capture test's designer gave.
 */
export const TIDY_GUIDE = `Every note is read. Tidy the rules once, before anyone builds with them. A builder follows each rule it is given and little else, so three things cost the designer: rules that say the same thing, a rule drawn from one note that goes against what several notes say about the same thing, and a detail a note gives that no rule carries. Below is every rule in force: its id, how many notes it rests on, its topics, where it holds, the rule, what its close-ups show, and each of its notes by id with its words. Then the notes no rule draws on.

- Fold rules about the same thing, where one says what the other says or is a case of it, into the one more notes share ("Keep form labels above their fields" and "Never use placeholder text as a label" into the first). Give its wording again when it must change to hold all their notes, keeping every specific they give and adding none; and what their close-ups show together.
- Drop a rule from one note when it goes against a rule from more notes about the same kind of element, in its words or in what its close-ups show. Compare the shows: the same kind of element shown done another way (another kind of typeface, weight, colour or shape) goes against it, even when the words don't clash and the screens differ (one note praises help in a hover bubble; three notes' close-ups show help as plain text under the field). Its note stays with the designer and in their package; it just isn't a rule, so no builder applies it everywhere.
- Restore what a note says that no rule says. Go through every note's words: each concrete detail it praises or faults (a mark beside a word, a sign, a kind of typeface, a weight, a count, an order, where something sits) must be in a rule as the note gives it. Where one isn't, reword the rule its note went into to carry it, when that rule is in Pinch's words and the detail is about the same thing; otherwise add a rule for it, from that note (a note praising a count beside each tab name, in a rule only about the tab names' words, gets the count back). Keep every specific the notes give and add none; a rule holds as far as its notes reach.
- Leave every other rule as it is. A rule from one note about something no other rule covers stays. Never fold rules that hold in different places, or that pull against each other, into one.
- A rule marked [author's words] can take other rules' notes but keeps its words, and is never reworded, dropped or folded away.
- A rule marked [own work] is the designer correcting work done for them. It is never dropped, and where it goes against another rule, it stands.

Then call submit_reading with tidy alone. If nothing needs tidying, send an empty tidy, so Pinch knows it's done.`;

/**
 * The tidy's request (D149): the guide, then every rule in force with each of its notes, by the
 * key it is kept under, and its words; then the notes read that no rule draws on (D150). Past
 * \`room\` characters, the words of rules from several notes are left out first.
 */
export function tidyPrompt(c: Collection, room = Number.POSITIVE_INFINITY): string {
  const live = c.rules.filter((r) => r.status === 'approved' && !r.locked && !waiting(r) && r.text.trim());
  const one = (s: string) => s.replace(/\s+/g, ' ').trim();
  const head = (r: (typeof live)[number]) =>
    [
      r.id,
      `(${r.evidence.length} ${r.evidence.length === 1 ? 'note' : 'notes'})`,
      originOf(r) === 'ai' && !r.taste && !r.agreed ? '' : "[author's words]",
      onOwnWork(c, r) ? '[own work]' : '',
      r.topics.length ? `(${r.topics.join(', ')})` : '',
      r.context.trim() ? `where: ${one(r.context)};` : '',
      one(r.text),
      r.shows?.trim() ? `| shows: ${one(r.shows)}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  const noteLine = (ref: NoteRef, said: boolean) => {
    const n = noteAt(c, ref)?.note;
    if (!n) return [];
    const words = [
      n.works.trim() ? `works: "${one(n.works)}"` : '',
      n.doesNotWork.trim() ? `doesn't: "${one(n.doesNotWork)}"` : '',
    ].filter(Boolean);
    return [`   - ${noteKey(ref)}${said && words.length ? `: ${words.join('; ')}` : ''}`];
  };
  const drawn = new Set(live.flatMap((r) => r.evidence.map(noteKey)));
  const loose = c.read.filter((key) => !drawn.has(key)).flatMap((key) => {
    const i = key.indexOf('/');
    return noteLine({ batchId: key.slice(0, i), note: key.slice(i + 1) }, true);
  });
  const write = (all: boolean) =>
    `${TIDY_GUIDE}\n\n${live
      .map((r) =>
        [
          head(r),
          ...r.evidence.flatMap((ref) => noteLine(ref, all || r.evidence.length < 2)),
        ].join('\n'),
      )
      .join('\n')}${loose.length ? `\n\nNotes no rule draws on:\n${loose.join('\n')}` : ''}`;
  const full = write(true);
  return full.length <= room ? full : write(false);
}

const p = learnSchema.shape.propose.element.shape;

/** The agent's answer: Pinch's reading shape, every field it can leave out given its default. */
export const agentReadingSchema = z.object({
  read: z
    .array(z.string())
    .default([])
    .describe('The ids of every note you read, including those that taught no rule.'),
  strengthen: learnSchema.shape.strengthen.default([]),
  propose: z
    .array(
      z.object({
        rule: p.rule,
        notes: p.notes,
        title: p.title.default(''),
        context: p.context.default(''),
        shows: p.shows.default(''),
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
  turned: learnSchema.shape.turned.default([]),
  tidy: z
    .object({
      fold: z
        .array(
          z.object({
            into: z.string().describe('The id of the rule kept: the one more notes share.'),
            rules: z.array(z.string()).describe('The ids of the rules folded into it.'),
            rule: z
              .string()
              .default('')
              .describe('Its wording again, one sentence, when it must change to hold all their notes. Else empty.'),
            shows: z
              .string()
              .default('')
              .describe('What their close-ups show together, from the rules\' shows. Else empty.'),
          }),
        )
        .default([])
        .describe('Rules about the same thing, folded into the one more notes share.'),
      drop: z
        .array(
          z.object({
            rule: z.string().describe('The id of a rule from one note.'),
            why: z.string().describe('Which rule it goes against, and how, in one sentence.'),
          }),
        )
        .default([])
        .describe('Rules from one note that go against what a rule from more notes says or shows.'),
      reword: z
        .array(
          z.object({
            rule: z.string().describe('The id of a rule in Pinch’s words.'),
            text: z
              .string()
              .describe(
                'Its wording again, one sentence, carrying the detail its notes give that it lost.',
              ),
          }),
        )
        .default([])
        .describe('Rules reworded to carry a detail their notes give.'),
      add: z
        .array(
          z.object({
            rule: z.string().describe('The new rule, one sentence.'),
            notes: z.array(z.string()).describe('The ids of the notes it comes from, as listed.'),
            topics: p.topics.default([]),
            context: p.context.default(''),
          }),
        )
        .default([])
        .describe('Rules for a detail a note gives that no rule carries.'),
    })
    .optional()
    .describe('Only when get_notes_to_read asks you to tidy the rules (D149), and then alone.'),
});

/** `submit_reading`'s input, as JSON Schema. */
export function readingInputSchema() {
  const { $schema: _, ...schema } = z.toJSONSchema(agentReadingSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return schema;
}

/** A reading by the agent, waiting for the page to apply it; or its tidy of the rules (D149). */
export type AgentReading = {
  id: string;
  at: string;
  read: string[];
  reading: CleanReading;
  tidy?: Tidy;
};

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
  // A tidy comes alone, once every note is read (D149).
  if (parsed.data.tidy && !named.length) {
    if (unread.size)
      return {
        error: 'Notes still wait to be read: read them with get_notes_to_read first, and tidy after the last.',
      };
    const tidy = cleanTidy(parsed.data.tidy, c);
    return { reading: { id, at: now, read: [], reading: { strengthen: [], propose: [] }, tidy } };
  }
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
 * still in it and still unread, and only the rules still there. The rules it proposes take ids
 * from the reading's own (D146), so the server, reading ahead of the page, and the page give
 * them the same ones, and a later reading can strengthen them.
 */
export function applyAgentReading(
  c: Collection,
  r: AgentReading,
  now: string,
  newId: () => string,
): Collection {
  if (r.tidy) return applyTidy(c, r.tidy, now, r.id);
  const unread = new Set(unreadNotes(c).map(({ batch, note }) => noteKey({ batchId: batch.id, note: note.ref })));
  const notes = new Map<string, NoteRef>();
  for (const key of r.read) {
    if (!unread.has(key)) continue;
    const i = key.indexOf('/');
    notes.set(key, { batchId: key.slice(0, i), note: key.slice(i + 1) });
  }
  if (!notes.size) return c;
  const propose = r.reading.propose.map((p, i) => ({ ...p, id: `${r.id}-${i}` }));
  return applyReading(c, { ...r.reading, propose }, notes, now, newId);
}

/**
 * The collection as the page will have it once it applies the readings still waiting, in order
 * (D146): the notes they read are no longer unread, and the rules they propose are there. The
 * agent reads on from this, so a second batch of notes neither comes back the same nor
 * duplicates the first batch's rules.
 */
export const withReadings = (c: Collection, waiting: readonly AgentReading[]) =>
  waiting.reduce((x, r) => applyAgentReading(x, r, r.at, () => r.id), c);
