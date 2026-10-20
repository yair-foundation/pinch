import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, PROTOCOL_VERSIONS, pickOf, TOOLS, topicsText } from '../agent';
import { type Collection, newCollection, type Rule } from '../learnings';

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
      ['get_design_rules', 'list_rule_topics'],
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
    assert.match(all, /Keep data tables dense\. \(where: in data tables\) \[Layout, Acme\]/);
    assert.match(all, /note 01\.1 on dashboard\.png \(Competitor\): works: "Spacing separates/);
    const copy = textOf(await call('get_design_rules', { topics: ['copy', 'nonsense'] }));
    assert.match(copy, /1 rule\./);
    assert.match(copy, /Lead with a short headline/);
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
