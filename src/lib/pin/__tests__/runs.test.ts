import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Collection, newCollection, type Rule, rulesOf } from '../learnings';
import {
  agentName,
  MAX_RUNS,
  MIN_RUNS,
  neverServed,
  pilotRow,
  type Report,
  type RunsDoc,
  reportOf,
  ruleSignals,
  rulesToLookAt,
  runsDocIn,
  withEvents,
  withoutRun,
  withStart,
  withVerdict,
} from '../runs';

const rule = (id: string, text: string): Rule => ({
  id,
  text,
  context: '',
  topics: ['visual'],
  tags: [],
  evidence: [{ batchId: 'b1', note: '01.1' }],
  status: 'approved',
  createdAt: `2026-10-21T10:00:0${id.length}Z`,
});

function library(): Collection {
  return {
    ...newCollection('My rules', 'c1', '2026-10-21T10:00:00Z'),
    rules: [
      rule('a', 'Avoid gradients on AI chat bubbles.'),
      rule('bb', 'Leave a gap between connectors.'),
      rule('ccc', 'Keep screens quiet.'),
    ],
  };
}

const empty = (): RunsDoc => ({ runs: [], agents: [] });
const at = (m: number) => `2026-10-24T10:${String(m).padStart(2, '0')}:00Z`;
const piece = (more: Partial<Report> = {}): Report => ({
  id: 'w1',
  at: at(0),
  work: 'Inbox',
  followed: [],
  setAside: [],
  failed: [],
  open: [],
  ...more,
});

describe('a run of the agent (D120)', () => {
  it('starts with its first call, with the name its agent gave when connecting', () => {
    const connected = withStart(empty(), 's1', 'claude-code', at(0));
    assert.deepEqual(connected.runs, [], 'connecting alone makes no run');
    const doc = withEvents(
      connected,
      's1',
      [
        { kind: 'rules', topics: ['visual'], tags: [], screen: [], rules: ['a', 'bb'] },
        { kind: 'rules', topics: ['copy'], tags: ['Acme'], screen: [], rules: ['bb', 'ccc'] },
        { kind: 'evidence', rule: 'a' },
        { kind: 'checks' },
        { kind: 'proposal', id: 'p1' },
      ],
      at(1),
    );
    assert.deepEqual(doc.agents, []);
    const [r] = doc.runs;
    assert.equal(r.agent, 'claude-code');
    assert.deepEqual(r.served, ['a', 'bb', 'ccc']);
    assert.deepEqual(
      r.asks.map((a) => a.served),
      [2, 2],
    );
    assert.deepEqual(r.evidence, ['a']);
    assert.equal(r.checks, true);
    assert.deepEqual(r.proposals, ['p1']);
    const later = withEvents(doc, 's1', [{ kind: 'report', report: piece() }], at(5));
    assert.equal(later.runs.length, 1);
    assert.equal(later.runs[0].started, at(1));
    assert.equal(later.runs[0].updated, at(5));
    assert.equal(later.runs[0].reports.length, 1);
  });

  it('keeps the newest runs', () => {
    let doc = empty();
    for (let i = 0; i < MAX_RUNS + 3; i++)
      doc = withEvents(doc, `s${i}`, [{ kind: 'checks' }], `2026-10-24T10:00:${String(i).padStart(2, '0')}Z`);
    assert.equal(doc.runs.length, MAX_RUNS);
    assert.equal(doc.runs[0].id, 's3');
    assert.deepEqual(withEvents(doc, 's9', [], at(9)), doc, 'no calls, no change');
  });

  it('is judged, its verdict taken back, and removed', () => {
    const doc = withEvents(empty(), 's1', [{ kind: 'report', report: piece() }], at(1));
    const judged = withVerdict(doc, 's1', 'w1', 'off');
    assert.equal(judged.runs[0].reports[0].verdict, 'off');
    assert.equal('verdict' in withVerdict(judged, 's1', 'w1', null).runs[0].reports[0], false);
    assert.deepEqual(withoutRun(judged, 's1').runs, []);
  });

  it('keeps only what a run is when read back', () => {
    const doc = withEvents(empty(), 's1', [{ kind: 'checks' }], at(1));
    assert.deepEqual(runsDocIn({ ...doc, runs: [...doc.runs, { id: 2 }, null] }), doc);
    assert.deepEqual(runsDocIn(null), empty());
  });

  it('keeps the agent’s name to plain characters', () => {
    assert.equal(agentName('claude-code'), 'claude-code');
    assert.equal(agentName('<b>Cursor</b> 1.2'), 'bCursorb 1.2');
    assert.equal(agentName(7), '');
  });
});

