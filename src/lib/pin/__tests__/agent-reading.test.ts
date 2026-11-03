import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, type BatchFiles, topicsText } from '../agent';
import {
  type AgentReading,
  agentReadingOf,
  agentReadingsIn,
  applyAgentReading,
  libraryOf,
  MAX_AGENT_READINGS,
  notesToRead,
  readingInputSchema,
  readingPrompt,
  withAgentReading,
  withReadings,
} from '../agent-reading';
import { MAX_LEARN_NOTES } from '../learn';
import {
  type BatchNote,
  type Collection,
  cleanTidy,
  knownNotes,
  newCollection,
  noteFingerprint,
  type Rule,
  rulesOf,
  rulesText,
  tidyDue,
  unreadNotes,
} from '../learnings';

const note = (ref: string, works: string, doesNotWork = ''): BatchNote => ({
  ref,
  image: `${ref}.png`,
  source: 'ours',
  topics: ['visual'],
  works,
  doesNotWork,
  crop: `crops/${ref}.jpg`,
});

const rule = (id: string, text: string, more: Partial<Rule> = {}): Rule => ({
  id,
  text,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: [{ batchId: 'b1', note: '01.1' }],
  status: 'approved',
  createdAt: '2026-10-24T10:00:00Z',
  ...more,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-24T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-24',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-24/',
        images: 3,
        notes: [
          note('01.1', 'Spacing separates the sections.'),
          note('02.1', 'Light borders keep it calm.'),
          note('03.1', '', 'Four accent colours fight each other.'),
        ],
      },
    ],
    rules: [
      rule('ra', 'Separate sections with spacing.'),
      rule('locked', '', { locked: true }),
    ],
    read: ['b1/01.1'],
  };
}

const at = '2026-10-24T12:00:00Z';
const reading = (args: unknown, c: Collection | null = library()) => {
  const out = agentReadingOf(args, c, at, 'g1');
  if ('error' in out) throw new Error(out.error);
  return out.reading;
};

describe('notes for the agent to read (D122)', () => {
  it('are the unread ones, by the keys they are kept under, against the rules there are', () => {
    const c = library();
    assert.deepEqual(
      notesToRead(c).map((n) => n.key),
      ['b1/02.1', 'b1/03.1'],
    );
    assert.deepEqual(
      libraryOf(c).map((r) => r.id),
      ['ra'],
    );
    const prompt = readingPrompt(c, notesToRead(c));
    assert.match(prompt, /ra \(visual\) Separate sections with spacing\./);
    assert.match(prompt, /"id":"b1\/02\.1".*"whatWorks":"Light borders keep it calm\."/);
    const many = library();
    many.batches[0].notes = Array.from({ length: MAX_LEARN_NOTES + 5 }, (_, i) =>
      note(`${i + 10}.1`, 'x'),
    );
    assert.equal(notesToRead(many).length, MAX_LEARN_NOTES);
  });

  it('are answered in the reading’s own shape, every field but the rule and its notes optional', () => {
    const schema = readingInputSchema() as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    assert.deepEqual(Object.keys(schema.properties), [
      'read',
      'strengthen',
      'propose',
      'turned',
      'tidy',
    ]);
    assert.deepEqual(schema.required ?? [], []);
    assert.equal('$schema' in schema, false);
  });
});

