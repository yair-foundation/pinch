// The rules benchmark (D90): the same annotated notes read three ways, then the guidance each
// way gives put to work on a fresh task.
//
//   ANTHROPIC_API_KEY=… node --import tsx scripts/rules-bench/run.ts [out-dir] [runs] [builds] [held-out]
//
// BENCH_VARIANTS=pretty,foundation (with builds 0) reads only those, to check a change to the
// reading's prompt against the one before it (D97); `pretty` is the prompt before D97.
//
// Stage 1 reads each case's notes with a plain Claude prompt, with Pinch as it was before the
// foundation (`baseline.ts`), and with Pinch as it is (`learn.ts`), `runs` times each (default
// 2). A judge, playing the designer with the case's key and never told which reading is which,
// scores each: explicit preferences carried, unsupported assumptions, corrections required.
// Stage 2 gives an agent each case's fresh task with no guidance, then with each reading's
// guidance as Pinch would hand it over, and with Pinch's after the designer answers its
// questions, `builds` times each (default 1); a second judge scores the work against the
// designer's whole taste (with `held-out`, only for the held-out cases). Results come per set of cases: those the foundation was tuned on and
// those held out. Everything lands in out-dir as JSON. Costs a few dollars a run.
//
// Stage 2 also puts generic guidance to work, the same for every designer: impeccable's design
// skill (`impeccable`), Pinch's own principles (`principles`), and impeccable with Pinch's rules
// (`impeccable and foundation`), as an agent with both would have them. BENCH_GUIDANCE picks the
// arms, e.g. BENCH_GUIDANCE="none,impeccable,principles,foundation,impeccable and foundation" with
// BENCH_VARIANTS=foundation reads only what those arms need.
import { mkdirSync, writeFileSync } from "node:fs"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { costUsd } from "../../src/lib/budget"
import { PRINCIPLES } from "../../src/lib/pin/foundation"
import {
  cleanReading,
  learnPrompt,
  learnSchema,
  learnSystem,
} from "../../src/lib/pin/learn"
import {
  applyReading,
  type Collection,
  type NoteRef,
  type Reading,
  type Rule,
  rulesOf,
  rulesText,
} from "../../src/lib/pin/learnings"
import { baselineSchema, baselineSystem, prettyPrompt } from "./baseline"
import { CASES, type Case } from "./cases"

const MODEL = "claude-opus-5-5"
const out = process.argv[2] ?? "rules-bench-results"
const runs = Number(process.argv[3] ?? 2)
const builds = Number(process.argv[4] ?? 1)
const buildHeldOutOnly = process.argv[5] === "held-out"
mkdirSync(out, { recursive: true })
const client = new Anthropic()
let spent = 0

type Variant = "plain" | "current" | "foundation" | "pretty"
const VARIANTS = (process.env.BENCH_VARIANTS?.split(",") ?? [
  "plain",
  "current",
  "foundation",
]) as Variant[]

/** Stage 2's arms: the guidance an agent builds with. */
type Guidance =
  | "none"
  | "plain"
  | "current"
  | "foundation"
  | "foundation, answered"
  | "impeccable"
  | "principles"
  | "impeccable and foundation"
const ARMS: Guidance[] = [
  "none",
  "plain",
  "current",
  "foundation",
  "foundation, answered",
  "impeccable",
  "principles",
  "impeccable and foundation",
]
// Split at commas, but not at the one in "foundation, answered".
const GUIDANCE = (process.env.BENCH_GUIDANCE?.split(/,(?! )/) ??
  ARMS) as Guidance[]
/** The reading each arm hands over, if it hands one over. */
const NEEDS: Partial<Record<Guidance, Variant>> = {
  plain: "plain",
  current: "current",
  foundation: "foundation",
  "foundation, answered": "foundation",
  "impeccable and foundation": "foundation",
}

// impeccable (github.com/pbakaus/impeccable, Apache 2.0), fetched at a pinned commit and never
// kept here: its skill's opening, "How to design" and "Modes", and its craft floor, which an agent
// with the skill reads before building. The skill's setup, commands and tools act on a project,
// not on one file, so they are left out.
const IMPECCABLE =
  "https://raw.githubusercontent.com/pbakaus/impeccable/dad8dbb3aac21ad1fa236c110315ef4abece23e8/.claude/skills/impeccable"

