import { type Collection, type Rule, rulesOf } from './learnings';
import { TOPIC_KINDS, type Topic } from './model';

/*
 * Rules from the agent (D116). What the person settles with their agent in conversation (a
 * correction, a choice between two rules) used to live only in that agent's memory. The agent
 * proposes it to Pinch with `propose_rule`; it waits on Your rules until the person keeps or
 * drops it, and only a kept one becomes a rule. Proposals are kept apart from the collection,
 * which the page saves whole, so an open page can't write over one. Pure: what a proposal is,
 * how a call becomes one, and what keeping it does.
 */

export type Proposal = {
  id: string;
  at: string;
  /** The rule to change, by its lasting key; absent for a new rule. */
  rule?: string;
  /** The rule as it read when the change was proposed, so the person sees what changes. */
  was?: string;
  text: string;
  /** Where it holds, or empty for everywhere. */
  where: string;
  topics: Topic[];
  /** What the person and the agent agreed, in a sentence. */
  why: string;
};

export const MAX_PROPOSALS = 50;
const LIMITS = { text: 300, where: 120, why: 300 };

const line = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * The agent's call as a proposal, or what it got wrong. `rule` is the number get_design_rules
 * showed ("R3"), kept as the rule's lasting key, since numbers move when rules change.
 */
export function proposalOf(
  args: unknown,
  c: Collection | null,
  now: string,
  id: string,
): { proposal: Proposal } | { error: string } {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const text = line(a.text, LIMITS.text);
  const why = line(a.why, LIMITS.why);
  if (!text) return { error: 'Give the rule in text: one sentence, as the person would keep it.' };
  if (!why)
    return {
      error: 'Give why: what the person said or agreed that this rule keeps, in a sentence.',
    };
  const topics = Array.isArray(a.topics)
    ? [
        ...new Set(
          a.topics.filter((t): t is Topic => (TOPIC_KINDS as readonly string[]).includes(t)),
        ),
      ]
    : [];
  const proposal: Proposal = { id, at: now, text, where: line(a.where, LIMITS.where), topics, why };
  if (a.rule === undefined || a.rule === null || a.rule === '') return { proposal };
  const all = c ? rulesOf(c) : [];
  const n = Number(String(a.rule).trim().replace(/^r/i, ''));
  const target = Number.isInteger(n) ? all[n - 1] : undefined;
  if (!target)
    return {
      error: all.length
        ? `No rule ${String(a.rule)}. Rules are numbered ${all[0].id} to ${all[all.length - 1].id}; leave rule out for a new one.`
        : 'There are no rules to change yet; leave rule out for a new one.',
    };
  return { proposal: { ...proposal, rule: target.rule.id, was: target.rule.text.trim() } };
}

/** The waiting proposals with one more: the same one again is left as it was, the oldest go past the cap. */
export function withProposal(list: Proposal[], p: Proposal): Proposal[] {
  const same = (x: Proposal) =>
    x.rule === p.rule && x.text.toLowerCase() === p.text.toLowerCase() && x.where === p.where;
  if (list.some(same)) return list;
  return [...list, p].slice(-MAX_PROPOSALS);
}

/** What a stored document holds, tidied: anything not a proposal is left out. */
export function proposalsIn(doc: unknown): Proposal[] {
  const list = (doc as { proposals?: unknown })?.proposals;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (p): p is Proposal =>
      p &&
      typeof p === 'object' &&
      typeof p.id === 'string' &&
      typeof p.text === 'string' &&
      typeof p.why === 'string',
  );
}

/**
 * The collection with a proposal kept. A change rewrites its rule's words, place and topics and
 * keeps its notes; a new rule has none, like a taste-check pick, until a note strengthens it.
 * Either way the rule says it was agreed with the agent, and why, and which proposal it came
 * from: a proposal already kept leaves the collection as it is (a second click on Keep, or the
 * same proposal shown again before it left the account's list). A change to a rule since removed
 * becomes a new rule, since the person kept it.
 */
export function keepProposal(
  c: Collection,
  p: Proposal,
  now: string,
  newId: () => string,
): Collection {
  if (c.rules.some((r) => r.agreed?.proposal === p.id)) return c;
  const agreed = { why: p.why, at: now, proposal: p.id };
  const target = p.rule
    ? c.rules.find((r) => r.id === p.rule && r.status !== 'dismissed')
    : undefined;
  if (target) {
    const { title: _, ...rest } = target;
    const changed: Rule = {
      ...rest,
      text: p.text,
      context: p.where,
      ...(p.topics.length ? { topics: p.topics } : {}),
      agreed,
    };
    return { ...c, updatedAt: now, rules: c.rules.map((r) => (r === target ? changed : r)) };
  }
  const rule: Rule = {
    id: newId(),
    text: p.text,
    context: p.where,
    topics: p.topics,
    tags: [],
    evidence: [],
    status: 'approved',
    agreed,
    createdAt: now,
  };
  return { ...c, updatedAt: now, rules: [...c.rules, rule] };
}