describe('the agent’s report (D120)', () => {
  it('takes rules by number as their lasting keys, and lists what isn’t a rule', () => {
    const out = reportOf(
      {
        work: '  Agent Hub,   overview ',
        followed: ['R1', 'R1', 'R3', 'R9'],
        setAside: [{ rule: 'R2', why: 'Asked otherwise.' }, 'R3', { rule: 'X' }],
        failedChecks: ['contrast', { check: 'fonts', rules: ['R1'] }],
        checksRun: 2.5,
        openCalls: ['  One?  ', ''],
      },
      library(),
      at(0),
      'w1',
    );
    if ('error' in out) throw new Error(out.error);
    const [a, bb, ccc] = rulesOf(library()).map((r) => r.rule.id);
    assert.deepEqual(out.report, {
      id: 'w1',
      at: at(0),
      work: 'Agent Hub, overview',
      followed: [a, ccc],
      setAside: [
        { rule: bb, why: 'Asked otherwise.' },
        { rule: ccc, why: '' },
      ],
      failed: [
        { check: 'contrast', rules: [] },
        { check: 'fonts', rules: [a] },
      ],
      open: ['One?'],
    });
    assert.deepEqual(out.unknown, ['R9', 'X']);
  });

  it('needs what was made', () => {
    assert.ok('error' in reportOf({ followed: ['R1'] }, library(), at(0), 'w1'));
  });
});

describe('what the runs say about the rules (D120)', () => {
  const [a, bb, ccc] = rulesOf(library()).map((r) => r.rule.id);
  const runs = withEvents(
    withEvents(
      empty(),
      's1',
      [
        { kind: 'rules', topics: [], tags: [], screen: [], rules: [a, bb] },
        {
          kind: 'report',
          report: piece({
            followed: [a],
            setAside: [{ rule: bb, why: 'Too loose here.' }],
            failed: [{ check: 'contrast', rules: [a] }],
            verdict: 'off',
          }),
        },
      ],
      at(1),
    ),
    's2',
    [
      { kind: 'rules', topics: [], tags: [], screen: [], rules: [a] },
      { kind: 'report', report: piece({ id: 'w2', followed: [a], verdict: 'good' }) },
    ],
    at(2),
  ).runs;

  it('counts each rule served, followed, set aside, failing and judged', () => {
    const s = ruleSignals(runs);
    assert.deepEqual(s.get(a), { served: 2, followed: 2, setAside: [], failed: 1, good: 1, off: 1 });
    assert.deepEqual(s.get(bb), {
      served: 1,
      followed: 0,
      setAside: ['Too loose here.'],
      failed: 0,
      good: 0,
      off: 0,
    });
  });

  it('puts the rules in trouble first, and names the rules never served once enough runs asked', () => {
    assert.deepEqual(
      rulesToLookAt(library(), runs).map((x) => x.rule.rule.id),
      [a, bb],
    );
    assert.deepEqual(neverServed(library(), runs), [], `fewer than ${MIN_RUNS} runs`);
    const more = withEvents(
      { runs, agents: [] },
      's3',
      [{ kind: 'rules', topics: [], tags: [], screen: [], rules: [a] }],
      at(3),
    ).runs;
    assert.deepEqual(
      neverServed(library(), more).map((r) => r.rule.id),
      [ccc],
    );
  });
});

describe('the pilot’s view of an account (D123)', () => {
  it('counts runs, pieces, verdicts, notes read and proposals, never what was made', () => {
    let doc = withEvents(
      empty(),
      's1',
      [
        { kind: 'reading', notes: 12 },
        { kind: 'reading', notes: 3 },
        { kind: 'proposal', id: 'p1' },
        { kind: 'report', report: piece({ verdict: 'good' }) },
        { kind: 'report', report: piece({ id: 'w2', verdict: 'off' }) },
      ],
      '2026-10-24T10:00:00Z',
    );
    doc = withEvents(doc, 's0', [{ kind: 'checks' }], '2026-09-01T10:00:00Z');
    assert.equal(doc.runs.find((r) => r.id === 's1')?.notesRead, 15);
    assert.deepEqual(pilotRow(doc.runs, '2026-10-25T10:00:00Z'), {
      runs7: 1,
      runs30: 1,
      pieces: 2,
      good: 1,
      close: 0,
      off: 1,
      notesRead: 15,
      proposals: 1,
      lastRun: '2026-10-24T10:00:00Z',
    });
    assert.equal(pilotRow([], 'x').lastRun, null);
  });
});
