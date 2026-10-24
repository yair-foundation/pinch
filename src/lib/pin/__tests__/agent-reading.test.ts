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
} from '../agent-reading';
import { MAX_LEARN_NOTES } from '../learn';
import { type BatchNote, type Collection, newCollection, type Rule, unreadNotes } from '../learnings';

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
    assert.deepEqual(Object.keys(schema.properties), ['read', 'strengthen', 'propose']);
    assert.deepEqual(schema.required, ['read']);
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
    const made = after.rules.find((x) => x.id === 'new1');
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
