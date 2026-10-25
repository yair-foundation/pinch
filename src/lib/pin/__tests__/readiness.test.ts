import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answer, topicsText, versionLine } from '../agent';
import { withChecks } from '../checks';
import {
  type BatchNote,
  type Collection,
  newCollection,
  type Rule,
  rulesManifest,
  rulesMarkdown,
  rulesOf,
  rulesVersion,
} from '../learnings';
import { gapsLines, readinessOf } from '../readiness';
import {
  correctionsLines,
  correctionsOf,
  MAX_CORRECTIONS,
  type Report,
  type Run,
  type RunsDoc,
  withCorrection,
  withVerdict,
} from '../runs';
import { withBrief } from '../screen-index';

const note = (ref: string, screenTag: string, best = false): BatchNote => ({
  ref,
  image: `screen-${ref}.png`,
  source: 'ours',
  topics: ['layout'],
  works: `Works ${ref}.`,
  doesNotWork: '',
  crop: `crops/${ref}.jpg`,
  screenTag,
  ...(best ? { best: true as const } : {}),
});

const rule = (id: string, notes: string[], extra: Partial<Rule> = {}): Rule => ({
  id,
  text: `Rule ${id}.`,
  context: '',
  topics: ['layout'],
  tags: [],
  evidence: notes.map((n) => ({ batchId: 'b1', note: n })),
  status: 'approved',
  createdAt: `2026-10-25T10:00:0${id.charCodeAt(0) - 97}Z`,
  ...extra,
});

/** Inbox: two rules, one best example, a brief and a check. Business Model: one rule, nothing else. */
function library(): Collection {
  const c: Collection = {
    ...newCollection('My rules', 'c1', '2026-10-25T10:00:00Z'),
    batches: [
      {
        id: 'b1',
        name: 'pinch-2026-10-25',
        addedAt: 'x',
        exportedAt: 'x',
        root: 'pinch-2026-10-25/',
        images: 3,
        notes: [note('01.1', 'Inbox', true), note('02.1', 'Inbox'), note('03.1', 'Business Model')],
      },
    ],
    rules: [rule('a', ['01.1']), rule('b', ['02.1']), rule('c', ['03.1'])],
  };
  const checked = withChecks(
    c,
    [{ kind: 'textSize', value: 12, rules: ['a'], why: 'From R1.' }],
    'x',
    'n',
  );
  return withBrief(checked, 'Inbox', 'Messages from every channel in one place.', 'n');
}

const live = (c: Collection) => rulesOf(c).map((r) => r.rule);

describe('how ready each product is (D125)', () => {
  it('counts its rules, the checked ones, its best examples and its brief', () => {
    const c = library();
    assert.deepEqual(readinessOf(c, live(c)), [
      { tag: 'Inbox', rules: 2, checked: 1, best: 1, brief: true, links: [] },
      { tag: 'Business Model', rules: 1, checked: 0, best: 0, brief: false, links: [] },
    ]);
  });

  it('is in list_rule_topics, one line a product', () => {
    const text = topicsText(library());
    assert.match(text, /^- Inbox: 2 rules, 1 checked, 1 best example, a brief$/m);
    assert.match(text, /^- Business Model: 1 rule, 0 checked, no best example, no brief$/m);
  });

  it('says what a product asked for lacks, and nothing for one that has it all', () => {
    const c = library();
    assert.deepEqual(gapsLines(c, live(c), ['Inbox']), []);
    assert.deepEqual(gapsLines(c, live(c), undefined), []);
    const gaps = gapsLines(c, live(c), ['business model', 'Pricing']);
    assert.match(gaps[0], /yours to decide/);
    assert.deepEqual(gaps.slice(1), [
      '- “Business Model”: no brief, no best example',
      '- “Pricing”: no rules of its own, no brief',
    ]);
  });

  it('comes first in get_design_rules for the products asked for', async () => {
    const r = (await answer(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_design_rules', arguments: { screenTags: ['Business Model'] } },
      },
      async () => library(),
    )) as { result: { content: { text: string }[] } };
    const text = r.result.content[0].text;
    assert.match(text, /- “Business Model”: no brief, no best example\n[\s\S]*R3\. Rule c\./);
  });
});

const empty = (): RunsDoc => ({ runs: [], agents: [] });
const piece = (id: string, at: string, more: Partial<Report> = {}): Report => ({
  id,
  at,
  work: `Work ${id}`,
  followed: [],
  setAside: [],
  failed: [],
  open: [],
  ...more,
});
const run = (reports: Report[]): Run => ({
  id: 's1',
  started: 'x',
  updated: 'x',
  asks: [],
  served: [],
  evidence: [],
  checks: false,
  proposals: [],
  reports,
});