describe('the agent’s reading (D122)', () => {
  it('keeps the notes still unread, the rules there are, and fills what it left out', () => {
    const r = reading({
      read: ['b1/02.1', 'b1/01.1', 'nope'],
      strengthen: [
        { rule: 'ra', notes: ['b1/02.1'] },
        { rule: 'gone', notes: ['b1/02.1'] },
      ],
      propose: [{ rule: 'Keep to one accent colour.', notes: ['b1/03.1'], topics: ['visual'] }],
    });
    assert.deepEqual(r.read, ['b1/02.1', 'b1/03.1']);
    assert.deepEqual(r.reading.strengthen, [{ rule: 'ra', notes: ['b1/02.1'] }]);
    assert.deepEqual(r.reading.propose, [
      {
        rule: 'Keep to one accent colour.',
        context: '',
        topics: ['visual'],
        notes: ['b1/03.1'],
        basis: 'stated',
      },
    ]);
  });

  it('says what is wrong, and keeps nothing', () => {
    assert.match(
      (agentReadingOf({ read: ['b1/01.1'] }, library(), at, 'g1') as { error: string }).error,
      /None of those notes is waiting/,
    );
    assert.match(
      (agentReadingOf({ propose: 'x' }, library(), at, 'g1') as { error: string }).error,
      /^That isn't a reading: /,
    );
  });

  it('joins the rules as Pinch’s own reading does, marking every note it read', () => {
    const c = library();
    const r = reading({
      read: ['b1/02.1', 'b1/03.1'],
      strengthen: [{ rule: 'ra', notes: ['b1/02.1'] }],
      propose: [
        {
          rule: 'Keep to one accent colour.',
          title: 'One accent colour',
          notes: ['b1/03.1'],
          topics: ['visual'],
        },
      ],
    });
    let n = 0;
    const after = applyAgentReading(c, r, at, () => `new${++n}`);
    assert.deepEqual(unreadNotes(after), []);
    assert.deepEqual(
      after.rules.find((x) => x.id === 'ra')?.evidence.map((e) => e.note),
      ['01.1', '02.1'],
    );
    // Named from the reading, not made up, so the server and the page agree on it (D146).
    const made = after.rules.find((x) => x.id === 'g1-0');
    assert.equal(made?.text, 'Keep to one accent colour.');
    assert.equal(made?.title, 'One accent colour');
    assert.deepEqual(applyAgentReading(after, r, at, () => 'again'), after, 'once only');
  });

  it('waits in a list that keeps the newest, tidied when read back', () => {
    const r = reading({ read: ['b1/02.1'] });
    let list: AgentReading[] = [];
    for (let i = 0; i < MAX_AGENT_READINGS + 2; i++) list = withAgentReading(list, { ...r, id: `g${i}` });
    assert.equal(list.length, MAX_AGENT_READINGS);
    assert.equal(list[0].id, 'g2');
    assert.deepEqual(agentReadingsIn({ readings: [r, { id: 1 }, null] }), [r]);
    assert.deepEqual(agentReadingsIn(null), []);
  });
});

