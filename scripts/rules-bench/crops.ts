// Do close-ups help the reading (D96)? The crop benchmark reads each case's notes two ways,
// with words only, as Pinch reads today, and with each note's close-up as well, and has a
// judge, playing the designer with the key, score each.
//
//   ANTHROPIC_API_KEY=… NODE_PATH=<a node_modules holding playwright> node --import tsx scripts/rules-bench/crops.ts [out-dir] [runs]
//
// The screens in `crop-cases.ts` are drawn in Chromium at 1280px wide. A note's close-up is the
// window Pinch's own `cropRect` gives for its mark, with the mark drawn on (a ring for a dot,
// a box for an area), as a JPEG. Each case is read `runs` times each way (default 3), the call
// the route makes otherwise. The judge is told what each note meant, never which way read it,
// and scores each note (stated right, read right and marked as a reading, asked with the right
// answer among the options, asked without it, read wrong, left out), then lists the claims the
// designer didn't make. Writes the close-ups, readings.json and crops.md to out-dir. A few
// dollars a run.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { costUsd } from "../../src/lib/budget"
import {
  type CleanReading,
  cleanReading,
  learnPrompt,
  learnSchema,
  learnSystem,
} from "../../src/lib/pin/learn"
import { cropRect, type Shape } from "../../src/lib/pin/model"
import { CROP_CASES, type CropCase } from "./crop-cases"

// Playwright isn't one of Pinch's dependencies: the script takes it from NODE_PATH, typed only
// as far as it is used here.
type Page = {
  setContent(html: string): Promise<void>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>
  screenshot(o: {
    clip: { x: number; y: number; width: number; height: number }
    type: "jpeg"
    quality: number
  }): Promise<Buffer>
}
const { chromium } = require("playwright") as {
  chromium: {
    launch(): Promise<{
      newPage(o: {
        viewport: { width: number; height: number }
        deviceScaleFactor: number
      }): Promise<Page>
      close(): Promise<void>
    }>
  }
}

const MODEL = "claude-opus-5-5"
const out = process.argv[2] ?? "crop-bench-results"
const runs = Number(process.argv[3] ?? 3)
mkdirSync(out, { recursive: true })
const client = new Anthropic()
let spent = 0

type Way = "words" | "crops"
const WAYS: Way[] = ["words", "crops"]

/** Each note's close-up as Pinch would cut it, with its mark drawn on. */
async function closeUps(c: CropCase): Promise<Map<string, Buffer>> {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  })
  await page.setContent(c.html)
  const size = await page.evaluate(
    () => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }),
    null,
  )
  await page.setViewportSize({ width: size.w, height: size.h })
  const shots = new Map<string, Buffer>()
  for (const n of c.notes) {
    // A dot sits on the element's words, an area just outside the element.
    const box = await page.evaluate(
      ({ selector, mark }) => {
        const el = document.querySelector(selector)
        if (!el) return null
        const range = document.createRange()
        range.selectNodeContents(el)
        const r =
          mark === "dot"
            ? range.getBoundingClientRect()
            : el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      },
      { selector: n.selector, mark: n.mark },
    )
    if (!box) throw new Error(`${c.id} ${n.id}: nothing at ${n.selector}`)
    const shape: Shape =
      n.mark === "dot"
        ? {
            kind: "dot",
            x: (box.x + box.w / 2) / size.w,
            y: (box.y + box.h / 2) / size.h,
          }
        : {
            kind: "area",
            x: (box.x - 6) / size.w,
            y: (box.y - 6) / size.h,
            w: (box.w + 12) / size.w,
            h: (box.h + 12) / size.h,
          }
    await page.evaluate(
      ({ shape, w, h }) => {
        const m = document.createElement("div")
        m.id = "pinch-mark"
        Object.assign(m.style, {
          position: "absolute",
          border: "3px solid #2563eb",
          boxShadow: "0 0 0 2px #fff",
          pointerEvents: "none",
          zIndex: "9999",
          ...(shape.kind === "dot"
            ? {
                left: `${Math.round(shape.x * w - 18)}px`,
                top: `${Math.round(shape.y * h - 18)}px`,
                width: "36px",
                height: "36px",
                borderRadius: "50%",
              }
            : shape.kind === "area"
              ? {
                  left: `${Math.round(shape.x * w)}px`,
                  top: `${Math.round(shape.y * h)}px`,
                  width: `${Math.round(shape.w * w)}px`,
                  height: `${Math.round(shape.h * h)}px`,
                  borderRadius: "4px",
                }
              : {}),
        })
        document.body.appendChild(m)
      },
      { shape, w: size.w, h: size.h },
    )
    const r = cropRect(shape, size.w, size.h)
    shots.set(
      n.id,
      await page.screenshot({
        clip: { x: r.x, y: r.y, width: r.w, height: r.h },
        type: "jpeg",
        quality: 85,
      }),
    )
    await page.evaluate(
      () => document.getElementById("pinch-mark")?.remove(),
      null,
    )
  }
  await browser.close()
  return shots
}

