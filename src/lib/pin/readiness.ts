import { checksOf } from './checks';
import { type Collection, type Rule, screenOf, screenTagsIn } from './learnings';
import { cleanScreenTag } from './model';
import { briefOf, screenGroup, screenNames } from './screen-index';

/*
 * How ready each product is for an agent's work (D125): for every screen tag the rules are drawn
 * from, how many rules it has, how many of them a render check holds, how many best examples the
 * author marked on its screenshots, and whether they wrote its brief. An agent sees it in
 * list_rule_topics, and get_design_rules says what a product it asks for lacks, so the agent
 * knows where it decides alone and says so instead of borrowing quietly. Pure.
 */

export type Readiness = {
  tag: string;
  rules: number;
  /** Rules a render check holds (D109). */
  checked: number;
  /** Notes on its screenshots the author marked as best examples (D108). */
  best: number;
  brief: boolean;
};

/** Each product's readiness, the one with the most rules first. */
export function readinessOf(c: Collection, rules: readonly Rule[]): Readiness[] {
  const names = screenNames(c);
  const held = new Set(checksOf(c).flatMap((x) => x.rules));
  const best = new Map<string, number>();
  for (const b of c.batches)
    for (const n of b.notes) {
      const tag = cleanScreenTag(n.screenTag);
      if (n.best && tag) best.set(screenGroup(tag), (best.get(screenGroup(tag)) ?? 0) + 1);
    }
  return screenTagsIn(c, [...rules]).map(({ value, n }) => {
    const key = screenGroup(value);
    const own = rules.filter((r) => screenOf(c, r, names).some((t) => screenGroup(t) === key));
    return {
      tag: value,
      rules: n,
      checked: own.filter((r) => held.has(r.id)).length,
      best: best.get(key) ?? 0,
      brief: Boolean(briefOf(c, value)),
    };
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One product's line for list_rule_topics: "Inbox: 12 rules, 4 checked, 2 best examples, a brief". */
export const readinessLine = (r: Readiness) =>
  `${r.tag}: ${[
    plural(r.rules, 'rule', 'rules'),
    `${r.checked} checked`,
    r.best ? plural(r.best, 'best example', 'best examples') : 'no best example',
    r.brief ? 'a brief' : 'no brief',
  ].join(', ')}`;

/**
 * What the products asked for lack, for get_design_rules: a brief, a best example, or any rule
 * of their own. None when they have them all, or no product was asked for.
 */
export function gapsLines(
  c: Collection,
  rules: readonly Rule[],
  screen: readonly string[] | undefined,
): string[] {
  if (!screen?.length) return [];
  const ready = readinessOf(c, rules);
  const gaps = screen.flatMap((asked) => {
    const r = ready.find((x) => screenGroup(x.tag) === screenGroup(asked));
    const name = r?.tag ?? cleanScreenTag(asked);
    const lacks = r
      ? [r.brief ? '' : 'no brief', r.best ? '' : 'no best example'].filter(Boolean)
      : ['no rules of its own', ...(briefOf(c, asked) ? [] : ['no brief'])];
    return lacks.length && name ? [`- “${name}”: ${lacks.join(', ')}`] : [];
  });
  if (!gaps.length) return [];
  return [
    'What the author hasn’t given you for the products asked for. There, what the rules leave open is yours to decide: take it from the closest product’s rules and best examples, and list what you borrowed among the decisions that need the author’s call:',
    ...gaps,
  ];
}
