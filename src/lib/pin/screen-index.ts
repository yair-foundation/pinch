import { checksOf } from './checks';
import type { Collection, ExportedNote, ExportedRule } from './learnings';
import { cleanScreenTag, SOURCES, type SourceKind, sourceLabel } from './model';
import type { ReviewList } from './review-sheets';

/**
 * The index of a rules package (D105): the screenshots' notes sorted by source and screen tag,
 * with counts, so an agent can tell which sets of notes match its task before it opens any.
 * Pure, like the rest of the package.
 */

/**
 * A screen tag compared across spellings: case, spacing, punctuation and a plural "s" don't
 * count, so "Marketing Assets - Unified Inbox", "marketing asset – unified inbox" and
 * "Price Optimiser" / "PriceOptimiser" are each one set. A tag with nothing to compare (no
 * letters or digits) is compared as typed.
 */
export function screenGroup(tag: string): string {
  const words = tag
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) =>
      /^[a-z]{4,}$/.test(w) && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w,
    );
  return words.join('') || tag.trim().toLowerCase();
}

/**
 * The product a screen tag belongs to (D130): its last part after a spaced dash or colon,
 * compared as a set is, with "-ise" read as "-ize". So "Marketing Asset - Multi-Calendar" and
 * "Multi-Calendar" are one product, and "Marketing Asset - Price Optimiser" and "PriceOptimizer"
 * too, while each set keeps its own role and brief. Used only to compare.
 */
export function productOf(tag: string): string {
  const parts = cleanScreenTag(tag).split(/\s+[-–—:]\s+/);
  return screenGroup(parts[parts.length - 1] || tag).replace(/is(e|er|ation|ing)/g, 'iz$1');
}

/**
 * The tags asked for with every set of the same products (D130): asking for a product's
 * screens as they are today brings its target style too, each with its own role.
 */
export function linkedTags(c: Collection, tags: readonly string[]): string[] {
  const want = new Set(tags.map(productOf));
  const more = screenNames(c)
    .all()
    .filter((t) => want.has(productOf(t)));
  return [...tags, ...more.filter((t) => !tags.some((x) => screenGroup(x) === screenGroup(t)))];
}

/** The other sets of a tag's product: "Marketing Asset - Multi-Calendar" for "Multi-Calendar". */
export const linksOf = (c: Collection, tag: string): string[] =>
  screenNames(c)
    .all()
    .filter((t) => productOf(t) === productOf(tag) && screenGroup(t) !== screenGroup(tag));

export type ScreenNames = {
  /** The name a set goes by: the spelling the author used most, the first met on a tie. */
  name: (tag: string) => string;
  /** The other spellings of the same set, most used first. */
  others: (tag: string) => string[];
  /** Every set once, by the name it goes by, the most used first. */
  all: () => string[];
};

/** How the collection's screen tags are named, each set under one spelling. */
export const screenNames = (c: Collection): ScreenNames =>
  screenNamesOf(c.batches.flatMap((b) => b.notes.flatMap((n) => n.screenTag ?? [])));

/**
 * How some screen tags are named, each set under the spelling used most (D105, D110): from a
 * collection's notes, or, for the tag field, the open images' tags with the collection's.
 */
export function screenNamesOf(tags: readonly string[]): ScreenNames {
  const spellings = new Map<string, Map<string, number>>();
  for (const raw of tags) {
    const tag = cleanScreenTag(raw);
    if (!tag) continue;
    const key = screenGroup(tag);
    const seen = spellings.get(key) ?? new Map<string, number>();
    seen.set(tag, (seen.get(tag) ?? 0) + 1);
    spellings.set(key, seen);
  }
  const ranked = (tag: string) =>
    [...(spellings.get(screenGroup(tag))?.entries() ?? [])]
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
  const total = (key: string) =>
    [...(spellings.get(key)?.values() ?? [])].reduce((n, k) => n + k, 0);
  return {
    name: (tag) => ranked(tag)[0] ?? cleanScreenTag(tag),
    others: (tag) => ranked(tag).slice(1),
    all: () =>
      [...spellings.keys()]
        .sort((a, b) => total(b) - total(a))
        .map((key) => ranked([...(spellings.get(key)?.keys() ?? [])][0])[0]),
  };
}

/** What a set of screenshots is for, as the author says (D110). */
export type ScreenRole = 'target' | 'today' | 'principle';