describe('reading with the agent over MCP (D122)', () => {
  const call = (name: string, args: unknown, saved: AgentReading[], files?: BatchFiles) =>
    answer(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
      async () => library(),
      files,
      undefined,
      { id: () => 'g1', save: async (r) => void saved.push(r) },
    ) as Promise<{ result: { content: { type: string; text?: string }[]; isError?: boolean } }>;

  it('hands over the method, the notes and their close-ups', async () => {
    const crop = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const r = await call('get_notes_to_read', {}, [], async (_id, paths) => {
      return new Map(paths.filter((p) => p.endsWith('02.1.jpg')).map((p) => [p, crop]));
    });
    const [head, ...rest] = r.result.content;
    assert.match(head.text ?? '', /^You keep a designer's taste library/);
    assert.match(head.text ?? '', /call submit_reading once with every note id you read/);
    assert.match(head.text ?? '', /2 of 2 notes waiting\./);
    assert.deepEqual(
      rest.map((x) => x.type),
      ['text', 'image', 'text'],
    );
    assert.equal(rest[0].text, 'b1/02.1:');
    assert.match(rest[2].text ?? '', /^b1\/03\.1: no close-up; read it from its words\./);
  });

  it('keeps the reading to wait for the page, and says what is left', async () => {
    const saved: AgentReading[] = [];
    const r = await call('submit_reading', { read: ['b1/02.1'] }, saved);
    assert.match(r.result.content[0].text ?? '', /^Kept: 1 note read, 0 new rules, 0 strengthened\./);
    assert.match(r.result.content[0].text ?? '', /1 more note waits: call get_notes_to_read again\./);
    assert.equal(saved.length, 1);
    const bad = await call('submit_reading', { read: [] }, saved);
    assert.equal(bad.result.isError, true);
    assert.equal(saved.length, 1);
  });

  it('is pointed to when notes wait', () => {
    assert.match(topicsText(library()), /2 notes wait to be read into rules: call get_notes_to_read/);
  });
});

describe('reading on from the readings waiting (D146)', () => {
  // 33 notes, none read: more than one reading takes.
  const many = (): Collection => {
    const c = library();
    const notes = Array.from({ length: 33 }, (_, i) =>
      note(`${String(i + 1).padStart(2, '0')}.1`, `Note ${i + 1} works.`),
    );
    return { ...c, batches: [{ ...c.batches[0], notes, images: 33 }], read: [] };
  };
  const keys = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `b1/${String(from + i).padStart(2, '0')}.1`);
  type Reply = { result: { content: { type: string; text?: string }[]; isError?: boolean } };
  const session = () => {
    const saved: AgentReading[] = [];
    const call = (name: string, args: unknown = {}) =>
      answer(
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
        async () => many(),
        undefined,
        undefined,
        {
          id: () => `g${saved.length + 1}`,
          save: async (r) => void saved.push(r),
          waiting: async () => saved,
        },
      ) as Promise<Reply>;
    return { saved, call };
  };
  const words = (r: Reply) => r.result.content[0].text ?? '';

  it('hands over the next notes, not the same ones, while the page hasn’t applied the last reading', async () => {
    const { saved, call } = session();
    assert.match(words(await call('get_notes_to_read')), /30 of 33 notes waiting\./);
    const first = await call('submit_reading', {
      read: keys(1, 30),
      propose: [{ rule: 'Keep it calm.', notes: ['b1/01.1'], topics: ['visual'] }],
    });
    assert.match(words(first), /3 more notes wait: call get_notes_to_read again\./);
    assert.match(words(await call('list_rule_topics')), /3 notes wait to be read into rules/);

    const next = words(await call('get_notes_to_read'));
    assert.match(next, /3 of 3 notes waiting\./);
    assert.match(next, /b1\/31\.1/);
    assert.doesNotMatch(next, /b1\/01\.1/);
    assert.match(next, /g1-0/, 'the rule the waiting reading proposed is in the library');

    // The second reading strengthens the first one's rule, which isn't on the page yet.
    const second = await call('submit_reading', {
      read: keys(31, 33),
      strengthen: [{ rule: 'g1-0', notes: ['b1/31.1'] }],
    });
    assert.match(words(second), /^Kept: 3 notes read, 0 new rules, 1 strengthened\./);
    assert.doesNotMatch(words(second), /more notes? waits?/);
    // Every note read, the rules are tidied once (D149), and then there's nothing to do.
    assert.match(words(second), /Every note is read: call get_notes_to_read once more to tidy/);
    assert.match(words(await call('get_notes_to_read')), /^Every note is read\. Tidy the rules once/);
    assert.match(words(await call('submit_reading', { tidy: {} })), /^Kept your tidy: 0 rules folded/);
    assert.equal(words(await call('get_notes_to_read')), 'No notes are waiting to be read.');
    assert.doesNotMatch(words(await call('list_rule_topics')), /wait to be read/);

    // The same notes again are refused, so no rule is read twice.
    const again = await call('submit_reading', { read: keys(1, 30) });
    assert.equal(again.result.isError, true);
    assert.equal(saved.length, 3);

    // The page applies both, in order, with ids of its own to hand: the rule is the same one.
    let n = 0;
    const page = saved.reduce((c, r) => applyAgentReading(c, r, at, () => `page${++n}`), many());
    assert.deepEqual(unreadNotes(page), []);
    const calm = page.rules.find((r) => r.id === 'g1-0');
    assert.deepEqual(
      calm?.evidence.map((e) => e.note),
      ['01.1', '31.1'],
    );
    const shape = (c: Collection) => c.rules.map((r) => [r.id, r.evidence.map((e) => e.note)]);
    assert.deepEqual(shape(withReadings(many(), saved)), shape(page), 'what the agent read on from');
  });
});

describe('a note said aloud, turned by the reading (D147)', () => {
  // Said aloud and filed by its words under what works, though it is a fault.
  const said = (): Collection => {
    const c = library();
    const [first, second, third] = c.batches[0].notes;
    const wrong = {
      ...second,
      works: "'Let's go' tells me nothing.",
      doesNotWork: '',
      best: true as const,
      said: true as const,
    };
    return { ...c, batches: [{ ...c.batches[0], notes: [first, wrong, third] }] };
  };

  it('is marked for the reading, which is told to judge it by its words', () => {
    assert.match(readingPrompt(said(), notesToRead(said())), /"saidAloud":true/);
  });

  it('turns only a note said aloud, and only one it read', () => {
    const r = reading(
      { read: ['b1/02.1', 'b1/03.1'], turned: ['b1/02.1', 'b1/03.1', 'b1/09.9'] },
      said(),
    );
    assert.deepEqual(r.reading.turned, ['b1/02.1', 'b1/03.1']);
    const after = applyAgentReading(said(), r, at, () => 'x');
    const [, turned, typed] = after.batches[0].notes;
    assert.equal(turned.works, '');
    assert.equal(turned.doesNotWork, "'Let's go' tells me nothing.");
    assert.equal(turned.best, undefined, 'a fault is no best example');
    assert.equal(
      typed.doesNotWork,
      'Four accent colours fight each other.',
      'typed notes stay as written',
    );
    // The open image still has it the old way round, and it is still known, so never added again.
    assert.ok(
      knownNotes(after).has(noteFingerprint(turned.image, "'Let's go' tells me nothing.", '')),
    );
  });
});

