import { z } from 'zod';
import { fingerprint } from './hash';
import type { Collection, ExportedRule } from './learnings';

/**
 * Render checks (D109): a few numbers a script can hold on any rendered page (the smallest text,
 * text contrast, colours to avoid, the fonts allowed, fonts to avoid (D112), how many type sizes),
 * each tied to the rules it comes from. Pinch's AI works them out from the rules' words and their notes, in the
 * background whenever the rules change; the author never sees them. They go into the package
 * (`checks.json`, run by `check-render.js`) for the agent. Pure: the request, the answer,
 * tidying, and the collection's checks.
 */

export type CheckKind =
  | 'textSize'
  | 'contrast'
  | 'bannedColours'
  | 'fonts'
  | 'bannedFonts'
  | 'typeSizes';

export const CHECK_KINDS: readonly CheckKind[] = [
  'textSize',
  'contrast',
  'bannedColours',
  'fonts',
  'bannedFonts',
  'typeSizes',
];

/** What each check is called, what its number means, and what the script does with it. */
export const CHECK_INFO: Record<
  CheckKind,
  { label: string; unit: string; list: boolean; holds: string }
> = {
  textSize: {
    label: 'Smallest text',
    unit: 'px at display size, at least',
    list: false,
    holds: 'Every visible text is at least this size, after scaling to the size it is shown at.',
  },
  contrast: {
    label: 'Text contrast',
    unit: 'to 1, at least',
    list: false,
    holds: 'Every visible text contrasts with its background at least this much (WCAG ratio).',
  },
  bannedColours: {
    label: 'Colours to avoid',
    unit: 'hex colours',
    list: true,
    holds: 'No text, background or border uses one of these colours, or one very close to it.',
  },
  fonts: {
    label: 'Fonts',
    unit: 'font families allowed',
    list: true,
    holds: 'Every visible text is set in one of these families.',
  },
  bannedFonts: {
    label: 'Fonts to avoid',
    unit: 'font families',
    list: true,
    holds: 'No visible text is set in one of these families.',
  },
  typeSizes: {
    label: 'Type sizes',
    unit: 'different sizes, at most',
    list: false,
    holds: 'A render uses no more than this many different text sizes.',
  },
};

/** A check as the collection keeps it: one per kind. `rules` are the rules' ids. */
export type Check = {
  kind: CheckKind;
  value: number | string[];
  rules: string[];
  /** One sentence on where the number comes from, and whether it is an estimate. */
  why: string;
};

/** The collection's checks, with the rules they were worked out from, as a fingerprint. */
export type Checks = { basis: string; at: string; list: Check[] };

const LIMITS: Partial<Record<CheckKind, { min: number; max: number; step: number }>> = {
  textSize: { min: 6, max: 64, step: 0.5 },
  contrast: { min: 1, max: 21, step: 0.1 },
  typeSizes: { min: 2, max: 20, step: 1 },
};

/** A hex colour as "#rrggbb", or '' when it isn't one. */
export function hexOf(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/^#?/, '#');
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((d) => d + d).join('')}`;
  return '';
}

/** A check's value tidied to what the script can hold, or null when nothing usable is left. */
export function cleanValue(kind: CheckKind, raw: unknown): number | string[] | null {
  const limit = LIMITS[kind];
  if (limit) {
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const stepped = Math.round(n / limit.step) * limit.step;
    return Math.min(limit.max, Math.max(limit.min, Number(stepped.toFixed(1))));
  }
  const items = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((x) => String(x))
    .map((x) =>
      kind === 'bannedColours' ? hexOf(x) : x.replace(/["']/g, '').replace(/\s+/g, ' ').trim(),
    )
    .filter((x) => x && x.length <= 40);
  const once = items.filter(
    (x, i) => items.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i,
  );
  const kept = once.slice(0, kind === 'bannedColours' ? 20 : 8);
  return kept.length ? kept : null;
}

/** The value as the author edits it: "12" or "#1f3a93, #0b2a6f". */
export const valueText = (c: Pick<Check, 'value'>) =>
  Array.isArray(c.value) ? c.value.join(', ') : String(c.value);

// The request and the answer.

const MAX_RULES = 400;
export const checksRequestSchema = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().max(40),
        text: z.string().max(400),
        where: z.string().max(200).optional(),
        notes: z.array(z.string().max(300)).max(6).optional(),
      }),
    )
    .min(1)
    .max(MAX_RULES),
});
export type ChecksRequest = z.infer<typeof checksRequestSchema>;

export const checksSchema = z.object({
  checks: z
    .array(
      z.object({
        kind: z.enum([
          'textSize',
          'contrast',
          'bannedColours',
          'fonts',
          'bannedFonts',
          'typeSizes',
        ]),
        number: z
          .number()
          .nullable()
          .describe(
            'For textSize (px), contrast (ratio to 1) and typeSizes (a count): the number. Null for the two lists.',
          ),
        list: z
          .array(z.string())
          .describe(
            'For bannedColours: hex colours like "#1f3a93". For fonts and bannedFonts: family names. Empty for the three numbers.',
          ),
        rules: z
          .array(z.string())
          .describe('The ids of the rules this check holds, exactly as given.'),
        why: z
          .string()
          .describe(
            'One plain sentence for the agent that runs the check: where the number comes from, and whether it is read from the rules or estimated.',
          ),
      }),
    )
    .describe('At most one check per kind; leave a kind out when no rule supports it.'),
});

export const checksSystem = `You turn a designer's rules into a few numbers a script can check on any rendered page. Each rule is one sentence of their taste, with the notes it came from. The script can check six things, and only these:
- textSize: the smallest size any visible text may be, in px at the size the design is shown.
- contrast: the lowest contrast ratio (WCAG, to 1) any text may have with its background.
- bannedColours: colours no text, background or border may use, as hex.
- fonts: the font families text may be set in.
- bannedFonts: font families no text may be set in, such as a typeface the rules call legacy.
- typeSizes: the most different text sizes one design may use.

