import { fingerprint } from './hash';
import { type Collection, type ExportedRule, rulesOf, rulesVersion } from './learnings';
import { briefsOf } from './screen-index';

/*
 * What changed since a copy of the rules (D128). A copy is what an export carries, so each export
 * keeps, in the collection, its version and each rule's lasting key with a fingerprint of its
 * words; the MCP server compares an agent's copy with the rules now and says which rules are new,
 * reworded or gone, so the agent reads those and not all of them again. Pure.
 */

/** One export's rules: their version, when, each rule's key and words in order, and the briefs. */
export type ExportedVersion = {
  version: string;
  at: string;
  /** Each rule's lasting key and a fingerprint of its words, place, topics and tags, in order. */
  rules: [string, string][];
  /** A fingerprint of the briefs. */
  briefs: string;
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Exports remembered: enough for the copies still in use. */
export const MAX_EXPORTS = 12;

/** What an agent reads in one rule, as a fingerprint. */
const wordsOf = (r: ExportedRule) =>
  fingerprint(
    JSON.stringify([r.rule.text.trim(), r.rule.context.trim(), r.rule.topics, r.rule.tags]),
  );

/** The rules now, as an export keeps them. */
export const versionOf = (c: Collection, at: string): ExportedVersion => ({
  version: rulesVersion(c),
  at,
  rules: rulesOf(c).map((r) => [r.rule.id, wordsOf(r)]),
  briefs: fingerprint(JSON.stringify(briefsOf(c))),
});

/** The collection with this export's version kept; the same version again only moves its date. */
export function withExported(c: Collection, now: string): Collection {
  const kept = versionOf(c, now);
  const exports = [...(c.exports ?? []).filter((x) => x.version !== kept.version), kept].slice(
    -MAX_EXPORTS,
  );
  return { ...c, updatedAt: now, exports };
}

/** Two collections' exports as one list, a version once, the newest kept. */
export function mergeExports(
  a: readonly ExportedVersion[] = [],
  b: readonly ExportedVersion[] = [],
): ExportedVersion[] {
  const by = new Map<string, ExportedVersion>();
  for (const x of [...a, ...b]) {
    const have = by.get(x.version);
    if (!have || x.at > have.at) by.set(x.version, x);
  }
  return [...by.values()].sort((x, y) => x.at.localeCompare(y.at)).slice(-MAX_EXPORTS);
}

export type Changes = {
  /** When the copy was exported. */
  at: string;
  added: ExportedRule[];
  /** Reworded, moved to another place, topic or tag, with the number they had in the copy. */
  reworded: { rule: ExportedRule; was: string }[];
  /** Gone since, with their number in the copy and their words when the collection still has them. */
  gone: { was: string; text: string }[];
  /** Whether a rule kept its words but not its number. */
  renumbered: boolean;
  briefs: boolean;
};

/** What changed since the copy of a version, or null when no export of it is kept. */
export function changesSince(c: Collection, version: string): Changes | null {
  const copy = c.exports?.find((x) => x.version === version);
  if (!copy) return null;
  const now = versionOf(c, '');
  const rules = rulesOf(c);
  const before = new Map(copy.rules.map(([key, words], i) => [key, { words, was: `R${i + 1}` }]));
  const current = new Set(rules.map((r) => r.rule.id));
  const added: ExportedRule[] = [];
  const reworded: Changes['reworded'] = [];
  let renumbered = false;
  rules.forEach((r, i) => {
    const old = before.get(r.rule.id);
    if (!old) added.push(r);
    else if (old.words !== now.rules[i][1]) reworded.push({ rule: r, was: old.was });
    else if (old.was !== r.id) renumbered = true;
  });
  const gone = copy.rules.flatMap(([key], i) =>
    current.has(key)
      ? []
      : [{ was: `R${i + 1}`, text: c.rules.find((r) => r.id === key)?.text.trim() ?? '' }],
  );
  return { at: copy.at, added, reworded, gone, renumbered, briefs: copy.briefs !== now.briefs };
}

/** Rules listed by name in one answer; the rest are counted. */
const MAX_LISTED = 40;

/** What changed, as lines for an agent; none when nothing did. */
export function changesLines(ch: Changes): string[] {
  const items = [
    ...ch.added.map((r) => `- New ${r.id}: ${oneLine(r.rule.text)}`),
    ...ch.reworded.map(
      ({ rule: r, was }) =>
        `- Changed ${r.id}${was !== r.id ? ` (was ${was})` : ''}: ${oneLine(r.rule.text)}${r.rule.context.trim() ? ` (where: ${oneLine(r.rule.context)})` : ''}`,
    ),
    ...ch.gone.map((g) => `- Gone, was ${g.was}${g.text ? `: ${oneLine(g.text)}` : ''}`),
  ];
  const shown = items.slice(0, MAX_LISTED);
  return [
    ...shown,
    ...(items.length > shown.length ? [`- And ${items.length - shown.length} more.`] : []),
    ...(ch.briefs ? ['- The briefs changed: get_design_rules gives them first.'] : []),
    ...(ch.renumbered || ch.reworded.some((x) => x.was !== x.rule.id)
      ? [
          'Rule numbers have moved since your copy: refer to rules by the numbers get_design_rules gives now.',
        ]
      : []),
  ];
}
