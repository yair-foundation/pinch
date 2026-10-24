import { type Collection, type ExportedRule, rulesOf } from './learnings';

/*
 * What the agent did with the rules (D120). Each connection of the agent (one MCP session) is a
 * run, kept in the account beside its proposals: Pinch writes down what each call asked for and
 * got (the rules served, the close-ups opened, the render checks, the rules proposed), and the
 * agent adds what it made and how the rules went (`report_work`). The person judges each piece
 * of work on Your rules, so the rules set aside, failing their checks or in work judged off show
 * up, and so do the rules no run was ever served. Rule keys, topics, the person's own tags and
 * short lines from the agent only: no images, file names or links. Pure.
 */

export type Verdict = 'good' | 'close' | 'off';
export const VERDICTS: readonly Verdict[] = ['good', 'close', 'off'];

/** One piece of work, as the agent reported it, with the person's verdict once they give it. */
export type Report = {
  id: string;
  at: string;
  /** What was made, a few words. */
  work: string;
  /** Rules followed, by lasting key. */
  followed: string[];
  setAside: { rule: string; why: string }[];
  /** Checks that failed, each with the rules it holds, by key. */
  failed: { check: string; rules: string[] }[];
  /** How many checks ran on it; absent when it didn't say. */
  checksRun?: number;
  /** The decisions that need the person's call (D119). */
  open: string[];
  verdict?: Verdict;
};

/** One get_design_rules call: what it asked for and how many rules it got. */
export type Ask = { at: string; topics: string[]; tags: string[]; screen: string[]; served: number };

export type Run = {
  id: string;
  started: string;
  updated: string;
  /** The agent's own name for itself, from its first message ("claude-code"). */
  agent?: string;
  asks: Ask[];
  /** Every rule served in the run, by lasting key. */
  served: string[];
  /** The rules whose close-ups were opened. */
  evidence: string[];
  checks: boolean;
  /** The ids of the rules it proposed (D116). */
  proposals: string[];
  reports: Report[];
};

/** What one tool call adds to its run. */
export type RunEvent =
  | { kind: 'rules'; topics: string[]; tags: string[]; screen: string[]; rules: string[] }
  | { kind: 'evidence'; rule: string }
  | { kind: 'checks' }
  | { kind: 'proposal'; id: string }
  | { kind: 'report'; report: Report };

/**
 * The account's runs, newest last, and the agents that connected but haven't called a tool yet:
 * a run starts with its first call, since an agent connects every time it starts, used or not.
 */
export type RunsDoc = { runs: Run[]; agents: { id: string; agent: string; at: string }[] };

export const MAX_RUNS = 30;
const MAX_AGENTS = 20;
const MAX_ASKS = 40;
const MAX_REPORTS = 20;
const MAX_KEYS = 1000;
const MAX_LIST = 300;
const MAX_OPEN = 20;
const LIMITS = { work: 120, why: 300, check: 80, open: 300, agent: 60 };
/** Rules count as never served only once this many runs asked for rules. */
export const MIN_RUNS = 3;

const line = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const strings = (v: unknown, max: number, each: number) =>
  (Array.isArray(v) ? v : []).map((x) => line(x, each)).filter(Boolean).slice(0, max);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(-MAX_KEYS);

/** The agent's name as it gave it, kept to letters, digits, spaces, dots and dashes. */
export const agentName = (v: unknown) =>
  line(v, LIMITS.agent).replace(/[^\w .-]/g, '').trim();

/**
 * The agent's report as a piece of work, with the rule numbers it named that aren't rules.
 * Numbers are the ones get_design_rules shows (R3), kept as the rules' lasting keys.
 */
