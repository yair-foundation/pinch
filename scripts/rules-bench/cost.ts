// What one reading of notes into rules costs (D96): the call `/api/pin/learn` makes, priced
// against libraries of 0, 50 and 200 rules with 1, 5 and 30 new notes.
//
//   ANTHROPIC_API_KEY=… node --import tsx scripts/rules-bench/cost.ts [out-dir] [runs]
//
// Each cell is read two ways, `runs` times (default 2), each run with its own notes:
// - `cold`: the call the route makes, its instructions marked for the cache (D97), behind a
//   fresh marker so nothing is cached yet: no one has read in the last five minutes;
// - `warm`: straight after `cold`, the same call with other notes: the instructions come from
//   the cache, the library doesn't, as the route caches only the instructions.
// Every attempt is kept, failed and unusable ones too: the SDK's own retries are off so each
// is counted, and an answer that is cut off or doesn't parse is paid for and read again, as
// the page would. The library is the cases' own rules topped up to 200 by a model once and
// kept in `cost-library.json`, so every run reads the same one. Writes `cost.json` and
// `cost.md` to out-dir. Costs a few dollars a run.
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { costUsd } from "../../src/lib/budget"
import {
  type LearnNote,
  type LibraryRule,
  learnPrompt,
  learnSchema,
  learnSystem,
} from "../../src/lib/pin/learn"
import { TOPIC_KINDS, type Topic } from "../../src/lib/pin/model"
import { CASES } from "./cases"

const MODEL = "claude-opus-5-5"
const out = process.argv[2] ?? "cost-bench-results"
const runs = Number(process.argv[3] ?? 2)
mkdirSync(out, { recursive: true })
const client = new Anthropic({ maxRetries: 0, timeout: 10 * 60 * 1000 })

const LIBRARIES = [0, 50, 200]
const NOTE_COUNTS = [1, 5, 30]
type Way = "cold" | "warm"
const WAYS: Way[] = ["cold", "warm"]

/** A fixed shuffle, so a run reads the same notes every time. */
function shuffled<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Every case's notes, renumbered so their ids don't clash. */
const NOTES: LearnNote[] = CASES.flatMap((c) => c.notes).map((n, i) => ({
  ...n,
  id: `n${i + 1}`,
}))

const LIBRARY_FILE = path.join(__dirname, "cost-library.json")
const AREAS = [
  "dashboards, data tables and charts",
  "onboarding, empty states and settings",
  "forms, checkout, errors and notifications",
  "marketing pages, navigation and mobile screens",
]
const made = z.object({
  rules: z.array(
    z.object({
      rule: z.string(),
      context: z.string(),
      topics: z.array(z.string()),
      basis: z.string(),
      question: z.string(),
    }),
  ),
})

/** A full library, made once: the cases' rules, then rules a model writes in their style. */
async function library(): Promise<LibraryRule[]> {
  if (existsSync(LIBRARY_FILE))
    return JSON.parse(readFileSync(LIBRARY_FILE, "utf8")) as LibraryRule[]
  const written = await Promise.all(
    AREAS.map(async (area) => {
      const r = await client.beta.messages.parse({
        model: "claude-sonnet-5-5",
        max_tokens: 16000,
        output_config: { format: betaZodOutputFormat(made) },
        messages: [
          {
            role: "user",
            content: `A product designer keeps a taste library: design rules an AI agent follows in their work, drawn from notes they wrote on screenshots over several months. Write 52 different rules such a library would hold about ${area}.

- rule: one sentence under 25 words telling the agent what to do, keeping the specifics a designer's note gives (counts, order, words) but no invented sizes or colours. Examples: "Lead pricing cards with a short headline that states the price." "Prefer compact headings with a clear size contrast against body text."
- context: where it holds in a few words ("in data tables"), or empty when it holds everywhere; about half are empty.
- topics: one to three of ${TOPIC_KINDS.join(", ")}, the main one first.
- basis: interpreted for about one in eight (a reading of vague words), stated for the rest.
- question: for about one in twenty-five, a short question the designer hasn't answered yet; empty for the rest.

Don't name products or companies.`,
          },
        ],
      })
      spent += costUsd(r.model, r.usage)
      return r.parsed_output?.rules ?? []
    }),
  )
  const rules: LibraryRule[] = shuffled(
    [
      ...CASES.flatMap((c) => c.library).map((r) => ({
        text: r.text,
        context: r.context,
        topics: r.topics,
        basis: r.basis ?? ("stated" as const),
        question: r.question ?? "",
      })),
      ...written.flat().map((r) => ({
        text: r.rule,
        context: r.context,
        topics: r.topics
          .filter((t): t is Topic =>
            (TOPIC_KINDS as readonly string[]).includes(t),
          )
          .slice(0, 3),
        basis:
          r.basis === "interpreted"
            ? ("interpreted" as const)
            : ("stated" as const),
        question: r.question,
      })),
    ],
    96,
  )
    .slice(0, 200)
    .map((r, i) => ({
      id: `r${i + 1}`,
      text: r.text,
      context: r.context,
      topics: r.topics,
      // About one in thirty dismissed: the page still sends those, so they aren't written again.
      status: i % 30 === 29 ? ("dismissed" as const) : ("approved" as const),
      ...(r.basis === "interpreted" ? { basis: r.basis } : {}),
      ...(r.question.trim() ? { question: r.question.trim() } : {}),
    }))
  if (rules.length < 200) throw new Error(`only ${rules.length} rules made`)
  writeFileSync(LIBRARY_FILE, `${JSON.stringify(rules, null, 2)}\n`)
  return rules
}