describe('notes handed to the agent, as many as fit (D147)', () => {
  // A close-up's JPEG header, as big as the reading's close-ups get.
  const jpeg = (w: number, h: number) =>
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0]);
  const many = (): Collection => {
    const c = library();
    const notes = Array.from({ length: 20 }, (_, i) =>
      note(`${String(i + 1).padStart(2, '0')}.1`, `Note ${i + 1} works.`),
    );
    return { ...c, batches: [{ ...c.batches[0], notes }], read: [] };
  };
  const call = (args: unknown) =>
    answer(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_notes_to_read', arguments: args } },
      async () => many(),
      async (_id, paths) => new Map(paths.map((p) => [p, jpeg(1200, 1200)])),
    ) as Promise<{ result: { content: { type: string; text?: string }[] } }>;

  it('sends only the notes whose close-ups fit, and says how many wait', async () => {
    const r = await call({});
    const images = r.result.content.filter((x) => x.type === 'image').length;
    assert.ok(images >= 1 && images < 20, `${images} close-ups`);
    assert.match(r.result.content[0].text ?? '', new RegExp(`^You keep a designer's taste library[\\s\\S]*${images} of 20 notes waiting\\.`));
    assert.doesNotMatch(JSON.stringify(r.result.content), /left out to keep this answer small/);
  });

  it('leaves out the method when the agent has it, so more fit', async () => {
    const first = (await call({})).result.content.filter((x) => x.type === 'image').length;
    const next = await call({ method: false });
    assert.match(next.result.content[0].text ?? '', /^Read these notes by the method an earlier get_notes_to_read gave you/);
    assert.ok(next.result.content.filter((x) => x.type === 'image').length > first);
  });
});

