// Can a judge predict the author's own blind picks? Trajectory's idea, a grader learned from one
// person's judgments, tested on the picks the hand-vs-Pinch sittings already hold, with no new
// judging from the author (docs/taste-harness.md). Each judged pair goes to each judge, twice with
// the sides swapped, in fresh Claude Code sessions:
//
//   taste     the author's notes (a Pinch export: words, marks, close-ups) and the two renders
//   criteria  the same, but it first writes the criteria the notes imply for this task, then judges
//             by them: Trajectory's graders written for each task, from the person's examples
//   generic   the two renders alone: which is the better design for the task
//
// PREDICT_JUDGES picks some of them (comma-separated); picks already asked for are kept.
//
// A judge's pick counts only when both orders agree; otherwise it is unsure, scored as half.
// Pairs the author called the same are left out. Writes predictions.json beside each folder's
// results.json, and prints each judge's agreement with the author.
//
//   node --import tsx scripts/hand-vs-pinch/predict.ts <notes.zip or folder> <test dir> [<test dir> …]
//
// A round's folder (round-1 inside a test) is a test dir of its own. CHROME names the browser that
// draws the pages, if it isn't Google Chrome on a Mac; renders already drawn are kept.
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzip } from "../../src/lib/pin/unzip"
import type { Answer, Pair } from "./plan"

const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const AT_ONCE = Number(process.env.AT_ONCE) || 4
const home = (p: string) =>
  path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"))

export type Judge = "taste" | "criteria" | "generic"
const ALL: Judge[] = ["taste", "criteria", "generic"]
const JUDGES: Judge[] = process.env.PREDICT_JUDGES
  ? ALL.filter((j) => process.env.PREDICT_JUDGES?.split(",").includes(j))
  : ALL

const PROMPTS: Record<Judge, string> = {
  taste: `You stand in for one designer, to predict their pick. ./notes/ holds what they said about screenshots while pointing at them: open notes.md first, then every image it names. Two screens were built for the task in ./task.md: ./a.png and ./b.png, rendered 1440 by 2400 (blank space below a page's end means nothing).

Which would this designer pick as closer to their taste? Go by what their notes say they like and don't, carried to these screens only where an element plainly has the same role; where the notes say nothing, guess as they would. Don't judge by your own taste.

Write ./pick.json and nothing else: {"pick": "a" or "b", "why": "one sentence naming the notes it rests on"}. Don't ask questions.`,
  criteria: `You stand in for one designer, to predict their pick. ./notes/ holds what they said about screenshots while pointing at them: open notes.md first, then every image it names. Two screens were built for the task in ./task.md: ./a.png and ./b.png, rendered 1440 by 2400 (blank space below a page's end means nothing).

First, before you look at the two screens, write the criteria this designer would judge a screen for this task by: 3 to 7, each one concrete enough to check on a screen, fitted to this task, and each naming the notes it rests on. Only what their notes support; carry a note to this task only where an element plainly has the same role. Then look at both screens, judge each against every criterion, and pick the one that meets them better.

Write ./pick.json and nothing else: {"criteria": ["…"], "pick": "a" or "b", "why": "one sentence naming the criteria it rests on"}. Don't ask questions.`,
  generic: `Two screens were built for the task in ./task.md: ./a.png and ./b.png, rendered 1440 by 2400 (blank space below a page's end means nothing). As a senior product designer, which is the better design for this task?

Write ./pick.json and nothing else: {"pick": "a" or "b", "why": "one sentence"}. Don't ask questions.`,
}

type Prediction = Record<Judge, { asShown?: string; swapped?: string }>