type Usage = {
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  thinking: number
}
type Attempt = {
  way: Way
  library: number
  notes: number
  run: number
  attempt: number
  ok: boolean
  usable: boolean
  error?: string
  model?: string
  stopReason?: string | null
  usage?: Usage
  usd: number
  seconds: number
}

let spent = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One reading as the route makes it, behind a marker; every attempt kept. */
async function read(
  way: Way,
  rules: LibraryRule[],
  notes: LearnNote[],
  marker: string,
  run: number,
): Promise<Attempt[]> {
  const prompt = learnPrompt({ notes, rules })
  const common = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: {
      effort: "medium" as const,
      format: betaZodOutputFormat(learnSchema),
    },
  }
  const call = () =>
    client.beta.messages.parse({
      ...common,
      system: [
        {
          type: "text",
          text: `${marker}\n\n${learnSystem}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    })
  const base = { way, library: rules.length, notes: notes.length, run }
  const attempts: Attempt[] = []
  for (let attempt = 1; attempt <= 4; attempt++) {
    const start = Date.now()
    try {
      const r = await call()
      const usd = costUsd(r.model, r.usage)
      spent += usd
      const usable = Boolean(r.parsed_output) && r.stop_reason !== "refusal"
      attempts.push({
        ...base,
        attempt,
        ok: true,
        usable,
        model: r.model,
        stopReason: r.stop_reason,
        usage: {
          input: r.usage.input_tokens ?? 0,
          cacheWrite: r.usage.cache_creation_input_tokens ?? 0,
          cacheRead: r.usage.cache_read_input_tokens ?? 0,
          output: r.usage.output_tokens ?? 0,
          thinking:
            (
              r.usage as {
                output_tokens_details?: { thinking_tokens?: number }
              }
            ).output_tokens_details?.thinking_tokens ?? 0,
        },
        usd,
        seconds: (Date.now() - start) / 1000,
      })
      // A refusal isn't asked again; an answer cut off or unparsed is, as the page would.
      if (usable || r.stop_reason === "refusal") return attempts
    } catch (e) {
      attempts.push({
        ...base,
        attempt,
        ok: false,
        usable: false,
        error:
          e instanceof Anthropic.APIError
            ? `${e.status ?? "network"} ${e.name}`
            : `unparsed: ${String(e).slice(0, 200)}`,
        usd: 0,
        seconds: (Date.now() - start) / 1000,
      })
      await sleep(2 ** attempt * 1000)
    }
  }
  return attempts
}

/** At most `n` jobs at once. */
async function pool<T>(jobs: (() => Promise<T>)[], n = 3): Promise<T[]> {
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

async function main() {
  const full = await library()
  const jobs = LIBRARIES.flatMap((size) =>
    NOTE_COUNTS.flatMap((count) =>
      Array.from({ length: runs }, (_, run) => async () => {
        const seed = size * 1000 + count * 10 + run
        const first = shuffled(NOTES, seed).slice(0, count)
        const second = shuffled(NOTES, seed + 5000).slice(0, count)
        const rules = full.slice(0, size)
        const marker = `Reading ${randomUUID()}`
        const attempts = [
          ...(await read("cold", rules, first, marker, run)),
          ...(await read("warm", rules, second, marker, run)),
        ]
        const done = attempts.filter((a) => a.usable).length
        console.log(
          `${size} rules, ${count} notes, run ${run + 1}: ${done}/2 read, ${attempts.length} attempts, $${spent.toFixed(2)} so far`,
        )
        return attempts
      }),
    ),
  )
  const attempts = (await pool(jobs)).flat()
  writeFileSync(
    path.join(out, "cost.json"),
    JSON.stringify({ model: MODEL, runs, attempts }, null, 2),
  )

  // The summary: per cell and way, what a usable reading cost with its retries, and the tokens
  // of its final attempt.
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN
  type Cell = {
    usd: number
    perNote: number
    usage: Usage
    seconds: number
    attempts: number
    failed: number
  }
  const cells = new Map<string, Cell>()
  const key = (way: Way, size: number, count: number) =>
    `${way} ${size} ${count}`
  for (const way of WAYS)
    for (const size of LIBRARIES)
      for (const count of NOTE_COUNTS) {
        const here = attempts.filter(
          (a) => a.way === way && a.library === size && a.notes === count,
        )
        const byRun = Array.from({ length: runs }, (_, run) =>
          here.filter((a) => a.run === run),
        )
        const finals = byRun
          .map((as) => as.find((a) => a.usable))
          .filter((a): a is Attempt => Boolean(a))
        const usd = mean(byRun.map((as) => as.reduce((s, a) => s + a.usd, 0)))
        const u = (k: keyof Usage) => mean(finals.map((a) => a.usage?.[k] ?? 0))
        cells.set(key(way, size, count), {
          usd,
          perNote: usd / count,
          usage: {
            input: u("input"),
            cacheWrite: u("cacheWrite"),
            cacheRead: u("cacheRead"),
            output: u("output"),
            thinking: u("thinking"),
          },
          seconds: mean(finals.map((a) => a.seconds)),
          attempts: here.length,
          failed: here.filter((a) => !a.usable).length,
        })
      }

  const usd = (n: number) =>
    Number.isNaN(n) ? "–" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`
  const int = (n: number) =>
    Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en")
  const lines: string[] = [
    `# What a reading costs`,
    "",
    `${MODEL}, ${runs} run(s) a cell, ${attempts.length} attempts, $${spent.toFixed(2)} in all. Tokens are the mean of each reading's final attempt; dollars include every attempt it took.`,
    "",
    "| Way | Rules | Notes | Input | Cache write | Cache read | Output (thinking) | Per reading | Per note | Seconds | Attempts (unusable) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const way of WAYS)
    for (const size of LIBRARIES)
      for (const count of NOTE_COUNTS) {
        const c = cells.get(key(way, size, count))
        if (!c) continue
        lines.push(
          `| ${way} | ${size} | ${count} | ${int(c.usage.input)} | ${int(c.usage.cacheWrite)} | ${int(c.usage.cacheRead)} | ${int(c.usage.output)} (${int(c.usage.thinking)}) | ${usd(c.usd)} | ${usd(c.perNote)} | ${Math.round(c.seconds)} | ${c.attempts} (${c.failed}) |`,
        )
      }

  // What 500 notes cost when read in readings of one size, or in a mix. The mix is an
  // assumption, not a measurement: half the notes read 30 at a time, 30% five at a time, 20% one
  // at a time.
  const PACK = 500
  const PATTERNS: { name: string; share: Record<number, number> }[] = [
    { name: "30 at a time", share: { 30: 1 } },
    { name: "5 at a time", share: { 5: 1 } },
    { name: "1 at a time", share: { 1: 1 } },
    {
      name: "mix (50% by 30, 30% by 5, 20% by 1)",
      share: { 30: 0.5, 5: 0.3, 1: 0.2 },
    },
  ]
  lines.push(
    "",
    `## ${PACK} notes`,
    "",
    "What reading a pack's notes costs, by how many go in each reading, against each library size. A pack at $19.99 brings about $18.49 after Lemon Squeezy's 5% + $0.50 (assumed).",
    "",
    `| Read | Way | ${LIBRARIES.map((s) => `${s} rules`).join(" | ")} |`,
    `| --- | --- | ${LIBRARIES.map(() => "---").join(" | ")} |`,
  )
  for (const p of PATTERNS)
    for (const way of WAYS)
      lines.push(
        `| ${p.name} | ${way} | ${LIBRARIES.map((size) =>
          usd(
            PACK *
              Object.entries(p.share).reduce(
                (s, [count, share]) =>
                  s +
                  share *
                    (cells.get(key(way, size, Number(count)))?.perNote ??
                      Number.NaN),
                0,
              ),
          ),
        ).join(" | ")} |`,
      )
  const failures = attempts.filter((a) => !a.ok)
  if (failures.length)
    lines.push(
      "",
      "Failed attempts:",
      "",
      ...failures.map(
        (a) =>
          `- ${a.way}, ${a.library} rules, ${a.notes} notes, run ${a.run + 1}: ${a.error}`,
      ),
    )
  writeFileSync(path.join(out, "cost.md"), `${lines.join("\n")}\n`)
  console.log(lines.join("\n"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