export const SCREEN_ROLES: { role: ScreenRole; label: string; means: string }[] = [
  { role: 'target', label: 'Target style', means: 'the target style: the look to aim for' },
  {
    role: 'today',
    label: 'How it looks today',
    means: 'how the product looks today: take what exists from it, not its look',
  },
  { role: 'principle', label: 'Principle only', means: 'principle only: take the idea, never the look' },
];

const roleInfo = (role: ScreenRole) => SCREEN_ROLES.find((r) => r.role === role);

/** The role the author gave a tag's set, whatever the tag's spelling. */
export const roleOf = (c: Pick<Collection, 'screenRoles'>, tag: string): ScreenRole | undefined =>
  c.screenRoles?.[screenGroup(tag)];

/** The collection with a set's role given, or taken away. */
export function withScreenRole(
  c: Collection,
  tag: string,
  role: ScreenRole | null,
  now: string,
): Collection {
  const key = screenGroup(tag);
  const { [key]: _, ...rest } = c.screenRoles ?? {};
  return { ...c, updatedAt: now, screenRoles: role ? { ...rest, [key]: role } : rest };
}

/** Every set of screenshots by its name, with how many notes it holds, the most first. */
export function screenSets(c: Collection): { name: string; notes: number }[] {
  const names = screenNames(c);
  const counts = new Map<string, number>();
  for (const b of c.batches)
    for (const n of b.notes) {
      const tag = cleanScreenTag(n.screenTag);
      if (tag) counts.set(screenGroup(tag), (counts.get(screenGroup(tag)) ?? 0) + 1);
    }
  return names.all().map((name) => ({ name, notes: counts.get(screenGroup(name)) ?? 0 }));
}

/**
 * The collection with one screen tag's set merged into another (D129): every note tagged with any
 * spelling of `from` takes `into`'s name, and the set's brief and role move to `into` where it has
 * none (its own win), as does the free plan's product. The same collection back when they are
 * the same set or `from` has no notes.
 */
export function withMergedTag(c: Collection, from: string, into: string, now: string): Collection {
  const gone = screenGroup(from);
  const kept = screenGroup(into);
  const name = cleanScreenTag(into);
  if (!name || gone === kept) return c;
  const moves = (n: { screenTag?: string }) =>
    Boolean(cleanScreenTag(n.screenTag)) && screenGroup(cleanScreenTag(n.screenTag)) === gone;
  if (!c.batches.some((b) => b.notes.some(moves))) return c;
  const carried = <T>(map: Record<string, T> | undefined) => {
    if (!map || map[gone] === undefined) return map;
    const { [gone]: moved, ...rest } = map;
    return rest[kept] === undefined ? { ...rest, [kept]: moved } : rest;
  };
  const briefs = carried(c.briefs);
  const screenRoles = carried(c.screenRoles);
  return {
    ...c,
    updatedAt: now,
    batches: c.batches.map((b) =>
      b.notes.some(moves)
        ? { ...b, notes: b.notes.map((n) => (moves(n) ? { ...n, screenTag: name } : n)) }
        : b,
    ),
    ...(briefs ? { briefs } : {}),
    ...(screenRoles ? { screenRoles } : {}),
    ...(c.freeProduct === gone ? { freeProduct: kept } : {}),
  };
}

/** The longest brief: a few sentences, enough for what a product is for and how it should feel. */
export const MAX_BRIEF = 600;

/**
 * The author's brief for a set of screenshots (D121): what the product or feature is for, who
 * uses it and how it should feel, whatever the tag's spelling. Empty when there is none.
 */
export const briefOf = (c: Pick<Collection, 'briefs'>, tag: string): string =>
  c.briefs?.[screenGroup(tag)] ?? '';

/** The collection with a set's brief written, or taken away when it is empty. */
export function withBrief(c: Collection, tag: string, brief: string, now: string): Collection {
  const key = screenGroup(tag);
  const text = brief.trim().slice(0, MAX_BRIEF);
  const { [key]: _, ...rest } = c.briefs ?? {};
  return { ...c, updatedAt: now, briefs: text ? { ...rest, [key]: text } : rest };
}

/**
 * The briefs written, each under its set's name, the sets with the most notes first: every one,
 * or the ones for the products of the screen tags asked for, so one brief serves a product's
 * screens today and its target style alike (D130). A brief for a set with no notes left stays out.
 */