const CROP_NOTE =
  "Each note's close-up follows, after its id: the part of the screen the note is about, with its spot marked in blue (a ring for a point, a box for an area). Use it to see what the note's words point at. Take from it only what the note judges: never a size, colour or detail the note doesn't speak to."

type Read = {
  caseId: string
  way: Way
  run: number
  reading: CleanReading
  usd: number
  input: number
  output: number
}

/** One reading of a case's notes, as the route makes it, with or without the close-ups. */
async function read(
  c: CropCase,
  way: Way,
  run: number,
  shots: Map<string, Buffer>,
): Promise<Read> {
  const notes = c.notes.map(({ selector, mark, kind, meant, ...n }) => n)
  const text = learnPrompt({ notes, rules: [] })
  const content =
    way === "words"
      ? text
      : [
          { type: "text" as const, text: `${text}\n\n${CROP_NOTE}` },
          ...c.notes.flatMap((n) => [
            { type: "text" as const, text: `${n.id}:` },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data: (shots.get(n.id) as Buffer).toString("base64"),
              },
            },
          ]),
        ]
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(learnSchema),
    },
    system: [
      { type: "text", text: learnSystem, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content }],
  })
  const usd = costUsd(r.model, r.usage)
  spent += usd
  if (!r.parsed_output) throw new Error(`no reading (${r.stop_reason})`)
  return {
    caseId: c.id,
    way,
    run,
    reading: cleanReading(
      r.parsed_output,
      notes.map((n) => n.id),
      [],
    ),
    usd,
    input:
      (r.usage.input_tokens ?? 0) +
      (r.usage.cache_creation_input_tokens ?? 0) +
      (r.usage.cache_read_input_tokens ?? 0),
    output: r.usage.output_tokens ?? 0,
  }
}

/** A reading as the judge sees it: each rule, the notes it draws on, its reading or question. */
function shown(reading: CleanReading): string {
  if (!reading.propose.length) return "No rules."
  return reading.propose
    .map((p, i) =>
      [
        `Rule ${i + 1} (from ${p.notes.join(", ")}): ${p.rule}`,
        p.context ? `  Where: ${p.context}` : "",
        p.basis === "interpreted"
          ? `  Marked as Pinch's reading${p.reading ? `: ${p.reading}` : ""}`
          : "",
        p.question
          ? `  Waits on a question: ${p.question.ask}\n${p.question.options.map((o) => `    - ${o.answer}: ${o.rule}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

const HANDLINGS = [
  "stated right",
  "reading right",
  "asked, an option right",
  "asked, no option right",
  "wrong",
  "left out",
] as const
const RIGHT: readonly string[] = HANDLINGS.slice(0, 3)
const judgement = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      handling: z.enum(HANDLINGS),
      why: z.string(),
    }),
  ),
  unsupported: z.array(z.object({ rule: z.string(), claim: z.string() })),
})

