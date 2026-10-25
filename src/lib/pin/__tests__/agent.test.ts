import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  answer,
  type BatchFiles,
  boxInCrop,
  MAX_EVIDENCE,
  MAX_EVIDENCE_BYTES,
  markedOf,
  numberedRules,
  PROTOCOL_VERSIONS,
  pickOf,
  placeOf,
  type TOOLS,
  topicsText,
} from '../agent';
import { type Collection, newCollection, type Rule, rulesOf } from '../learnings';
import type { RunEvent } from '../runs';
import { withBrief } from '../screen-index';

const rule = (id: string, text: string, extra: Partial<Rule> = {}): Rule => ({
  id,
  text,
  context: '',
  topics: [],
  tags: [],
  evidence: [{ batchId: 'b1', note: '01.1' }],
  status: 'approved',
  createdAt: '2026-10-20T10:00:00Z',
  ...extra,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-20T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-20',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-20/',
        images: 1,
        notes: [
          {
            ref: '01.1',
            image: 'dashboard.png',
            source: 'competitor',
            topics: ['layout'],
            works: 'Spacing separates the sections.',
            doesNotWork: '',
            crop: 'crops/01-dashboard-note-1.jpg',
          },
        ],
      },
    ],
    rules: [
      rule('a', 'Separate content with spacing; use borders sparingly.', {
        topics: ['visual', 'layout'],
      }),
      rule('b', 'Keep data tables dense.', {
        topics: ['layout'],
        context: 'in data tables',
        tags: ['Acme'],
      }),
      rule('c', 'Lead with a short headline.', { topics: ['copy'] }),
      rule('d', 'A rule they dismissed.', { topics: ['copy'], status: 'dismissed' }),
      rule('e', '', { topics: ['flow'], locked: true }),
      rule('g', 'Keep screens quiet.', { topics: ['visual'], basis: 'interpreted' }),
      rule('f', 'Keep headings short.', {
        topics: ['copy'],
        basis: 'interpreted',
        question: {
          ask: 'What do you like about this heading?',
          options: [
            { answer: 'Its wording', rule: 'Keep headings short.' },
            { answer: 'Its size', rule: 'Make headings large.' },
          ],
        },
      }),
    ],
  };
}

const call = (name: string, args: unknown = {}) =>
  answer(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
    async () => library(),
  );
const textOf = (r: unknown) =>
  ((r as { result: { content: { text: string }[] } }).result.content[0]?.text ?? '') as string;

describe('Pinch for agents (MCP)', () => {
  it('starts a session in the version the agent asks for, when it knows it', async () => {
    const r = (await answer(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      async () => null,
    )) as {
      result: { protocolVersion: string; capabilities: object; serverInfo: { name: string } };
    };
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
    assert.equal(r.result.serverInfo.name, 'pinch');
    const later = (await answer(
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      async () => null,
    )) as { result: { protocolVersion: string } };
    assert.equal(later.result.protocolVersion, PROTOCOL_VERSIONS[0]);
  });

  it('answers requests, not notifications, and names what it can’t do', async () => {
    assert.equal(
      await answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, async () => null),
      null,
    );
    assert.deepEqual(await answer({ jsonrpc: '2.0', id: 3, method: 'ping' }, async () => null), {
      jsonrpc: '2.0',
      id: 3,
      result: {},
    });
    const tools = (await answer(
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      async () => null,
    )) as { result: { tools: typeof TOOLS } };
    assert.deepEqual(
      tools.result.tools.map((t) => t.name),
      [
        'get_design_rules',
        'get_rule_evidence',
        'get_render_checks',
        'propose_rule',
        'report_work',
        'get_notes_to_read',
        'submit_reading',
        'list_rule_topics',
      ],
    );
    assert.equal(
      (
        (await answer({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, async () => null)) as {
          error: { code: number };
        }
      ).error.code,
      -32601,
    );
    assert.equal(
      ((await answer({ id: 6, method: 'ping' }, async () => null)) as { error: { code: number } })
        .error.code,
      -32600,
    );
    assert.equal(((await call('nope')) as { error: { code: number } }).error.code, -32602);
  });

  it('hands over the rules a task needs, with their general ones, never a hidden one', async () => {
    const all = textOf(await call('get_design_rules'));
    assert.match(all, /^Design rules from My rules \(Pinch\), 3 rules\./);
    assert.doesNotMatch(all, /dismissed/);
    assert.doesNotMatch(all, /Keep headings short/, 'a rule waiting on its question stays back');
    assert.doesNotMatch(all, /Keep screens quiet/, 'so does a reading not yet confirmed');
    assert.match(all, /Keep data tables dense\. \(where: in data tables\) \[Layout, Acme\]/);
    assert.match(all, /note 01\.1 on dashboard\.png \(Competitor\): works: "Spacing separates/);
    const copy = textOf(await call('get_design_rules', { topics: ['copy', 'nonsense'] }));
    assert.match(copy, /1 rule\./);
    assert.match(copy, /R3\. Lead with a short headline/, 'a rule keeps its number in any pick');
    assert.match(copy, /call get_rule_evidence with its number/);
    const acme = textOf(await call('get_design_rules', { tags: ['Acme'] }));
    assert.match(acme, /3 rules\./, 'a tag brings its rules along with the untagged ones');
    const none = textOf(await call('get_design_rules', { topics: ['accessibility'] }));
    assert.match(none, /^No rules about that/);
    const empty = await answer(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'get_design_rules', arguments: {} },
      },
      async () => null,
    );
    assert.match(textOf(empty), /^No rules yet/);
  });

  it('counts what the rules are about', async () => {
    const t = textOf(await call('list_rule_topics'));
    assert.match(t, /^3 rules\./);
    assert.match(t, /- layout: 2/);
    assert.match(t, /- copy: 1/);
    assert.match(t, /Their own tags:\n- Acme: 1/);
    assert.equal(topicsText(null), 'No rules yet.');
  });

  it('reads a call’s pick: known topics only, tags with the general rules', () => {
    assert.deepEqual(pickOf({ topics: ['copy', 'nope'], tags: ['Acme', ''] }), {
      topics: ['copy', null],
      tags: ['Acme', null],
    });
    assert.deepEqual(pickOf(undefined), {});
  });
});