export function briefsOf(c: Collection, tags?: readonly string[]): { tag: string; brief: string }[] {
  const asked = tags?.length ? new Set(tags.map(productOf)) : null;
  return screenSets(c).flatMap(({ name }) => {
    const brief = briefOf(c, name);
    return brief && (!asked || asked.has(productOf(name)))
      ? [{ tag: name, brief: brief.replace(/\s+/g, ' ') }]
      : [];
  });
}

/** The briefs as lines for an agent, under one line on what they are; none when there are none. */
export function briefsLines(c: Collection, tags?: readonly string[]): string[] {
  const briefs = briefsOf(c, tags);
  if (!briefs.length) return [];
  return [
    'The author’s brief for each product or feature, what it is for and how it should feel. Let it decide what the rules leave open; where a rule says otherwise, the rule wins:',
    ...briefs.map((b) => `- “${b.tag}”: ${b.brief}`),
  ];
}

/** A source's role is kept beside the tags' roles, under a key no tag can have (D111). */
const sourceKey = (source: SourceKind) => `source:${source}`;

/**
 * The role the author gave every screenshot of a source (D111): "everything from other
 * products is the target style". A tag's own role wins over it.
 */
export const sourceRoleOf = (
  c: Pick<Collection, 'screenRoles'>,
  source: SourceKind,
): ScreenRole | undefined => c.screenRoles?.[sourceKey(source)];

/** The collection with a source's role given, or taken away. */
export function withSourceRole(
  c: Collection,
  source: SourceKind,
  role: ScreenRole | null,
  now: string,
): Collection {
  const key = sourceKey(source);
  const { [key]: _, ...rest } = c.screenRoles ?? {};
  return { ...c, updatedAt: now, screenRoles: role ? { ...rest, [key]: role } : rest };
}

/** Every source that has notes, with how many, in the usual order. */
export function sourceSets(c: Collection): { source: SourceKind; notes: number }[] {
  const counts = new Map<SourceKind, number>();
  for (const b of c.batches)
    for (const n of b.notes) if (n.source) counts.set(n.source, (counts.get(n.source) ?? 0) + 1);
  return SOURCES.flatMap((s) => {
    const notes = counts.get(s.kind);
    return notes ? [{ source: s.kind, notes }] : [];
  });
}

/** Whether the author made someone else's product the target style, so "never copy" needs saying differently. */
export const outsideTarget = (c: Pick<Collection, 'screenRoles'>) =>
  (['competitor', 'other', 'concept'] as const).some((s) => sourceRoleOf(c, s) === 'target');

/**
 * What the role of someone else's product means to an agent (D111): the target style there is
 * the level and the look, never the product itself.
 */
export const OUTSIDE_TARGET =
  'Screenshots of someone else’s product that the author made the target style show the look to aim for: match their quality and look, never their product, brand or content.';

/**
 * What the agent does with taste the author settles with it in conversation (D117): it goes back
 * to Pinch, not only into the agent's own notes, so every agent and session gets it. Said in the
 * rules text, `design-rules.md` and `index.md`, beside the MCP server's own instructions.
 */
export const KEEP_IN_PINCH =
  "When the author settles something about their taste with you that these rules don't hold, or hold otherwise (a correction, a choice between two rules, a new preference), keep it in Pinch, not only in your own notes or files, so every agent and session gets it: ask whether to keep it, and on a yes call Pinch's propose_rule tool when you're connected to Pinch (it waits there for the author to keep or drop); otherwise ask them to add it in Pinch.";

/**
 * The rules as Pinch gives them now win over the agent's own notes of them (D118): an agent that
 * copies a rule into its notes or files keeps an old version when the author changes it. Said
 * wherever `KEEP_IN_PINCH` is.
 */
export const LIVE_RULES_WIN =
  "Your own notes or copies of these rules go stale when the author changes a rule: where they differ, the rules as Pinch gives them now win (get_design_rules when you're connected, otherwise the newest export), so update your notes to match.";

/**
 * What the agent's report ends with (D119): the calls only the author can make, so their answers
 * come back as rules through `KEEP_IN_PINCH`. Said wherever it is.
 */
export const OPEN_CALLS =
  "When you report on your work, end with the decisions that need the author's call, one line each with the options, after the rules you set aside: their answers are what to keep in Pinch.";