export function reportOf(
  args: unknown,
  c: Collection | null,
  now: string,
  id: string,
): { report: Report; unknown: string[] } | { error: string } {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const work = line(a.work, LIMITS.work);
  if (!work) return { error: 'Give work: what you made, in a few words.' };
  const all = c ? rulesOf(c) : [];
  const unknown: string[] = [];
  const keyOf = (n: unknown) => {
    const s = line(n, 12);
    const i = Number(s.replace(/^r/i, ''));
    const r = Number.isInteger(i) ? all[i - 1] : undefined;
    if (!r && s) unknown.push(s);
    return r?.rule.id;
  };
  const keys = (v: unknown) => [
    ...new Set(
      (Array.isArray(v) ? v : [])
        .slice(0, MAX_LIST)
        .map(keyOf)
        .filter((k): k is string => Boolean(k)),
    ),
  ];
  const followed = keys(a.followed);
  const setAside = (Array.isArray(a.setAside) ? a.setAside : [])
    .slice(0, MAX_LIST)
    .flatMap((x) => {
      const o = (x && typeof x === 'object' ? x : { rule: x }) as Record<string, unknown>;
      const rule = keyOf(o.rule);
      return rule ? [{ rule, why: line(o.why, LIMITS.why) }] : [];
    });
  const failed = (Array.isArray(a.failedChecks) ? a.failedChecks : [])
    .slice(0, MAX_LIST)
    .flatMap((x) => {
      const o = (x && typeof x === 'object' ? x : { check: x }) as Record<string, unknown>;
      const check = line(o.check, LIMITS.check);
      return check ? [{ check, rules: keys(o.rules) }] : [];
    });
  const run = Number(a.checksRun);
  const report: Report = {
    id,
    at: now,
    work,
    followed,
    setAside,
    failed,
    ...(Number.isInteger(run) && run >= 0 ? { checksRun: run } : {}),
    open: strings(a.openCalls, MAX_OPEN, LIMITS.open),
  };
  return { report, unknown: [...new Set(unknown)] };
}

const emptyRun = (id: string, now: string, agent?: string): Run => ({
  id,
  started: now,
  updated: now,
  ...(agent ? { agent } : {}),
  asks: [],
  served: [],
  evidence: [],
  checks: false,
  proposals: [],
  reports: [],
});

/** An agent connected: its name waits for the run its first call starts. */
export function withStart(doc: RunsDoc, id: string, agent: string, now: string): RunsDoc {
  if (!agent) return doc;
  if (doc.runs.some((r) => r.id === id))
    return { ...doc, runs: doc.runs.map((r) => (r.id === id ? { ...r, agent } : r)) };
  const agents = [...doc.agents.filter((x) => x.id !== id), { id, agent, at: now }];
  return { ...doc, agents: agents.slice(-MAX_AGENTS) };
}

/** A run with what its calls added; started by its first one. The oldest go past the cap. */
export function withEvents(doc: RunsDoc, id: string, events: RunEvent[], now: string): RunsDoc {
  if (!events.length) return doc;
  const known = doc.runs.find((r) => r.id === id);
  const waiting = doc.agents.find((x) => x.id === id);
  let run: Run = known ?? emptyRun(id, now, waiting?.agent);
  for (const e of events) {
    if (e.kind === 'rules')
      run = {
        ...run,
        asks: [
          ...run.asks,
          {
            at: now,
            topics: strings(e.topics, 20, 40),
            tags: strings(e.tags, 20, 60),
            screen: strings(e.screen, 20, 60),
            served: e.rules.length,
          },
        ].slice(-MAX_ASKS),
        served: union(run.served, e.rules),
      };
    else if (e.kind === 'evidence') run = { ...run, evidence: union(run.evidence, [e.rule]) };
    else if (e.kind === 'checks') run = { ...run, checks: true };
    else if (e.kind === 'proposal')
      run = { ...run, proposals: union(run.proposals, [e.id]) };
    else run = { ...run, reports: [...run.reports, e.report].slice(-MAX_REPORTS) };
  }
  run = { ...run, updated: now };
  const runs = [...doc.runs.filter((r) => r.id !== id), run]
    .sort((a, b) => a.updated.localeCompare(b.updated))
    .slice(-MAX_RUNS);
  return { runs, agents: waiting ? doc.agents.filter((x) => x !== waiting) : doc.agents };
}