/** A JPEG's headers only, enough to tell its size. */
const jpegHead = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);

/** The batch's zip as the page keeps it: notes.json with the note's shape and crop, and the crop. */
const manifest = {
  assets: [
    {
      number: '01',
      width: 2000,
      height: 1000,
      notes: [
        {
          number: 1,
          shape: { kind: 'area', x: 0.25, y: 0.2, w: 0.1, h: 0.05 },
          cropPixels: { x: 400, y: 100, w: 600, h: 300 },
        },
      ],
    },
  ],
};
const asked: string[][] = [];
const files: BatchFiles = async (batchId, paths) => {
  asked.push([batchId, ...paths]);
  return new Map([
    ['pinch-2026-10-20/notes.json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['pinch-2026-10-20/crops/01-dashboard-note-1.jpg', jpegHead(1200, 600)],
  ]);
};
const evidence = (rule: unknown, f: BatchFiles | null = files) =>
  answer(
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'get_rule_evidence', arguments: { rule } },
    },
    async () => library(),
    f ?? undefined,
  ) as Promise<{
    result: {
      content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      )[];
      isError?: boolean;
    };
  }>;

describe('a rule’s close-ups over MCP (D94)', () => {
  it('sends the close-up as an image, with the box in its pixels and in the screenshot’s', async () => {
    asked.length = 0;
    const r = (await evidence('R1')).result;
    assert.equal(r.isError, undefined);
    const [head, note, image] = r.content;
    assert.equal(head.type, 'text');
    assert.match((head as { text: string }).text, /^R1\. Separate content with spacing/);
    assert.match((head as { text: string }).text, /top-left corner/);
    const lines = (note as { text: string }).text.split('\n');
    assert.match(
      lines[0],
      /^Note 01\.1 on dashboard\.png \(Competitor\): works: "Spacing separates/,
    );
    assert.deepEqual(JSON.parse(lines[1]), {
      shape: 'area',
      screenshot: {
        width: 2000,
        height: 1000,
        box: { x: 500, y: 200, w: 200, h: 50 },
        fraction: { x: 0.25, y: 0.2, w: 0.1, h: 0.05 },
      },
      closeUp: {
        width: 1200,
        height: 600,
        box: { x: 200, y: 200, w: 400, h: 100 },
        showsScreenshotPixels: { x: 400, y: 100, w: 600, h: 300 },
      },
    });
    assert.equal(image.type, 'image');
    assert.equal((image as { mimeType: string }).mimeType, 'image/jpeg');
    assert.deepEqual(
      new Uint8Array(Buffer.from((image as { data: string }).data, 'base64')),
      jpegHead(1200, 600),
    );
    assert.deepEqual(asked, [
      ['b1', 'pinch-2026-10-20/notes.json', 'pinch-2026-10-20/crops/01-dashboard-note-1.jpg'],
    ]);
  });

  it('takes the number however it is written, and says when there is no such rule', async () => {
    for (const n of ['r1', '1', ' R1 '])
      assert.match(((await evidence(n)).result.content[0] as { text: string }).text, /^R1\./);
    const none = (await evidence('R40')).result;
    assert.equal(none.isError, true);
    assert.match(
      (none.content[0] as { text: string }).text,
      /No rule R40\. Rules are numbered R1 to R3/,
    );
    assert.equal((await evidence(undefined)).result.isError, true);
  });

  it('still says where the spot is when the close-up is missing', async () => {
    const r = (
      await evidence(
        'R1',
        async () =>
          new Map([
            ['pinch-2026-10-20/notes.json', new TextEncoder().encode(JSON.stringify(manifest))],
          ]),
      )
    ).result;
    assert.equal(r.content.filter((c) => c.type === 'image').length, 0);
    const where = JSON.parse((r.content[1] as { text: string }).text.split('\n')[1]);
    assert.deepEqual(where.screenshot.box, { x: 500, y: 200, w: 200, h: 50 });
    assert.equal(where.closeUp, undefined);
    assert.equal((r.content[2] as { text: string }).text, 'No close-up for this note.');
    assert.equal((await evidence('R1', null)).result.isError, true);
    const huge = new Uint8Array(MAX_EVIDENCE_BYTES + 1);
    huge.set(jpegHead(1200, 600));
    const over = (
      await evidence(
        'R1',
        async () =>
          new Map([
            ['pinch-2026-10-20/notes.json', new TextEncoder().encode(JSON.stringify(manifest))],
            ['pinch-2026-10-20/crops/01-dashboard-note-1.jpg', huge],
          ]),
      )
    ).result;
    assert.equal(over.content.filter((c) => c.type === 'image').length, 0);
    assert.equal(
      (over.content[2] as { text: string }).text,
      'Close-up left out to keep this answer small.',
    );
  });

  it('reads a note’s place, and moves a box of each shape into the crop', () => {
    assert.equal(placeOf(manifest, '01.2'), null);
    assert.equal(
      placeOf(
        {
          assets: [
            {
              number: '01',
              width: 10,
              height: 10,
              notes: [{ number: 1, shape: { kind: 'dot', x: 2, y: 0 } }],
            },
          ],
        },
        '01.1',
      ),
      null,
      'fractions only',
    );
    assert.deepEqual(placeOf(manifest, '01.1')?.crop, { x: 400, y: 100, w: 600, h: 300 });
    const crop = { x: 100, y: 50, w: 400, h: 200 };
    const size = { width: 800, height: 400 };
    assert.deepEqual(boxInCrop({ x: 300, y: 150 }, crop, size), { x: 400, y: 200 });
    assert.deepEqual(boxInCrop({ x: 100, y: 50, x2: 500, y2: 250 }, crop, size), {
      x: 0,
      y: 0,
      x2: 800,
      y2: 400,
    });
    assert.ok(MAX_EVIDENCE >= 4);
    // Eight crops at their budget's share and base64 stay under a function's 4.5 MB answer.
    assert.ok((MAX_EVIDENCE_BYTES * 4) / 3 < 4_500_000);
  });
});

