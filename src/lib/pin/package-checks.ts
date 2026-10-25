import { CHECK_INFO, CHECK_SCRIPT_FILE, CHECKS_DATA_FILE, checksOf, valueText } from './checks';
import { type Collection, type ExportedRule, hasBest } from './learnings';
import { outsideTarget, REVIEW_LINE } from './screen-index';

/**
 * `checks.md` in the rules package (D108): how an agent turns the rules a rendered page can
 * decide into checks in its own project, and the worklist to do it from. Pinch can't write the
 * checks itself: it never sees the agent's renders, and its rules are the author's words, not
 * code. So the package carries the method and every rule's stable key; the agent sorts the rules
 * and writes the checks. The few general checks Pinch worked out from the rules (D109) come first, and
 * the rules they hold are marked in the worklist. Pure, like the rest of the package.
 */

export const CHECKS_FILE = 'checks.md';

const cell = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

/** The guide and worklist, one row per rule. */
export function checksGuide(c: Collection, rules: ExportedRule[], stamp: string): string {
  const placed = rules.filter((r) => r.rule.context.trim()).length;
  const numbers = new Map(rules.map((r) => [r.rule.id, r.id]));
  const ready = checksOf(c);
  const covered = new Map<string, string[]>();
  for (const x of ready)
    for (const key of x.rules) covered.set(key, [...(covered.get(key) ?? []), x.kind]);
  const readyLines = ready.length
    ? [
        '## Ready to run',
        '',
        `Pinch worked out ${ready.length === 1 ? 'one check' : `${ready.length} checks`} from these rules. They are in \`${CHECKS_DATA_FILE}\`, and \`${CHECK_SCRIPT_FILE}\` runs them on any rendered page in a browser, with nothing to install:`,
        '',
        '```js',
        `// Playwright: after the page has rendered at the size it is shown at`,
        `await page.addScriptTag({ path: '${CHECK_SCRIPT_FILE}' });`,
        `const result = await page.evaluate((spec) => pinchChecks.run(spec, { scale: 1 }), spec);`,
        `// spec is ${CHECKS_DATA_FILE}, parsed. scale: the size the page is shown at over the size it is rendered at.`,
        '```',
        '',
        '`pinchChecks.report(result)` gives one line per failure, with the rules it breaks. Run them on every render, before anything else. The author didn’t set these numbers: where one is an estimate, its “why” in the JSON says so, so read a failure as a likely break of the rules it names and look at the render before changing it. They cover these rules; the worklist below marks them, so start your own checks from the rest.',
        '',
        ...ready.map((x) => {
          const on = x.rules.flatMap((k) => numbers.get(k) ?? []);
          // A check with no number (D127) is named and said, nothing more.
          const value = x.value === true ? '' : `: ${valueText(x)} (${CHECK_INFO[x.kind].unit})`;
          return `- **${CHECK_INFO[x.kind].label}**${value}. ${CHECK_INFO[x.kind].holds}${on.length ? ` Holds ${on.join(', ')}.` : ''}`;
        }),
        '',
      ]
    : [];
  const lines = [
    `# Render checks: ${c.name.replace(/\s+/g, ' ').trim()}`,
    '',
    `Exported from Pinch on ${stamp.slice(0, 10)}: ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, ${placed} of them held to a place ("Where").`,
    '',
    'Many of these rules can be decided from a rendered page by measuring it or reading its elements. A check holds such a rule on every render, instead of depending on how carefully the rules were read. Pinch ships only a few general checks, worked out from the rules (under Ready to run, when there are any); it never sees your renders, so the rest are yours to build in your own project, in this order.',
    '',
    ...readyLines,
    '## How',
    '',
    '1. **Sort every rule.** Mark it *check* if a render can decide it by measuring or reading the page: sizes, colours, contrast, spacing, counts, fonts, whether an element or its wrapper is there, the cursor’s shape, a colour or element the rule bans. Mark it *review* if it takes judgment: hierarchy, mood, what reads as clean. When unsure, mark it review.',
    '2. **Write one check per *check* rule** that fails when a render breaks it. Name it by the rule’s `key` (from `rules.json`), which stays the same from one export to the next; the R-number doesn’t. Put the R-number in the failure message so the author can find the rule.',
    `3. **Take every number from the author.** Use the rule’s own words, or measure its close-ups and the notes’ screenshots, and write down where the number came from. Never make a check stricter than the notes support.${hasBest(c) ? ' Notes the author marked as their best examples are the strongest evidence.' : ''}`,
    // Someone else's product: a principle, unless the author made it the target style (D114).
    outsideTarget(c)
      ? '4. **Keep each rule to its scope.** A rule with “Where” is checked only there. A rule drawn from someone else’s product that the author made the target style may hold its look (sizes, spacing, colours), never its product, brand or content; from any other, check the principle, never that product’s look.'
      : '4. **Keep each rule to its scope.** A rule with “Where” is checked only there. A rule drawn from someone else’s product is a principle: check the principle, never that product’s look.',
    '5. **Prove each check.** Run it on a copy you broke on purpose and see it fail, before you rely on it passing.',
    '6. **Keep the worklist below in your project, filled in:** for each rule, check or review, the check’s name, and what it measures. When a new export comes, compare its `rules.json` with your list by `key`: add checks for new rules, revise those whose words changed, and remove those whose rule is gone.',
    `7. **Run the checks on every render, and look at the review rules yourself.** A passing check is not a design review. ${REVIEW_LINE}`,
    '8. **Check earlier work again when anything shared changes.** Keep every piece of work you have made at the size it is shown, and run every check on all of them whenever the rules, a check or a shared part (components, styles) changes; put them on one sheet and look at them together. A check that passes on new work but fails or skips on earlier work held only the case it was written for.',
    '',
    '## Worklist',
    '',
    '| R | key | Rule | Where | Check or review | Check |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rules.map(
      (r) =>
        `| ${r.id} | \`${cell(r.rule.id)}\` | ${cell(r.rule.text)} | ${cell(r.rule.context)} | ${covered.has(r.rule.id) ? 'check' : ''} | ${covered.has(r.rule.id) ? `${CHECK_SCRIPT_FILE}: ${covered.get(r.rule.id)?.join(', ')}` : ''} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}