async function impeccable() {
  const get = async (path: string) => {
    const r = await fetch(`${IMPECCABLE}/${path}`)
    if (!r.ok) throw new Error(`impeccable ${path}: ${r.status}`)
    return r.text()
  }
  const [skill, floor] = await Promise.all([
    get("SKILL.md"),
    get("reference/craft-floor.md"),
  ])
  const design = skill
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split(/\n(?=## )/)
    .filter((s) => !s.startsWith("## ") || /^## (How to design|Modes)\n/.test(s))
    .join("\n")
  return `${design.trim()}\n\n${floor.trim()}`
}

/** Pinch's own foundation as guidance: each principle, where it applies and where it gives way. */
const principlesText = () =>
  PRINCIPLES.map(
    (p) =>
      `- ${p.name}: ${p.holds}. Applies to ${p.when}. Gives way in ${p.except}.`,
  ).join("\n")

/** At most `n` calls at once. */
async function pool<T>(jobs: (() => Promise<T>)[], n = 4): Promise<T[]> {
  const results: T[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < jobs.length) {
        const i = next++
        results[i] = await jobs[i]()
      }
    }),
  )
  return results
}

const noteLine = (n: Case["notes"][number]) =>
  `- ${n.id} (${n.label ?? "screen"}, ${n.source ?? "unknown"} design): ${[n.works && `works: ${n.works}`, n.doesNotWork && `doesn't work: ${n.doesNotWork}`].filter(Boolean).join("; ")}`