/** The same batch, its notes.json naming the screenshot's marked copy, which the zip holds too. */
const withMarked = {
  assets: [{ ...manifest.assets[0], marked: 'marked/01-dashboard.jpg' }],
};
const markedFiles =
  (marked: Uint8Array | null): BatchFiles =>
  async (batchId, paths) => {
    asked.push([batchId, ...paths]);
    const all = new Map([
      ['pinch-2026-10-20/notes.json', new TextEncoder().encode(JSON.stringify(withMarked))],
      ['pinch-2026-10-20/crops/01-dashboard-note-1.jpg', jpegHead(1200, 600)],
      ...(marked ? ([['pinch-2026-10-20/marked/01-dashboard.jpg', marked]] as const) : []),
    ]);
    return new Map(paths.flatMap((p) => (all.has(p) ? [[p, all.get(p) as Uint8Array]] : [])));
  };
const wholeEvidence = (whole: unknown, f: BatchFiles) =>
  answer(
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'get_rule_evidence', arguments: { rule: 'R1', whole } },
    },
    async () => library(),
    f,
  ) as ReturnType<typeof evidence>;

describe('a rule’s whole screenshots over MCP (D99)', () => {
  it('adds each screenshot once, marked, with its scale, only when asked', async () => {
    asked.length = 0;
    const r = (await wholeEvidence(true, markedFiles(jpegHead(1800, 900)))).result;
    assert.equal(r.content.filter((c) => c.type === 'image').length, 2);
    const [label, image] = r.content.slice(-2);
    assert.equal(
      (label as { text: string }).text,
      'Screenshot dashboard.png, with note 01.1: the whole screen with every marker drawn in, 1800×900 pixels, the screenshot scaled by 0.9 (multiply a note’s screenshot box by it).',
    );
    assert.deepEqual(
      new Uint8Array(Buffer.from((image as { data: string }).data, 'base64')),
      jpegHead(1800, 900),
    );
    assert.deepEqual(asked, [
      ['b1', 'pinch-2026-10-20/notes.json', 'pinch-2026-10-20/crops/01-dashboard-note-1.jpg'],
      ['b1', 'pinch-2026-10-20/marked/01-dashboard.jpg'],
    ]);

    for (const whole of [undefined, false, 'true']) {
      asked.length = 0;
      const plain = (await wholeEvidence(whole, markedFiles(jpegHead(1800, 900)))).result;
      assert.equal(plain.content.filter((c) => c.type === 'image').length, 1, String(whole));
      assert.equal(asked.length, 1, 'no second read');
    }
  });

  it('says when the screenshot is missing or too large, and keeps the close-ups', async () => {
    const missing = (await wholeEvidence(true, markedFiles(null))).result;
    assert.equal(missing.content.filter((c) => c.type === 'image').length, 1);
    assert.equal(
      (missing.content.at(-1) as { text: string }).text,
      'Screenshot dashboard.png, with note 01.1: no screenshot kept.',
    );
    const huge = new Uint8Array(MAX_EVIDENCE_BYTES);
    huge.set(jpegHead(1800, 900));
    const over = (await wholeEvidence(true, markedFiles(huge))).result;
    assert.equal(over.content.filter((c) => c.type === 'image').length, 1, 'the close-up stays');
    assert.equal(
      (over.content.at(-1) as { text: string }).text,
      'Screenshot dashboard.png, with note 01.1: left out to keep this answer small.',
    );
    const older = (await wholeEvidence(true, files)).result;
    assert.match((older.content.at(-1) as { text: string }).text, /no screenshot kept\.$/);
  });

  it('reads a screenshot’s marked copy from notes.json', () => {
    assert.deepEqual(markedOf(withMarked, '01'), {
      path: 'marked/01-dashboard.jpg',
      width: 2000,
      height: 1000,
    });
    assert.equal(markedOf(withMarked, '02'), null);
    assert.equal(markedOf(manifest, '01'), null, 'an export without it');
    assert.equal(markedOf(null, '01'), null);
  });
});

