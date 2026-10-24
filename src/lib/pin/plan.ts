import { type Collection, noteAt, type Rule } from './learnings';
import { cleanScreenTag } from './model';
import { screenGroup, screenSets } from './screen-index';

/*
 * The free plan covers one product (D123). Pinch is free to use whole (marking, reading, Your
 * rules, export), and a free account's agent gets the rules of one product: one screen tag's set,
 * the one the author picks or, until they pick, the one with the most notes. Rules drawn from no
 * tagged screenshot (untagged notes, taste-check picks, rules agreed with the agent) belong to
 * every product. Pro gets every product. Pure.
 */

/** The set the free plan covers, by its name: the one picked, else the one with the most notes. */
export function freeProductOf(c: Collection): string | null {
  const sets = screenSets(c);
  if (!sets.length) return null;
  const picked = c.freeProduct && sets.find((s) => screenGroup(s.name) === c.freeProduct);
  return (picked || sets[0]).name;
}

/** The collection with the free plan's product picked. */
export const withFreeProduct = (c: Collection, tag: string, now: string): Collection => ({
  ...c,
  updatedAt: now,
  freeProduct: screenGroup(tag),
});

/** The products a rule is drawn from, by their compared tags; none when no note of it is tagged. */
export function productsOf(c: Collection, r: Rule): Set<string> {
  const out = new Set<string>();
  for (const e of r.evidence) {
    const tag = cleanScreenTag(noteAt(c, e)?.note.screenTag);
    if (tag) out.add(screenGroup(tag));
  }
  return out;
}

/** Whether the free plan's agent gets a rule: drawn from its product, or from none. */
export function inFreePlan(c: Collection, r: Rule): boolean {
  const free = freeProductOf(c);
  const products = productsOf(c, r);
  return !free || !products.size || products.has(screenGroup(free));
}

/** The collection as a free account's agent gets it: only the free product's rules. */
export const freePlan = (c: Collection): Collection => ({
  ...c,
  rules: c.rules.filter((r) => inFreePlan(c, r)),
});

/** How many of the rules a free account's agent doesn't get, to say what Pro adds. */
export const beyondFree = (c: Collection, rules: readonly Rule[]) =>
  rules.filter((r) => !inFreePlan(c, r)).length;