/** A piece of work judged, or its verdict taken back with null. */
export function withVerdict(
  doc: RunsDoc,
  runId: string,
  reportId: string,
  verdict: Verdict | null,
): RunsDoc {
  return {
    ...doc,
    runs: doc.runs.map((r) =>
      r.id !== runId
        ? r
        : {
            ...r,
            reports: r.reports.map((p) => {
              if (p.id !== reportId) return p;
              const { verdict: _, ...rest } = p;
              return verdict ? { ...rest, verdict } : rest;
            }),
          },
    ),
  };
}

export const withoutRun = (doc: RunsDoc, id: string): RunsDoc => ({
  ...doc,
  runs: doc.runs.filter((r) => r.id !== id),
});

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** What a stored document holds, tidied: anything not a run is left out. */
export function runsDocIn(doc: unknown): RunsDoc {
  const d = (doc && typeof doc === 'object' ? doc : {}) as { runs?: unknown; agents?: unknown };
  const runs = (Array.isArray(d.runs) ? d.runs : []).filter(
    (r): r is Run =>
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.started === 'string' &&
      typeof r.updated === 'string' &&
      Array.isArray(r.asks) &&
      isStrings(r.served) &&
      isStrings(r.evidence) &&
      isStrings(r.proposals) &&
      Array.isArray(r.reports),
  );
  const agents = (Array.isArray(d.agents) ? d.agents : []).filter(
    (x): x is RunsDoc['agents'][number] =>
      x && typeof x.id === 'string' && typeof x.agent === 'string' && typeof x.at === 'string',
  );
  return { runs, agents };
}

/** How one rule did across the runs. */
export type RuleSignal = {
  /** Runs it was served in. */
  served: number;
  followed: number;
  /** Why it was set aside, once for each piece of work that did. */
  setAside: string[];
  /** Failed checks that hold it. */
  failed: number;
  /** Pieces of work that followed it, by the person's verdict. */
  good: number;
  off: number;
};

export function ruleSignals(runs: Run[]): Map<string, RuleSignal> {
  const out = new Map<string, RuleSignal>();
  const of = (k: string) => {
    let s = out.get(k);
    if (!s) {
      s = { served: 0, followed: 0, setAside: [], failed: 0, good: 0, off: 0 };
      out.set(k, s);
    }
    return s;
  };
  for (const r of runs) {
    for (const k of r.served) of(k).served++;
    for (const p of r.reports) {
      for (const k of p.followed) {
        const s = of(k);
        s.followed++;
        if (p.verdict === 'good') s.good++;
        if (p.verdict === 'off') s.off++;
      }
      for (const x of p.setAside) of(x.rule).setAside.push(x.why);
      for (const f of p.failed) for (const k of f.rules) of(k).failed++;
    }
  }
  return out;
}

/**
 * The rules to look at: set aside, failing a check, or followed in work judged off; most
 * trouble first. Only rules the person still keeps.
 */
export function rulesToLookAt(
  c: Collection,
  runs: Run[],
): { rule: ExportedRule; signal: RuleSignal }[] {
  const signals = ruleSignals(runs);
  const weight = (s: RuleSignal) => s.setAside.length + s.failed + s.off;
  return rulesOf(c)
    .flatMap((rule) => {
      const signal = signals.get(rule.rule.id);
      return signal && weight(signal) > 0 ? [{ rule, signal }] : [];
    })
    .sort((a, b) => weight(b.signal) - weight(a.signal));
}

/** The rules no run was served, once enough runs asked for rules to say so. */
export function neverServed(c: Collection, runs: Run[]): ExportedRule[] {
  const asking = runs.filter((r) => r.asks.length);
  if (asking.length < MIN_RUNS) return [];
  const served = new Set(asking.flatMap((r) => r.served));
  return rulesOf(c).filter((r) => !served.has(r.rule.id));
}