async function notesFolder(from: string): Promise<string> {
  if (statSync(from).isDirectory()) return from
  const out = mkdtempSync(path.join(tmpdir(), "hvp-notes-"))
  for (const [name, data] of await unzip(readFileSync(from))) {
    if (name.endsWith("/")) continue
    const to = path.join(out, name)
    if (!to.startsWith(out + path.sep)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, data)
  }
  // A package keeps its files in one folder: the judge finds notes.md at the top.
  const md = spawnSync("find", [out, "-name", "notes.md"], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")[0]
  return md ? path.dirname(md) : out
}

function draw(dir: string, id: string): string | null {
  const png = path.join(dir, "renders", `${id}.png`)
  if (existsSync(png)) return png
  mkdirSync(path.dirname(png), { recursive: true })
  spawnSync(
    CHROME,
    [
      "--headless=new",
      "--hide-scrollbars",
      "--window-size=1440,2400",
      "--virtual-time-budget=8000",
      `--screenshot=${png}`,
      `file://${path.join(dir, "builds", `${id}.html`)}`,
    ],
    { stdio: "ignore" },
  )
  return existsSync(png) ? png : null
}

async function pickOnce(
  judge: Judge,
  notes: string,
  task: string,
  a: string,
  b: string,
): Promise<string | undefined> {
  const work = mkdtempSync(path.join(tmpdir(), "hvp-predict-"))
  try {
    writeFileSync(path.join(work, "task.md"), `${task}\n`)
    cpSync(a, path.join(work, "a.png"))
    cpSync(b, path.join(work, "b.png"))
    if (judge !== "generic")
      cpSync(notes, path.join(work, "notes"), { recursive: true })
    await new Promise<void>((resolve) => {
      const child = spawn(
        "claude",
        [
          "-p",
          PROMPTS[judge],
          "--tools",
          "Read,Write,Glob",
          "--allowedTools",
          "Read",
          "Write",
          "Glob",
          "--permission-mode",
          "acceptEdits",
          "--strict-mcp-config",
          "--mcp-config",
          '{"mcpServers":{}}',
          "--disable-slash-commands",
          "--no-session-persistence",
        ],
        { cwd: work, stdio: ["ignore", "ignore", "ignore"] },
      )
      const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000)
      child.on("close", () => {
        clearTimeout(timer)
        resolve()
      })
      child.on("error", () => {
        clearTimeout(timer)
        resolve()
      })
    })
    const file = path.join(work, "pick.json")
    if (!existsSync(file)) return undefined
    const { pick } = JSON.parse(readFileSync(file, "utf8")) as { pick: string }
    return pick === "a" || pick === "b" ? pick : undefined
  } catch {
    return undefined
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** A judge's pick for the pair, as left or right, or null when its two orders disagree. */
export function agreed(p: {
  asShown?: string
  swapped?: string
}): "left" | "right" | null {
  // As shown, a is left; swapped, a is right.
  const first = p.asShown === "a" ? "left" : p.asShown === "b" ? "right" : null
  const second = p.swapped === "a" ? "right" : p.swapped === "b" ? "left" : null
  return first && first === second ? first : null
}

/** Agreement with the author: a match counts one, unsure half. */
export function agreement(
  rows: { author: "left" | "right"; judge: "left" | "right" | null }[],
): { score: number; n: number; hits: number; unsure: number } {
  const hits = rows.filter((r) => r.judge === r.author).length
  const unsure = rows.filter((r) => r.judge === null).length
  return {
    score: rows.length ? (hits + unsure / 2) / rows.length : 0,
    n: rows.length,
    hits,
    unsure,
  }
}

async function main() {
  const [notesArg, ...dirArgs] = process.argv.slice(2)
  if (!notesArg || !dirArgs.length) {
    console.error(
      "Usage: node --import tsx scripts/hand-vs-pinch/predict.ts <notes.zip or folder> <test dir> [<test dir> …]",
    )
    process.exit(1)
  }
  const notes = await notesFolder(home(notesArg))
  const table: Record<
    Judge,
    { author: "left" | "right"; judge: "left" | "right" | null }[]
  > = { taste: [], criteria: [], generic: [] }
  for (const dirArg of dirArgs) {
    const dir = home(dirArg)
    const read = <T>(f: string) =>
      JSON.parse(readFileSync(path.join(dir, f), "utf8")) as T
    const { tasks } = read<{ tasks: string[] }>("key.json")
    const { pairs } = read<{ pairs: Pair[] }>("blind.json")
    const answers = read<Record<string, Answer>>("results.json")
    const file = path.join(dir, "predictions.json")
    const saved: Record<string, Prediction> = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : {}
    const judged = pairs.filter(
      (p) => answers[p.id] && answers[p.id].pick !== "same",
    )
    const jobs: (() => Promise<void>)[] = []
    for (const p of judged) {
      const left = draw(dir, p.left)
      const right = draw(dir, p.right)
      if (!left || !right) {
        console.log(`${path.basename(dir)}: couldn't draw pair ${p.id}`)
        continue
      }
      saved[p.id] ??= { taste: {}, criteria: {}, generic: {} }
      for (const judge of JUDGES)
        for (const order of ["asShown", "swapped"] as const) {
          saved[p.id][judge] ??= {}
          if (saved[p.id][judge][order]) continue
          jobs.push(async () => {
            const [a, b] = order === "asShown" ? [left, right] : [right, left]
            saved[p.id][judge][order] = await pickOnce(
              judge,
              notes,
              tasks[p.task],
              a,
              b,
            )
            writeFileSync(file, JSON.stringify(saved, null, 2))
          })
        }
    }
    console.log(`${path.basename(dir)}: ${jobs.length} picks to ask for`)
    let next = 0
    await Promise.all(
      Array.from({ length: AT_ONCE }, async () => {
        while (next < jobs.length) await jobs[next++]()
      }),
    )
    for (const p of judged) {
      const s = saved[p.id]
      if (!s) continue
      for (const judge of JUDGES)
        table[judge].push({
          author: answers[p.id].pick as "left" | "right",
          judge: agreed(s[judge] ?? {}),
        })
    }
  }
  for (const judge of JUDGES) {
    const a = agreement(table[judge])
    console.log(
      `${judge}: ${(a.score * 100).toFixed(0)}% of ${a.n} picks (${a.hits} agreed, ${a.unsure} unsure)`,
    )
  }
}

if (process.argv[1]?.endsWith("predict.ts")) main()