/** The designer, with the key, scores a reading without being told how it was made. */
async function judge(c: CropCase, set: string) {
  const r = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(judgement) },
    messages: [
      {
        role: "user",
        content: `You are ${c.designer.toLowerCase()}. You wrote these notes on screenshots of your product; under each is what you meant, which the tool never saw.

${c.notes.map((n) => `${n.id}: ${[n.works && `works: ${n.works}`, n.doesNotWork && `doesn't work: ${n.doesNotWork}`].filter(Boolean).join("; ")}\n  You meant: ${n.meant}`).join("\n")}

A tool turned your notes into rules for an AI agent:

${set}

For each note, say how the rules handle what you meant:
- stated right: a rule states it as a fact, and an agent following it would do what you meant;
- reading right: the same, but marked as the tool's reading of your words;
- asked, an option right: a question about it waits for you, and one of its answers means what you meant;
- asked, no option right: a question about it waits, and no answer means what you meant;
- wrong: a rule draws on the note but says something you didn't mean or misses its point;
- left out: no rule or question draws on it.

Then list every claim in the rules that you didn't make or mean: an invented size, colour, count or element, a rule wider than you meant, a guess stated as yours. A reading marked as the tool's, or a question, isn't a claim; a rule stated as fact is.`,
      },
    ],
  })
  spent += costUsd(r.model, r.usage)
  if (!r.parsed_output) throw new Error(`no judgement (${r.stop_reason})`)
  return r.parsed_output
}

/** At most `n` jobs at once. */
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

async function main() {
  const shots = new Map<string, Map<string, Buffer>>()
  for (const c of CROP_CASES) {
    const s = await closeUps(c)
    shots.set(c.id, s)
    for (const [id, jpeg] of s)
      writeFileSync(path.join(out, `${c.id}-${id}.jpg`), jpeg)
  }
  const reads = await pool(
    CROP_CASES.flatMap((c) =>
      WAYS.flatMap((way) =>
        Array.from(
          { length: runs },
          (_, run) => () =>
            read(c, way, run, shots.get(c.id) as Map<string, Buffer>),
        ),
      ),
    ),
  )
  console.log(`read, $${spent.toFixed(2)} so far`)
  const judged = await pool(
    reads.map((rd) => async () => {
      const c = CROP_CASES.find((x) => x.id === rd.caseId) as CropCase
      return { ...rd, judgement: await judge(c, shown(rd.reading)) }
    }),
  )
  writeFileSync(
    path.join(out, "readings.json"),
    JSON.stringify(judged, null, 2),
  )
  console.log(`judged, $${spent.toFixed(2)} in all`)

  const kindOf = (caseId: string, id: string) =>
    CROP_CASES.find((c) => c.id === caseId)?.notes.find((n) => n.id === id)
      ?.kind
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  const lines = [
    "# Close-ups in the reading",
    "",
    `${MODEL}, ${runs} reading(s) a case each way, $${spent.toFixed(2)} in all.`,
    "",
    "| Way | Right: precise | Right: vague | Right: spot | Asked, no option right | Wrong | Left out | Unsupported a reading | Input tokens | Per reading |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const way of WAYS) {
    const js = judged.filter((j) => j.way === way)
    const all = js.flatMap((j) =>
      j.judgement.notes.map((n) => ({ ...n, kind: kindOf(j.caseId, n.id) })),
    )
    const right = (kind: string) => {
      const of = all.filter((n) => n.kind === kind)
      return `${of.filter((n) => RIGHT.includes(n.handling)).length}/${of.length}`
    }
    const count = (h: string) => all.filter((n) => n.handling === h).length
    lines.push(
      `| ${way} | ${right("precise")} | ${right("vague")} | ${right("spot")} | ${count("asked, no option right")} | ${count("wrong")} | ${count("left out")} | ${mean(js.map((j) => j.judgement.unsupported.length)).toFixed(1)} | ${Math.round(mean(js.map((j) => j.input))).toLocaleString("en")} | $${mean(js.map((j) => j.usd)).toFixed(3)} |`,
    )
  }
  lines.push("", "Per note, how each way handled it, run by run:", "")
  for (const c of CROP_CASES)
    for (const n of c.notes)
      lines.push(
        `- ${c.id} ${n.id} (${n.kind}) ${WAYS.map(
          (way) =>
            `${way}: ${judged
              .filter((j) => j.caseId === c.id && j.way === way)
              .map(
                (j) =>
                  j.judgement.notes.find((x) => x.id === n.id)?.handling ??
                  "not judged",
              )
              .join(", ")}`,
        ).join("; ")}`,
      )
  writeFileSync(path.join(out, "crops.md"), `${lines.join("\n")}\n`)
  console.log(lines.join("\n"))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