Propose a check only where the rules support it, and give the ids of the rules it holds. Take numbers from the rules' and notes' own words where they give them. Where they don't (for example "text is too small for UI mocks", or "avoid this dark navy blue, it's legacy"), estimate a number that would hold the rule, and say in "why" that it's an estimate; never make a check stricter than the rules ask for. Leave out a kind no rule supports. A rule drawn from another product's design is a principle, not a colour or font to ban or require. Write "why" in plain words, one sentence, without naming products or companies.`;

/** The rules, each with its place and notes, as the model reads them. */
export const checksPrompt = (rules: ChecksRequest['rules']) =>
  rules
    .map((r) =>
      [
        `${r.id}: ${r.text.trim()}${r.where?.trim() ? ` (where: ${r.where.trim()})` : ''}`,
        ...(r.notes ?? []).map((n) => `  - ${n.replace(/\s+/g, ' ').trim()}`),
      ].join('\n'),
    )
    .join('\n');

/** The model's checks kept to the kinds and rules asked about, one per kind, values tidied. */
export function cleanChecks(r: z.infer<typeof checksSchema>, ids: readonly string[]): Check[] {
  const out: Check[] = [];
  for (const c of r.checks) {
    if (!CHECK_KINDS.includes(c.kind) || out.some((x) => x.kind === c.kind)) continue;
    const value = cleanValue(c.kind, CHECK_INFO[c.kind].list ? c.list : c.number);
    const rules = [...new Set(c.rules.filter((id) => ids.includes(id)))];
    if (value === null || !rules.length) continue;
    out.push({ kind: c.kind, value, rules, why: c.why.replace(/\s+/g, ' ').trim().slice(0, 300) });
  }
  return out;
}

/** What the page sends: every rule it keeps, each with its place and up to six notes' words. */
export function checksRequest(rules: ExportedRule[]): ChecksRequest['rules'] {
  return rules.slice(0, MAX_RULES).map((r) => ({
    id: r.rule.id,
    text: r.rule.text.replace(/\s+/g, ' ').trim().slice(0, 400),
    ...(r.rule.context.trim() ? { where: r.rule.context.trim().slice(0, 200) } : {}),
    notes: r.notes
      .slice(0, 6)
      .map(({ note }) =>
        [
          note.works.trim() && `works: ${note.works.trim()}`,
          note.doesNotWork.trim() && `doesn't: ${note.doesNotWork.trim()}`,
        ]
          .filter(Boolean)
          .join('; ')
          .replace(/\s+/g, ' ')
          .slice(0, 300),
      ),
  }));
}

// The collection's checks.

/**
 * A fingerprint of what the checks are worked out from (FNV-1a over the request), so they are
 * asked for again only when the rules or their notes change.
 */
export function checksBasis(rules: ChecksRequest['rules']): string {
  return `${rules.length}-${fingerprint(JSON.stringify(rules))}`;
}

/** The checks in the usual order. */
export const checksOf = (c: Collection): Check[] =>
  CHECK_KINDS.flatMap((k) => c.checks?.list.find((x) => x.kind === k) ?? []);

/** Whether the checks were worked out from other rules than these, or never. */
export const checksStale = (c: Collection, basis: string) => c.checks?.basis !== basis;

/** The collection with checks worked out from the rules `basis` names, replacing any before. */
export const withChecks = (
  c: Collection,
  list: Check[],
  basis: string,
  now: string,
): Collection => ({
  ...c,
  updatedAt: now,
  checks: {
    basis,
    at: now,
    list: CHECK_KINDS.flatMap((k) => list.find((x) => x.kind === k) ?? []),
  },
});

/** `checks.json`: the checks, each with the rules it holds by number and lasting key. */
export function checksManifest(c: Collection, rules: ExportedRule[], exportedAt: string) {
  const numbers = new Map(rules.map((r) => [r.rule.id, r.id]));
  return {
    tool: 'Pinch',
    kind: 'checks',
    version: 1,
    collection: c.name,
    exportedAt,
    workedOutAt: c.checks?.at ?? '',
    about:
      'Pinch worked these out from the rules, without the author setting the numbers. Where a number is an estimate, its "why" says so: read a failure as a likely break of the rules it names, and look at the render before changing it.',
    script: CHECK_SCRIPT_FILE,
    checks: checksOf(c).map((x) => ({
      kind: x.kind,
      value: x.value,
      holds: CHECK_INFO[x.kind].holds,
      rules: x.rules.flatMap((key) => {
        const id = numbers.get(key);
        return id ? [{ id, key }] : [];
      }),
      why: x.why,
    })),
  };
}

export const CHECKS_DATA_FILE = 'checks.json';
export const CHECK_SCRIPT_FILE = 'check-render.js';