/** A plain Claude prompt: what someone would type without Pinch. */
async function plain(c: Case) {
  const library = c.library.length
    ? `The design rules I already keep:\n${c.library.map((r) => `- ${r.id}: ${r.text}`).join("\n")}\n\n`
    : ""
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    messages: [
      {
        role: "user",
        content: `${library}Turn these new notes I wrote on screenshots into design rules an AI agent can follow${c.library.length ? ", updating my rules where the notes say so" : ""}.\n\n${c.notes.map(noteLine).join("\n")}`,
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  return r.content.map((b) => (b.type === "text" ? b.text : "")).join("")
}

/** Pinch's reading, before the foundation (`current`), with it (`foundation`), or with it and the prompt before D97 (`pretty`). */
async function pinch(
  c: Case,
  variant: "current" | "foundation" | "pretty",
): Promise<Reading> {
  const request = { notes: c.notes, rules: c.library }
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(
        variant === "current" ? baselineSchema : learnSchema,
      ),
    },
    system: variant === "current" ? baselineSystem : learnSystem,
    messages: [
      {
        role: "user",
        content:
          variant === "pretty" ? prettyPrompt(request) : learnPrompt(request),
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  const parsed = r.parsed_output
  if (!parsed) throw new Error(`no reading (${r.stop_reason})`)
  const notes = c.notes.map((n) => n.id)
  const rules = c.library.map((l) => l.id)
  if (variant !== "current")
    return cleanReading(parsed as z.infer<typeof learnSchema>, notes, rules)
  // Before the foundation Pinch only kept ids it was given; nothing else changed.
  const known = (ids: string[]) => ids.filter((id) => notes.includes(id))
  return {
    strengthen: parsed.strengthen
      .filter((s) => rules.includes(s.rule))
      .map((s) => ({ ...s, notes: known(s.notes) })),
    propose: parsed.propose
      .map((p) => ({
        ...p,
        notes: known(p.notes),
        conflictsWith: rules.includes(p.conflictsWith) ? p.conflictsWith : "",
      }))
      .filter((p) => p.notes.length),
  }
}

/** A reading as the judge sees it: the same plain layout for both Pinch variants. */
function shown(c: Case, reading: Reading): string {
  const lines: string[] = []
  for (const s of reading.strengthen) {
    const lib = c.library.find((l) => l.id === s.rule)
    lines.push(
      `Library rule ${s.rule} ("${lib?.text}") is supported by new notes ${s.notes.join(", ")}.`,
    )
  }
  reading.propose.forEach((p, i) => {
    lines.push(
      `${i + 1}. ${p.rule}${p.context ? ` (where: ${p.context})` : ""} [from ${p.notes.join(", ")}]`,
    )
    if (p.basis === "interpreted")
      lines.push(
        `   Marked as an interpretation of vaguer words${p.reading ? `: ${p.reading}` : ""}`,
      )
    if (p.question)
      lines.push(
        `   Held back from the agent until the designer answers: "${p.question.ask}" Options: ${p.question.options.map((o, j) => `(${j + 1}) ${o.answer}: ${o.rule}`).join(" ")}`,
      )
    if (p.conflictsWith)
      lines.push(
        `   Flagged as conflicting with library rule ${p.conflictsWith}: ${p.conflict}`,
      )
    if (p.principles?.length)
      lines.push(
        `   Explained with design principles: ${p.principles
          .map((id) => PRINCIPLES.find((x) => x.id === id))
          .map((x) => `"${x?.name}" (${x?.holds})`)
          .join("; ")}`,
      )
  })
  return lines.join("\n")
}

/** The case as one collection: its library rules, one batch of its notes, then the reading. */
function collectionOf(c: Case, reading: Reading): Collection {
  const now = "2026-10-20T00:00:00.000Z"
  const library: Rule[] = c.library.map((l) => ({
    id: l.id,
    text: l.text,
    context: l.context,
    topics: l.topics,
    tags: [],
    evidence: [],
    status: "approved",
    createdAt: "2026-10-01T00:00:00.000Z",
  }))
  const base: Collection = {
    id: c.id,
    name: c.designer,
    createdAt: now,
    updatedAt: now,
    batches: [
      {
        id: "b1",
        name: "bench",
        addedAt: now,
        exportedAt: now,
        root: "bench/",
        images: c.notes.length,
        notes: c.notes.map((n) => ({
          ref: n.id,
          image: `${(n.label ?? "screen").toLowerCase().replace(/\s+/g, "-")}.png`,
          source: n.source ?? null,
          topics: n.topics,
          works: n.works,
          doesNotWork: n.doesNotWork,
          crop: `crops/${n.id}.jpg`,
        })),
      },
    ],
    rules: library,
    read: [],
  }
  const notes = new Map<string, NoteRef>(
    c.notes.map((n) => [n.id, { batchId: "b1", note: n.id }]),
  )
  let id = 0
  return applyReading(base, reading, notes, now, () => `x${++id}`)
}

const judgement = z.object({
  explicit: z.array(
    z.object({
      item: z
        .number()
        .describe("The number of the explicit preference in the key."),
      verdict: z.enum(["faithful", "distorted", "missing"]),
      why: z.string(),
    }),
  ),
  vague: z.array(
    z.object({
      item: z.number(),
      handling: z
        .enum([
          "asked, an option matches",
          "asked, no option matches",
          "interpretation marked, matches",
          "interpretation marked, wrong",
          "asserted, matches",
          "asserted, wrong",
          "dropped",
        ])
        .describe("How the rule set treats this vague note."),
      why: z.string(),
    }),
  ),
  context: z.array(
    z.object({ item: z.number(), kept: z.boolean(), why: z.string() }),
  ),
  conflicts: z.array(
    z.object({ item: z.number(), handled: z.boolean(), why: z.string() }),
  ),
  strengthen: z.array(
    z.object({ item: z.number(), handled: z.boolean(), why: z.string() }),
  ),
  nothing: z.array(z.object({ item: z.number(), keptOut: z.boolean() })),
  unsupported: z
    .array(z.object({ rule: z.string(), claim: z.string(), why: z.string() }))
    .describe(
      "Every claim the set asserts as the designer’s that their notes don’t support: an invented specific (a size, a count, a colour), a guessed meaning stated as fact, a generalisation wider than the notes, or a design principle cited to explain a rule when the notes show nothing it explains. Not a meaning the set marks as an interpretation or holds back as a question.",
    ),
  corrections: z
    .array(
      z.object({
        rule: z.string(),
        action: z.enum([
          "rewrite",
          "delete",
          "write a missing rule",
          "answer a question",
        ]),
        why: z.string(),
      }),
    )
    .describe(
      'What you, the designer, must do before handing this set to an agent. "answer a question" only when one of its options is what you meant (a click); otherwise "rewrite".',
    ),
})

const keyText = (c: Case) =>
  [
    "Explicit preferences your notes state:",
    ...c.key.explicit.map(
      (e, i) => `${i + 1}. ${e.want} (notes ${e.notes.join(", ")})`,
    ),
    "Vague notes, and what you meant (the words alone do not say it):",
    ...c.key.vague.map(
      (v, i) => `${i + 1}. Notes ${v.notes.join(", ")}: you meant: ${v.meant}`,
    ),
    "Notes that hold in different places:",
    ...c.key.context.map((x, i) => `${i + 1}. ${x}`),
    "Contradictions with your library:",
    ...(c.key.conflicts.length
      ? c.key.conflicts.map((x, i) => `${i + 1}. ${x}`)
      : ["(none)"]),
    "Library rules new notes support:",
    ...(c.key.strengthen.length
      ? c.key.strengthen.map((x, i) => `${i + 1}. ${x}`)
      : ["(none)"]),
    "Notes too vague to teach anything:",
    ...c.key.nothing.map((x, i) => `${i + 1}. ${x}`),
  ].join("\n")

/** The designer, with the key, scores one reading without knowing whose it is. */
async function judgeReading(c: Case, label: string, set: string) {
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(judgement) },
    system:
      "You are the designer who wrote these notes on screenshots, judging a set of design rules someone drew from them for your AI agent. You know what you meant (the key). Judge strictly and literally: a rule carries a preference only if an agent following it would do what you meant. Count every unsupported claim, however small. Where a set holds a rule back with a question, judge whether one of its options is what you meant.",
    messages: [
      {
        role: "user",
        content: `Your library before these notes:\n${c.library.map((l) => `- ${l.id}: ${l.text}`).join("\n") || "(empty)"}\n\nYour new notes:\n${c.notes.map(noteLine).join("\n")}\n\nThe key (what you meant):\n${keyText(c)}\n\nRule set ${label}:\n\n${set}\n\nScore it: one entry per key item in each list, numbered as in the key.`,
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  if (!r.parsed_output) throw new Error("no judgement")
  return r.parsed_output
}

/** For a question, the answer that is what the designer meant, if there is one. */
async function answerOf(c: Case, rule: Rule): Promise<number> {
  const q = rule.question
  if (!q) return -1
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 1000,
    output_config: {
      effort: "low",
      format: betaZodOutputFormat(
        z.object({ option: z.number().describe("1-based, or 0 for none") }),
      ),
    },
    messages: [
      {
        role: "user",
        content: `You are a designer. Your taste:\n${c.taste.map((t) => `- ${t}`).join("\n")}\n\nYour tool asks: "${q.ask}" about the rule "${rule.text}". Options:\n${q.options.map((o, i) => `${i + 1}. ${o.answer}: ${o.rule}`).join("\n")}\n\nWhich option is what you meant? 0 if none is.`,
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  const n = r.parsed_output?.option ?? 0
  return n >= 1 && n <= q.options.length ? n - 1 : -1
}

/** The designer answers every question: by its option when one is right, else in their own words. */
async function answered(c: Case, col: Collection) {
  let clicks = 0
  let written = 0
  const rules: Rule[] = []
  for (const r of col.rules) {
    if (!r.question) {
      rules.push(r)
      continue
    }
    const i = await answerOf(c, r)
    if (i >= 0) {
      clicks++
      rules.push({
        ...r,
        text: r.question.options[i].rule,
        question: undefined,
        reading: undefined,
        basis: "stated",
      })
    } else written++
  }
  return { col: { ...col, rules }, clicks, written }
}

/** The agent at work on the case's task, with general guidance, the designer's, both or none. */
async function build(
  c: Case,
  guidance: { general?: string; designer?: string },
) {
  const r = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 20000,
    output_config: { effort: "medium" },
    system:
      "You are a front-end engineer agent. Build what the task asks as one self-contained HTML file styled with Tailwind CSS from its CDN script. Reply with the HTML only.",
    messages: [
      {
        role: "user",
        content: [
          c.task,
          guidance.general &&
            `General design guidance:\n\n${guidance.general}`,
          guidance.designer &&
            `Design guidance from the designer you are working for:\n\n${guidance.designer}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  return r.content.map((b) => (b.type === "text" ? b.text : "")).join("")
}

const workJudgement = z.object({
  taste: z.array(
    z.object({
      item: z.number(),
      verdict: z.enum(["followed", "violated", "not applicable"]),
      evidence: z
        .string()
        .describe("The classes, markup or words that show it."),
    }),
  ),
  changes: z
    .array(z.string())
    .describe(
      "Each change you would ask the agent for before you accept this work, to match your taste.",
    ),
})

/** The designer scores the agent's work against their whole taste, not knowing its guidance. */
async function judgeWork(c: Case, html: string) {
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(workJudgement),
    },
    system:
      "You are a designer reviewing an AI agent’s work against your own taste. Read the HTML and its Tailwind classes closely. Judge each item of your taste strictly, from the markup.",
    messages: [
      {
        role: "user",
        content: `Your taste:\n${c.taste.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nThe task you gave: ${c.task}\n\nThe agent's work:\n\n${html.slice(0, 60_000)}`,
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  if (!r.parsed_output) throw new Error("no judgement")
  return r.parsed_output
}

const LABELS = ["K", "Q", "W"]

async function main() {
  // Check the arms and fetch impeccable before spending anything.
  const unknown = GUIDANCE.filter((g) => !ARMS.includes(g))
  if (unknown.length)
    throw new Error(`Unknown BENCH_GUIDANCE: ${unknown.join(", ")}`)
  const unread = builds
    ? GUIDANCE.flatMap((g) => NEEDS[g] ?? []).filter(
        (v) => !VARIANTS.includes(v),
      )
    : []
  if (unread.length)
    throw new Error(
      `BENCH_GUIDANCE needs these in BENCH_VARIANTS: ${[...new Set(unread)].join(", ")}`,
    )
  const general = {
    impeccable:
      builds && GUIDANCE.some((g) => g.startsWith("impeccable"))
        ? await impeccable()
        : "",
    principles: principlesText(),
  }

  // Stage 1: read, then judge blind.
  type Read = {
    caseId: string
    variant: Variant
    run: number
    set: string
    reading?: Reading
  }
  const reads = await pool(
    CASES.flatMap((c) =>
      VARIANTS.flatMap((variant) =>
        Array.from({ length: runs }, (_, run) => async (): Promise<Read> => {
          if (variant === "plain")
            return { caseId: c.id, variant, run, set: await plain(c) }
          const reading = await pinch(c, variant)
          return { caseId: c.id, variant, run, set: shown(c, reading), reading }
        }),
      ),
    ),
  )
  writeFileSync(`${out}/readings.json`, JSON.stringify(reads, null, 2))
  console.log(`stage 1 read, $${spent.toFixed(2)} so far`)

  const judged = await pool(
    reads.map((rd, i) => async () => {
      const c = CASES.find((x) => x.id === rd.caseId) as Case
      return {
        ...rd,
        label: LABELS[i % 3],
        judgement: await judgeReading(c, LABELS[i % 3], rd.set),
      }
    }),
  )
  writeFileSync(`${out}/judged.json`, JSON.stringify(judged, null, 2))
  console.log(`stage 1 judged, $${spent.toFixed(2)} so far`)

  // Stage 2: the first run's guidance at work on a fresh task.
  type Work = {
    caseId: string
    guidance: Guidance
    /** General guidance given with the designer's, if any. */
    general?: keyof typeof general
    text: string
    clicks?: number
    written?: number
  }
  const works: Work[] = []
  for (const c of builds > 0
    ? CASES.filter((x) => !buildHeldOutOnly || x.set === "held out")
    : []) {
    const first = (v: Variant) =>
      reads.find(
        (r) => r.caseId === c.id && r.variant === v && r.run === 0,
      ) as Read
    const asGiven = (v: "current" | "foundation") => {
      const col = collectionOf(c, first(v).reading as Reading)
      return rulesText(col, rulesOf(col))
    }
    for (const guidance of GUIDANCE) {
      const w = { caseId: c.id, guidance }
      if (guidance === "foundation, answered") {
        const after = await answered(
          c,
          collectionOf(c, first("foundation").reading as Reading),
        )
        works.push({
          ...w,
          text: rulesText(after.col, rulesOf(after.col)),
          clicks: after.clicks,
          written: after.written,
        })
      } else if (guidance === "plain")
        works.push({ ...w, text: first("plain").set })
      else if (guidance === "current" || guidance === "foundation")
        works.push({ ...w, text: asGiven(guidance) })
      else if (guidance === "impeccable" || guidance === "principles")
        works.push({ ...w, general: guidance, text: "" })
      else if (guidance === "impeccable and foundation")
        works.push({
          ...w,
          general: "impeccable",
          text: asGiven("foundation"),
        })
      else works.push({ ...w, text: "" })
    }
  }
  const built = await pool(
    works.flatMap((w) =>
      Array.from({ length: builds }, (_, run) => async () => {
        const c = CASES.find((x) => x.id === w.caseId) as Case
        const html = await build(c, {
          general: w.general && general[w.general],
          designer: w.text,
        })
        return { ...w, run, html, judgement: await judgeWork(c, html) }
      }),
    ),
  )
  writeFileSync(`${out}/work.json`, JSON.stringify(built, null, 2))
  console.log(`stage 2 done, $${spent.toFixed(2)} in all`)

  // The summary, per set of cases.
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
  const f1 = (n: number) => n.toFixed(1)
  const setOf = (id: string) => CASES.find((c) => c.id === id)?.set
  const right = [
    "asked, an option matches",
    "interpretation marked, matches",
    "asserted, matches",
  ]
  for (const set of ["tuning", "held out"] as const) {
    const inSet = judged.filter((j) => setOf(j.caseId) === set)
    if (!inSet.length) continue
    console.log(`\nStage 1, ${set} cases, mean per reading`)
    console.log(
      "variant | explicit faithful | unsupported | corrections | one-click answers | vague right | context kept | conflicts | strengthened",
    )
    for (const v of VARIANTS) {
      const js = inSet.filter((j) => j.variant === v).map((j) => j.judgement)
      const share = (f: (j: z.infer<typeof judgement>) => [number, number]) => {
        const [a, b] = js
          .map(f)
          .reduce((x, y) => [x[0] + y[0], x[1] + y[1]], [0, 0])
        return `${a}/${b}`
      }
      console.log(
        [
          v,
          share((j) => [
            j.explicit.filter((e) => e.verdict === "faithful").length,
            j.explicit.length,
          ]),
          f1(mean(js.map((j) => j.unsupported.length))),
          f1(
            mean(
              js.map(
                (j) =>
                  j.corrections.filter((x) => x.action !== "answer a question")
                    .length,
              ),
            ),
          ),
          f1(
            mean(
              js.map(
                (j) =>
                  j.corrections.filter((x) => x.action === "answer a question")
                    .length,
              ),
            ),
          ),
          share((j) => [
            j.vague.filter((x) => right.includes(x.handling)).length,
            j.vague.length,
          ]),
          share((j) => [
            j.context.filter((x) => x.kept).length,
            j.context.length,
          ]),
          share((j) => [
            j.conflicts.filter((x) => x.handled).length,
            j.conflicts.length,
          ]),
          share((j) => [
            j.strengthen.filter((x) => x.handled).length,
            j.strengthen.length,
          ]),
        ].join(" | "),
      )
    }
    const work = built.filter((b) => setOf(b.caseId) === set)
    if (!work.length) continue
    console.log(`\nStage 2, ${set} cases, the agent’s work on the fresh task`)
    console.log(
      "guidance | taste followed | violated | changes asked per build",
    )
    for (const g of GUIDANCE) {
      const js = work.filter((b) => b.guidance === g).map((b) => b.judgement)
      const count = (v: string) =>
        sum(js.map((j) => j.taste.filter((t) => t.verdict === v).length))
      const applicable = sum(
        js.map(
          (j) => j.taste.filter((t) => t.verdict !== "not applicable").length,
        ),
      )
      console.log(
        `${g} | ${count("followed")}/${applicable} | ${count("violated")} | ${f1(mean(js.map((j) => j.changes.length)))}`,
      )
    }
    const asked = works.filter(
      (w) => setOf(w.caseId) === set && w.guidance === "foundation, answered",
    )
    if (asked.length)
      console.log(
        `Questions answered by one click: ${sum(asked.map((b) => b.clicks ?? 0))}; needing the designer's own words: ${sum(asked.map((b) => b.written ?? 0))}`,
      )
  }
  console.log(`Cost: $${spent.toFixed(2)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