describe('a rule the agent proposes (D116)', () => {
  const propose = (args: unknown, saved: unknown[], store = true) =>
    answer(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'propose_rule', arguments: args },
      },
      async () => library(),
      undefined,
      store ? { id: () => 'p1', save: async (p) => void saved.push(p) } : undefined,
    );

  it('waits for the person, a change kept by its rule’s lasting key', async () => {
    const saved: { rule?: string; was?: string; text: string }[] = [];
    const r = await propose(
      { rule: 'R2', text: 'Separate sections with space only.', why: 'They said so today.' },
      saved,
    );
    assert.match(textOf(r), /^Proposed a change to R2\. It waits on Your rules in Pinch/);
    assert.equal(saved.length, 1);
    const r2 = rulesOf(library())[1].rule;
    assert.equal(saved[0].rule, r2.id);
    assert.equal(saved[0].was, r2.text);
    const fresh = await propose({ text: 'AI boxes are white.', why: 'Agreed.' }, saved);
    assert.match(textOf(fresh), /it isn’t one of their rules until they keep it/);
  });

  it('says what is wrong, and stores nothing', async () => {
    const saved: unknown[] = [];
    const r = (await propose({ text: 'x', why: 'y', rule: 'R40' }, saved)) as {
      result: { isError?: boolean };
    };
    assert.equal(r.result.isError, true);
    assert.match(textOf(r), /No rule R40/);
    assert.equal(saved.length, 0);
    const off = (await propose({ text: 'x', why: 'y' }, saved, false)) as {
      result: { isError?: boolean };
    };
    assert.equal(off.result.isError, true);
  });
});