describe('the author’s corrections on earlier work (D125)', () => {
  it('go with work judged close or off, and leave when it is judged good or not at all', () => {
    const doc = { ...empty(), runs: [run([piece('w1', '2026-10-25T10:00:00Z')])] };
    assert.equal(
      withCorrection(doc, 's1', 'w1', 'Too dense.').runs[0].reports[0].correction,
      undefined,
    );
    const off = withCorrection(withVerdict(doc, 's1', 'w1', 'off'), 's1', 'w1', '  Too   dense. ');
    assert.equal(off.runs[0].reports[0].correction, 'Too dense.');
    assert.equal(withVerdict(off, 's1', 'w1', 'close').runs[0].reports[0].correction, 'Too dense.');
    assert.equal('correction' in withVerdict(off, 's1', 'w1', 'good').runs[0].reports[0], false);
    assert.equal('correction' in withVerdict(off, 's1', 'w1', null).runs[0].reports[0], false);
    assert.equal('correction' in withCorrection(off, 's1', 'w1', ' ').runs[0].reports[0], false);
  });

  it('reach the agent newest first, a few at most', () => {
    const reports = Array.from({ length: MAX_CORRECTIONS + 2 }, (_, i) =>
      piece(`w${i}`, `2026-10-25T10:${String(i).padStart(2, '0')}:00Z`, {
        verdict: i % 2 ? 'off' : 'close',
        correction: `Fix ${i}.`,
      }),
    );
    const good = piece('g', '2026-10-25T11:00:00Z', { verdict: 'good', correction: 'Kept.' });
    const list = correctionsOf([run([...reports, good])]);
    assert.equal(list.length, MAX_CORRECTIONS);
    assert.equal(list[0].correction, `Fix ${MAX_CORRECTIONS + 1}.`);
    assert.deepEqual(correctionsLines([]), []);
    assert.match(
      correctionsLines([run(reports)])[1],
      /^- On “Work w9” \(off, 2026-10-25\): Fix 9\.$/,
    );
  });

  it('come with get_design_rules, from the account’s runs', async () => {
    const runs = [
      run([
        piece('w1', '2026-10-25T10:00:00Z', { verdict: 'off', correction: 'Cursor on the value.' }),
      ]),
    ];
    const r = (await answer(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_design_rules' } },
      async () => library(),
      undefined,
      undefined,
      { id: () => 'r1', add: () => {}, runs: async () => runs },
    )) as { result: { content: { text: string }[] } };
    assert.match(
      r.result.content[0].text,
      /On “Work w1” \(off, 2026-10-25\): Cursor on the value\./,
    );
  });
});

describe('the rules’ version (D125)', () => {
  it('changes with a rule’s words or a brief, not with a note', () => {
    const c = library();
    const v = rulesVersion(c);
    assert.equal(rulesVersion(library()), v);
    const strengthened = {
      ...c,
      rules: c.rules.map((r) =>
        r.id === 'a' ? { ...r, evidence: [...r.evidence, { batchId: 'b1', note: '02.1' }] } : r,
      ),
    };
    assert.equal(rulesVersion(strengthened), v);
    const reworded = {
      ...c,
      rules: c.rules.map((r) => (r.id === 'a' ? { ...r, text: 'New.' } : r)),
    };
    assert.notEqual(rulesVersion(reworded), v);
    assert.notEqual(rulesVersion(withBrief(c, 'Business Model', 'Payouts.', 'n')), v);
  });

  it('is named in the package, and list_rule_topics says whether a copy is current', async () => {
    const c = library();
    const v = rulesVersion(c);
    const md = rulesMarkdown(c, rulesOf(c), '2026-10-25T10:00:00Z', () => '');
    assert.match(md, new RegExp(`version ${v}\\.`));
    assert.equal(rulesManifest(c, rulesOf(c), 'x', () => '').rulesVersion, v);
    assert.match(versionLine(v, `"${v}"`), /your copy is current/);
    assert.match(versionLine(v, 'old'), /your copy \(old\) is behind/);
    const topics = (version?: string) =>
      answer(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_rule_topics', arguments: version ? { version } : {} },
        },
        async () => c,
      ) as Promise<{ result: { content: { text: string }[] } }>;
    assert.match((await topics(v)).result.content[0].text, /your copy is current/);
    assert.match((await topics('old')).result.content[0].text, /is behind/);
    assert.match((await topics()).result.content[0].text, new RegExp(`Rules version ${v}\\.`));
  });

  it('is of every rule when the agent gets fewer, as the package has them', async () => {
    const c = library();
    const fewer = { ...c, rules: c.rules.slice(0, 1) };
    const r = (await answer(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_rule_topics', arguments: { version: rulesVersion(c) } },
      },
      async () => fewer,
      undefined,
      undefined,
      undefined,
      { id: () => 'x', save: async () => {}, rules: async () => c },
    )) as { result: { content: { text: string }[] } };
    assert.match(r.result.content[0].text, /your copy is current/);
  });
});