describe('what the close-ups show, and the rules tidied (D149)', () => {
  /** A rule in Pinch's words, on these notes. */
  const ai = (id: string, text: string, notes: string[], more: Partial<Rule> = {}) =>
    rule(id, text, {
      drafted: text,
      evidence: notes.map((n) => ({ batchId: 'b1', note: n })),
      ...more,
    });
  // Every note read: a rule from three notes, one from one note saying the same, one from one
  // note going against it, one in the author's words, one pulling against the second, and one
  // waiting on a question.
  const read = (): Collection => {
    const c = library();
    const notes = ['01', '02', '03', '04', '05', '06'].map((n) => note(`${n}.1`, `Note ${n}.`));
    return {
      ...c,
      batches: [{ ...c.batches[0], notes, images: 6 }],
      read: notes.map((n) => `b1/${n.ref}`),
      rules: [
        ai('a', 'Make the key figure the largest thing on its card.', ['01.1', '02.1', '03.1'], {
          shows: 'A light sans figure, three times its label.',
        }),
        ai('b', 'Set the big number thin.', ['04.1']),
        ai('c', 'Set figures in a heavy slab serif.', ['05.1']),
        rule('d', 'Keep labels small.', {
          drafted: 'Keep labels tiny.',
          evidence: [{ batchId: 'b1', note: '06.1' }],
        }),
        ai('e', 'Use hairline rules.', ['02.1'], {
          conflict: { ruleId: 'b', why: 'Both about weight.' },
        }),
        ai('f', 'Keep it dense.', ['03.1'], { question: { ask: 'How dense?', options: [] } }),
      ],
    };
  };
  const tidy = {
    fold: [
      {
        into: 'a',
        rules: ['b'],
        rule: 'Make the key figure the largest thing on its card, thin.',
        shows: 'A thin sans figure.',
      },
    ],
    drop: [{ rule: 'c', why: 'Goes against a.' }],
  };

  it('are kept with each rule and sent with the library, never to a builder', () => {
    const r = reading({
      read: ['b1/02.1'],
      propose: [
        {
          rule: 'Keep borders light.',
          notes: ['b1/02.1'],
          topics: ['visual'],
          shows: '  Grey   hairlines. ',
        },
      ],
    });
    assert.equal(r.reading.propose[0].shows, 'Grey hairlines.');
    const c = applyAgentReading(library(), r, at, () => 'x');
    const made = c.rules.find((x) => x.id === 'g1-0');
    assert.equal(made?.shows, 'Grey hairlines.');
    assert.equal(libraryOf(c).find((x) => x.id === 'g1-0')?.shows, 'Grey hairlines.');
    assert.match(readingPrompt(c, notesToRead(c)), /Keep borders light\. \| shows: Grey hairlines\./);
    // Builders never get it: they copy what the author didn't judge.
    assert.doesNotMatch(rulesText(c, rulesOf(c)), /Grey hairlines/);
  });

  it('are tidied once every note is read, and only then', () => {
    assert.equal(tidyDue(read()), true);
    assert.equal(tidyDue(library()), false, 'notes still wait');
    const early = agentReadingOf({ tidy }, library(), at, 't1');
    assert.match('error' in early ? early.error : '', /Notes still wait to be read/);
    const done = applyAgentReading(read(), reading({ tidy }, read()), at, () => 'x');
    assert.equal(done.tidiedAt, at);
    assert.equal(tidyDue(done), false);
  });

  it('folds and drops only what Pinch wrote, and a drop only from one note', () => {
    const kept = cleanTidy(
      {
        fold: [
          { into: 'a', rules: ['b', 'd', 'f', 'nope'], rule: 'Reworded.' },
          { into: 'd', rules: ['c'], rule: 'Not the author’s.' },
        ],
        drop: ['a', 'd', 'c', 'e'].map((id) => ({ rule: id, why: 'x' })),
      },
      read(),
    );
    assert.deepEqual(kept.fold, [
      { into: 'a', rules: ['b'], rule: 'Reworded.' },
      { into: 'd', rules: ['c'] },
    ]);
    assert.deepEqual(kept.drop, [{ rule: 'e', why: 'x' }]);
  });

  it('joins the rules: the notes go with the fold, a conflict follows it, the dropped rule goes', () => {
    const c = applyAgentReading(read(), reading({ tidy }, read()), at, () => 'x');
    assert.deepEqual(
      c.rules.map((r) => r.id),
      ['a', 'd', 'e', 'f'],
    );
    const a = c.rules[0];
    assert.equal(a.text, 'Make the key figure the largest thing on its card, thin.');
    assert.equal(a.drafted, a.text, 'still in Pinch’s words');
    assert.equal(a.shows, 'A thin sans figure.');
    assert.deepEqual(
      a.evidence.map((e) => e.note),
      ['01.1', '02.1', '03.1', '04.1'],
    );
    assert.equal(c.rules[2].conflict?.ruleId, 'a');
    assert.deepEqual(c.read, read().read, 'the dropped rule’s note stays read');
  });

  it('is asked of the agent over MCP, with every rule in force and its notes’ words', async () => {
    const saved: AgentReading[] = [];
    const call = (name: string, args: unknown = {}) =>
      answer(
        { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
        async () => read(),
        undefined,
        undefined,
        { id: () => 't1', save: async (r) => void saved.push(r), waiting: async () => saved },
      ) as Promise<{ result: { content: { text?: string }[] } }>;
    const asked = (await call('get_notes_to_read')).result.content[0].text ?? '';
    assert.match(
      asked,
      /^a \(3 notes\) \(visual\) Make the key figure.*\| shows: A light sans figure/m,
    );
    assert.match(asked, /^d \(1 note\) \[author's words\]/m);
    assert.match(asked, /^ {3}- works: "Note 05\."$/m);
    assert.doesNotMatch(asked, /^f /m, 'a rule waiting on its question isn’t tidied');
    const kept = (await call('submit_reading', { tidy })).result.content[0].text ?? '';
    assert.match(kept, /^Kept your tidy: 1 rule folded into others, 1 dropped\./);
    assert.equal(
      (await call('get_notes_to_read')).result.content[0].text,
      'No notes are waiting to be read.',
    );
  });
});