describe('a run of the agent, recorded (D120)', () => {
  const call = (name: string, args: unknown, events: RunEvent[], log = true) =>
    answer(
      { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name, arguments: args } },
      async () => library(),
      async () => new Map(),
      { id: () => 'p1', save: async () => undefined },
      log ? { id: () => 'w1', add: (e) => void events.push(e) } : undefined,
    );

  it('writes down what each call asked for and got, by the rules’ lasting keys', async () => {
    const events: RunEvent[] = [];
    await call('get_design_rules', { topics: ['copy'], tags: ['Acme'] }, events);
    await call('get_rule_evidence', { rule: 'R1' }, events);
    await call('get_rule_evidence', { rule: 'R40' }, events);
    await call('get_render_checks', {}, events);
    await call('propose_rule', { text: 'AI boxes are white.', why: 'Agreed.' }, events);
    await call('list_rule_topics', {}, events);
    const served = numberedRules(library(), pickOf({ topics: ['copy'], tags: ['Acme'] }));
    assert.deepEqual(events, [
      {
        kind: 'rules',
        topics: ['copy'],
        tags: ['Acme'],
        screen: [],
        rules: served.map((r) => r.rule.id),
      },
      { kind: 'evidence', rule: rulesOf(library())[0].rule.id },
      { kind: 'checks' },
      { kind: 'proposal', id: 'p1' },
    ]);
  });

  it('takes the agent’s report of a piece of work, rules by number, and says what wasn’t a rule', async () => {
    const events: RunEvent[] = [];
    const [r1, r2] = rulesOf(library());
    const r = await call(
      'report_work',
      {
        work: 'Inbox, fragment',
        followed: ['R1', 'r2', 'R99'],
        setAside: [{ rule: 'R2', why: 'The author asked for a dense list here.' }],
        checksRun: 6,
        failedChecks: [{ check: 'contrast', rules: ['R1'] }],
        openCalls: ['Lavender or white ground: lavender keeps R138.'],
      },
      events,
    );
    assert.match(textOf(r), /^Reported\. .*Left out, not rules: R99\./);
    assert.deepEqual(events, [
      {
        kind: 'report',
        report: {
          id: 'w1',
          at: (events[0] as { report: { at: string } }).report.at,
          work: 'Inbox, fragment',
          followed: [r1.rule.id, r2.rule.id],
          setAside: [{ rule: r2.rule.id, why: 'The author asked for a dense list here.' }],
          failed: [{ check: 'contrast', rules: [r1.rule.id] }],
          checksRun: 6,
          open: ['Lavender or white ground: lavender keeps R138.'],
        },
      },
    ]);
  });

  it('asks for what was made, and isn’t there without a record', async () => {
    const events: RunEvent[] = [];
    const none = (await call('report_work', { followed: ['R1'] }, events)) as {
      result: { isError?: boolean };
    };
    assert.equal(none.result.isError, true);
    const off = (await call('report_work', { work: 'x' }, events, false)) as {
      result: { isError?: boolean };
    };
    assert.equal(off.result.isError, true);
    assert.equal(events.length, 0);
  });
});

describe('the author’s brief for a product, over MCP (D121)', () => {
  const ask = (name: string, args: unknown, c: Collection) =>
    answer(
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name, arguments: args } },
      async () => c,
    );
  const briefed = (): Collection => {
    const c = library();
    c.batches[0].notes[0] = { ...c.batches[0].notes[0], screenTag: 'Agent Hub' };
    return withBrief(c, 'Agent Hub', 'A calm control room for AI agents.', 'n');
  };

  it('comes with the rules, and alone for a product with no rules about the topic', async () => {
    assert.match(
      textOf(await ask('get_design_rules', { screenTags: ['agent hub'] }, briefed())),
      /- “Agent Hub”: A calm control room for AI agents\./,
    );
    const none = textOf(
      await ask('get_design_rules', { topics: ['flow'], screenTags: ['Agent Hub'] }, briefed()),
    );
    assert.match(none, /^No rules about that\./);
    assert.match(none, /“Agent Hub”: A calm control room/);
  });

  it('is named in the topics list', async () => {
    const c = briefed();
    c.rules[0] = { ...c.rules[0], evidence: [{ batchId: 'b1', note: '01.1' }] };
    assert.match(textOf(await ask('list_rule_topics', {}, c)), /- Agent Hub: \d+ rules?, \d+ checked, [^,]+, a brief/);
  });
});