/**
 * How the agent reviews its own render (D126): what it shows first, then the rules against that,
 * so it doesn't see what the rules lead it to expect. In `checks.md` step 7, `index.md`'s reading
 * order and the MCP server's instructions.
 */
export const REVIEW_LINE =
  'Review each render in two passes. First write what it shows, without the rules: what is there, what draws the eye first, the sizes, colours and spacing as they are. Then go through the rules against that description, naming each rule a part keeps or breaks. Judged straight from the rules, a render shows what the rules lead you to expect.';

/**
 * How several pieces of work stay in step (D119): one tracker, and one agent per piece, with shared
 * parts changed one at a time. In `index.md` and the MCP server's instructions.
 */
export const WORKING_LINES = [
  "Keep one tracker that every agent and the author read and write: a row for each piece of work, with its render, the state of its checks and the decisions that need the author's call. Update your row whenever your piece changes.",
  'When several agents work at once, give each its own piece and folder. Change shared parts (components, styles, checks) one agent at a time, then check all earlier work again (`checks.md`, step 8).',
];

/** The roles given, as a sentence for an agent; '' when there are none. */
export function rolesLine(c: Collection): string {
  const given = [
    ...sourceSets(c).flatMap(({ source }) => {
      const role = sourceRoleOf(c, source);
      return role ? [`every ${sourceLabel(source)} screenshot is ${roleInfo(role)?.means}`] : [];
    }),
    ...screenSets(c).flatMap(({ name }) => {
      const role = roleOf(c, name);
      return role ? [`“${name}” is ${roleInfo(role)?.means}`] : [];
    }),
  ];
  if (!given.length) return '';
  return `The author gave these screenshots a role (a tag’s own role comes first): ${given.join('; ')}.${outsideTarget(c) ? ` ${OUTSIDE_TARGET}` : ''}`;
}

/** Where a rule was seen: the notes' sources, each with the screen tags on its screenshots. */
export type SeenOn = { source: SourceKind | null; tags: string[] };

/** The sources and screen tags a rule's notes come from, sources in the usual order. */
export function seenOn(notes: ExportedNote[], names: ScreenNames): SeenOn[] {
  const by = new Map<SourceKind | null, string[]>();
  for (const { note } of notes) {
    const tags = by.get(note.source) ?? [];
    const tag = cleanScreenTag(note.screenTag);
    if (tag && !tags.includes(names.name(tag))) tags.push(names.name(tag));
    by.set(note.source, tags);
  }
  const order = [...SOURCES.map((s) => s.kind), null];
  return order.filter((k) => by.has(k)).map((source) => ({ source, tags: by.get(source) ?? [] }));
}

/**
 * A rule's "seen on" in one line: "Ours (Co-pilot, Inbox); Other product", each tag with the
 * role the author gave its set, when `c` is given (D110): "Ours (Inbox, target style)".
 */
export const seenOnLine = (seen: SeenOn[], c?: Pick<Collection, 'screenRoles'>) =>
  seen
    .map((s) => {
      const sourceRole = c && s.source && sourceRoleOf(c, s.source);
      const who = `${s.source ? sourceLabel(s.source) : 'Source not set'}${sourceRole ? `, ${roleInfo(sourceRole)?.label.toLowerCase()}` : ''}`;
      const tags = s.tags.map((t) => {
        const role = c && roleOf(c, t);
        return role ? `${t}, ${roleInfo(role)?.label.toLowerCase()}` : t;
      });
      return tags.length ? `${who} (${tags.join('; ')})` : who;
    })
    .join('; ');

type Cell = {
  name: string;
  images: Set<string>;
  notes: number;
  works: number;
  doesNot: number;
  best: number;
  rules: number;
};

const NO_TAG = '(no tag)';
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `index.md`: the reading order, then every source with its sets of screenshots, by screen tag.
 * Counts are of the notes in every batch, whether or not a rule draws on them, and of the
 * rules that draw on each set.
 */
export function screenIndex(
  c: Collection,
  rules: ExportedRule[],
  stamp: string,
  reviews: ReviewList = [],
  /** Each batch's folder in the package, by batch id, for the best examples' close-ups. */
  folders: ReadonlyMap<string, string> = new Map(),
): string {
  const names = screenNames(c);
  const sources = new Map<SourceKind | null, Map<string, Cell>>();
  const cellOf = (source: SourceKind | null, tag: string | undefined) => {
    const sets = sources.get(source) ?? new Map<string, Cell>();
    sources.set(source, sets);
    const clean = cleanScreenTag(tag);
    const key = clean ? screenGroup(clean) : '';
    const have = sets.get(key) ?? {
      name: clean ? names.name(clean) : NO_TAG,
      images: new Set<string>(),
      notes: 0,
      works: 0,
      doesNot: 0,
      best: 0,
      rules: 0,
    };
    sets.set(key, have);
    return have;
  };
  let notes = 0;
  const images = new Set<string>();
  for (const b of c.batches)
    for (const n of b.notes) {
      const have = cellOf(n.source, n.screenTag);
      // By the number in its ref ("02" of "02.3"): two screenshots can share a file name.
      const image = `${b.id}/${n.ref.split('.')[0]}`;
      have.images.add(image);
      images.add(image);
      have.notes++;
      notes++;
      if (n.works.trim()) have.works++;
      if (n.doesNotWork.trim()) have.doesNot++;
      if (n.best) have.best++;
    }
  const best = c.batches.flatMap((b) =>
    b.notes.filter((n) => n.best).map((note) => ({ batch: b, note })),
  );
  const rulesOn = new Map<string, string[]>();
  for (const r of rules)
    for (const { batch, note } of r.notes) {
      const k = `${batch.id}/${note.ref}`;
      rulesOn.set(k, [...(rulesOn.get(k) ?? []), r.id]);
    }
  for (const r of rules) {
    const drawn = new Set<Cell>();
    for (const { note } of r.notes) drawn.add(cellOf(note.source, note.screenTag));
    for (const have of drawn) have.rules++;
  }

  const lines = [
    `# Index: ${c.name.replace(/\s+/g, ' ').trim()}`,
    '',
    `Exported from Pinch on ${stamp.slice(0, 10)}: ${plural(images.size, 'image')} with notes, ${plural(notes, 'note')}, ${plural(rules.length, 'rule')}. This page sorts the notes into sets by who made the design (Source) and what it shows (the screen tag, as the author typed it), so you can find the sets that match your task.`,
    '',
    '## Reading order',
    '',
    '1. Read `design-rules.md`. The rules are the author’s taste, and each one names the notes it comes from.',
    '2. Find the sets below that match your task: its product or feature in the tag, and the kind of design in the Source. Several tags often apply, such as the product itself, the kind of feature, and a general pool of the author’s own work.',
    '3. Read each matching set’s notes in `batches/`, the larger sets first.',
    reviews.length
      ? '4. Before you apply a rule, open the close-up behind it. A rule is one line; the close-up shows what the author saw. To look at many at once, open a batch’s review sheets (listed at the end): its close-ups with their notes beside them, nine to a sheet.'
      : '4. Before you apply a rule, open the close-up behind it. A rule is one line; the close-up shows what the author saw.',
    `5. The author’s target style is the sum of everything their notes say works, in every set and whatever its source. A note on what doesn’t work says what is wrong in its screenshot, and a few say it as what the author would prefer instead (“I prefer a white border”): look at the close-up, avoid what the screenshot does there and follow what the words ask for. Works and Doesn’t count the notes of each kind for each set. On the author’s own product (Ours), a note on what doesn’t work also says what not to carry over into new work. ${outsideTarget(c) ? `A design from someone else’s product gives a principle, never a copy, unless the author made it the target style. ${OUTSIDE_TARGET}` : 'A design from someone else’s product (Competitor, Other product, Concept) gives a principle, never a copy.'}${
      Object.keys(c.screenRoles ?? {}).length
        ? ' Where the author gave a set a role (the Role column, or a whole source in its heading), it says how to weigh that set, a tag’s own role first: Target style is the look to aim for; How it looks today shows the product as it is, so take what exists from it, not its look; Principle only gives the idea, never the look.'
        : ''
    }`,
    ...(best.length
      ? [
          best.length === 1
            ? '6. The author marked 1 note as a best example: the one they hold up to follow. Weigh it above the others, and start from it (under Best examples).'
            : `6. The author marked ${best.length} notes as best examples: the ones they hold up to follow. Weigh them above the others, and start from them (listed under Best examples).`,
        ]
      : []),
    // The checks Pinch worked out come first, when there are any (D114).
    checksOf(c).length
      ? `${best.length ? 7 : 6}. Run the checks Pinch worked out from the rules on every render: \`checks.json\`, with \`check-render.js\` (\`checks.md\` shows how). Then turn the other rules a rendered page can decide into checks in your own project: \`checks.md\` says how, and lists every rule to sort. ${REVIEW_LINE}`
      : `${best.length ? 7 : 6}. Turn the rules a rendered page can decide into checks in your own project, so they hold on every render: \`checks.md\` says how, and lists every rule to sort. ${REVIEW_LINE}`,
    `${best.length ? 8 : 7}. ${KEEP_IN_PINCH} ${LIVE_RULES_WIN}`,
    `${best.length ? 9 : 8}. ${OPEN_CALLS}`,
    '',
    '## Working on many pieces',
    '',
    ...WORKING_LINES.map((l) => `- ${l}`),
    '',
    'A tag is one set whatever its case, spacing, punctuation or plural, so “Marketing Asset - Inbox” and “Marketing Assets - inbox” are counted together under the spelling used most. A tag that is a longer form of another (“Marketing Assets” and “Marketing Assets - Inbox”) is a set of its own.',
  ];
  const order = [...SOURCES.map((s) => s.kind), null];
  for (const source of order) {
    const sets = sources.get(source);
    if (!sets) continue;
    const all = [...sets.values()];
    const total = all.reduce((n, s) => n + s.notes, 0);
    const imgs = new Set(all.flatMap((s) => [...s.images])).size;
    lines.push(
      '',
      `## ${source ? sourceLabel(source) : 'Source not set'}${source && sourceRoleOf(c, source) ? ` · ${roleInfo(sourceRoleOf(c, source) as ScreenRole)?.label}` : ''}`,
      '',
      `${plural(imgs, 'image')}, ${plural(total, 'note')}.`,
      '',
      '| Screen tag | Role | Images | Notes | Works | Doesn’t | Best | Rules | Also typed as |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    );
    const rows = [...sets.entries()].sort(
      ([ka, a], [kb, b]) =>
        (ka === '' ? 1 : 0) - (kb === '' ? 1 : 0) || a.name.localeCompare(b.name),
    );
    for (const [key, s] of rows)
      lines.push(
        `| ${cell(s.name)} | ${(key ? roleInfo(roleOf(c, s.name) as ScreenRole)?.label : undefined) ?? (source ? (roleInfo(sourceRoleOf(c, source) as ScreenRole)?.label ?? '') : '')} | ${s.images.size} | ${s.notes} | ${s.works} | ${s.doesNot} | ${s.best} | ${s.rules} | ${key ? cell(names.others(s.name).join(', ')) : ''} |`,
      );
  }
  if (best.length) {
    lines.push(
      '',
      '## Best examples',
      '',
      'The notes the author holds up as the ones to follow, in batch order, each with its close-up and the rules that draw on it.',
      '',
    );
    for (const { batch, note } of best) {
      const about = [
        note.source ? sourceLabel(note.source) : '',
        note.screenTag ? names.name(note.screenTag) : '',
      ].filter(Boolean);
      const on = rulesOn.get(`${batch.id}/${note.ref}`) ?? [];
      const crop = folders.has(batch.id) ? `\`${folders.get(batch.id)}${note.crop}\`, ` : '';
      lines.push(
        `- ${crop}note ${note.ref} on ${cell(note.image)}${about.length ? ` (${cell(about.join('; '))})` : ''}: “${cell(note.works)}”${on.length ? ` (${on.join(', ')})` : ''}`,
      );
    }
  }
  if (reviews.length) {
    lines.push(
      '',
      '## Review sheets',
      '',
      'Each batch’s close-ups with their notes, nine to a sheet, in note order. A cell shows the close-up, its note number, whose design it is and its screen tag, what works and what doesn’t, and the rules that draw on it (“No rule yet” if none). Long notes are cut; `notes.json` in the batch has them whole.',
    );
    for (const r of reviews) {
      lines.push('', `**${r.folder.replace(/^batches\//, '').replace(/\/$/, '')}**`, '');
      for (const s of r.sheets) lines.push(`- \`${r.folder}${s.file}\`: notes ${s.notes}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
