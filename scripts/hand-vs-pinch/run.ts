// The hand-vs-Pinch test (D145): is an agent's work from Pinch's package closer to the author's
// taste, for less of their time, than from the same screenshots noted by hand? The protocol is in
// docs/hand-vs-pinch.md.
//
//   node --import tsx scripts/hand-vs-pinch/run.ts init <dir>    the folder, test.json and notes.md
//   node --import tsx scripts/hand-vs-pinch/run.ts build <dir>   every build, through Claude Code
//   node --import tsx scripts/hand-vs-pinch/run.ts judge <dir>   the blind judging page
//   node --import tsx scripts/hand-vs-pinch/run.ts score <dir>   the score, in results.md
//   node --import tsx scripts/hand-vs-pinch/run.ts round <dir>   the next round of corrections (D154)
//
// A round is a test folder of its own, round-N inside <dir>: build, judge and score take it too.
// Score on <dir> also scores the rounds together, in results-rounds.md.
//
// The builds run on the author's own Claude Code (`claude -p`), not the API: no key and no spend
// beyond their plan. Each runs in a folder of its own outside <dir>, holding only its input, with
// no MCP servers (Pinch's included), skills or slash commands, and only Read, Write, Glob and
// Grep, and `node render.mjs` to draw its page and look at it (D147), as an agent at work can.
// The same prompt goes to both inputs (`buildPrompt`). Build again to redo any that failed.
// CHROME names the browser that draws the pages, if it isn't Google Chrome on a Mac.
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzip } from "../../src/lib/pin/unzip"
import {
  ARMS,
  type Answer,
  type Arm,
  type Build,
  blind,
  buildPrompt,
  type Pair,
  SETTINGS,
  type Settings,
  score,
  scoreText,
  settingsProblems,
} from "./plan"

const [command, dirArg] = process.argv.slice(2)
const PORT = Number(process.env.PORT) || 3130
/** Builds running at once, and how long one may take. */
const AT_ONCE = 3
const BUILD_MINUTES = 20
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const CHROME =
  process.env.CHROME ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
/**
 * What a build runs to see its page: headless Chrome draws index.html into render.png. Whether the
 * file came out says if it worked: Chrome can exit with an error after writing it, on shutting down.
 */
const RENDER = `import { spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { resolve } from "node:path"
rmSync("render.png", { force: true })
spawnSync(${JSON.stringify(CHROME)}, ["--headless=new", "--hide-scrollbars", "--window-size=1440,2400", "--virtual-time-budget=8000", "--screenshot=" + resolve("render.png"), "file://" + resolve("index.html")], { stdio: "ignore" })
if (!existsSync("render.png")) {
  console.error("Couldn't draw render.png.")
  process.exit(1)
}
console.log("Drew render.png, 1440 by 2400.")
`

if (!dirArg || !["init", "build", "judge", "score", "round"].includes(command)) {
  console.error(
    "Usage: node --import tsx scripts/hand-vs-pinch/run.ts init|build|judge|score|round <dir>",
  )
  process.exit(1)
}
const dir = path.resolve(dirArg.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"))
const at = (...p: string[]) => path.join(dir, ...p)
const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(at(file), "utf8")) as T
const writeJson = (file: string, data: unknown) =>
  writeFileSync(at(file), `${JSON.stringify(data, null, 2)}\n`)
const files = (sub: string) =>
  existsSync(at(sub))
    ? readdirSync(at(sub)).filter((f) => !f.startsWith("."))
    : []

const NOTES = `# My notes

Write here what you would tell Claude about each screenshot in screens/, the way you would if
Pinch didn't exist: what works, what doesn't and why. Crop or mark images too if that is what
you would do; put them in this folder. Time yourself, from the first screenshot to the last.

`
/** Stands in a round's notes until the author's corrections replace it. */
const CORRECT_HERE =
  "Write here what you would tell Claude about this page it built, at most five notes, in place of this line. Time yourself."

function init() {
  if (dir.startsWith(path.resolve(".") + path.sep))
    throw new Error(
      "Keep the test outside the repository: it holds your screenshots.",
    )
  for (const sub of ["screens", "hand", "pinch"])
    mkdirSync(at(sub), { recursive: true })
  if (!existsSync(at("test.json"))) writeJson("test.json", SETTINGS)
  if (!existsSync(at("hand", "notes.md")))
    writeFileSync(at("hand", "notes.md"), NOTES)
  console.log(`Ready in ${dir}. Next, as docs/hand-vs-pinch.md says:
  1. Put 8–12 screenshots in screens/.
  2. Write the tasks in test.json.
  3. Pinch first: talk them through, Export. The zip goes in pinch/.
  4. A day later, by hand: hand/notes.md.
  5. Your minutes for each in test.json, then build.`)
}

/** What's missing before the builds can run, or nothing. */
function inputProblems(settings: Settings): string[] {
  const out = settingsProblems(settings)
  const screens = files("screens").filter((f) => IMAGE.test(f))
  if (screens.length < 2) out.push("Put the screenshots in screens/.")
  const notes = existsSync(at("hand", "notes.md"))
    ? readFileSync(at("hand", "notes.md"), "utf8")
    : ""
  if (notes.trim() === NOTES.trim() || !notes.trim())
    out.push("Write your notes in hand/notes.md.")
  if (notes.includes(CORRECT_HERE))
    out.push("Write your corrections in hand/notes.md.")
  if (!files("pinch").some((f) => f.endsWith(".zip")))
    out.push("Put Pinch's export zip in pinch/.")
  return out
}

/** A build's input, as the agent finds it in `./input`. */
async function fillInput(arm: Build["arm"], input: string) {
  mkdirSync(input, { recursive: true })
  if (arm === "hand") {
    for (const f of files("screens"))
      cpSync(at("screens", f), path.join(input, f))
    for (const f of files("hand"))
      cpSync(at("hand", f), path.join(input, f), { recursive: true })
    return
  }
  const zipName = files("pinch").find((f) => f.endsWith(".zip")) as string
  const entries = await unzip(readFileSync(at("pinch", zipName)))
  for (const [name, data] of entries) {
    if (name.endsWith("/")) continue
    const to = path.join(input, name)
    if (!to.startsWith(input + path.sep)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, data)
  }
}

/** One build through Claude Code, in a folder of its own; true when it wrote its page. */
async function runBuild(
  b: Build,
  task: string,
  model: string | null,
): Promise<boolean> {
  const work = mkdtempSync(path.join(tmpdir(), "hand-vs-pinch-"))
  try {
    await fillInput(b.arm, path.join(work, "input"))
    writeFileSync(path.join(work, "render.mjs"), RENDER)
    const args = [
      "-p",
      buildPrompt(task),
      "--tools",
      "Read,Write,Glob,Grep,Bash",
      "--allowedTools",
      "Read",
      "Write",
      "Glob",
      "Grep",
      "Bash(node render.mjs)",
      "Bash(node render.mjs:*)",
      "--permission-mode",
      "acceptEdits",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--no-session-persistence",
      ...(model ? ["--model", model] : []),
    ]
    const log: string[] = []
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn("claude", args, {
        cwd: work,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const timer = setTimeout(
        () => child.kill("SIGTERM"),
        BUILD_MINUTES * 60_000,
      )
      child.stdout.on("data", (d) => log.push(String(d)))
      child.stderr.on("data", (d) => log.push(String(d)))
      child.on("error", (e) => {
        log.push(String(e))
        clearTimeout(timer)
        resolve(null)
      })
      child.on("close", (c) => {
        clearTimeout(timer)
        resolve(c)
      })
    })
    writeFileSync(at("logs", `${b.id}.txt`), `exit ${code}\n\n${log.join("")}`)
    const page = path.join(work, "index.html")
    if (!existsSync(page) || !statSync(page).size) return false
    cpSync(page, at("builds", `${b.id}.html`))
    return true
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function build() {
  const settings = readJson<Settings>("test.json")
  const problems = inputProblems(settings)
  if (problems.length) throw new Error(problems.join("\n"))
  const tasks = settings.tasks.filter((t) => t.trim())
  for (const sub of ["builds", "logs"]) mkdirSync(at(sub), { recursive: true })
  // The pairs are drawn once; building again only fills in the builds missing.
  if (!existsSync(at("key.json"))) {
    const { builds, pairs } = blind(tasks.length, settings.runs)
    writeJson("key.json", { builds, model: settings.model, tasks })
    writeJson("blind.json", { pairs })
  }
  const { builds } = readJson<{ builds: Build[] }>("key.json")
  const todo = builds.filter((b) => !existsSync(at("builds", `${b.id}.html`)))
  console.log(
    `${todo.length} of ${builds.length} builds to run, ${AT_ONCE} at a time.`,
  )
  let done = 0
  let failed = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        const ok = await runBuild(b, tasks[b.task], settings.model).catch(
          () => false,
        )
        if (ok) done++
        else failed++
        console.log(
          `${done + failed} of ${todo.length}${ok ? "" : ` (one failed: logs/${b.id}.txt)`}`,
        )
      }
    }),
  )
  console.log(
    failed
      ? `${failed} failed. Build again to redo them, or judge the pairs that are complete.`
      : "All built. Next: judge, without opening key.json or logs/.",
  )
}

/** The pairs whose two builds are both there, as the judging page shows them. */
function judgeable() {
  const { pairs } = readJson<{ pairs: Pair[] }>("blind.json")
  const have = (id: string) => existsSync(at("builds", `${id}.html`))
  return pairs.filter((p) => have(p.left) && have(p.right))
}

function judge() {
  const { tasks } = readJson<{ tasks: string[] }>("key.json")
  const answersOf = (): Record<string, Answer> =>
    existsSync(at("results.json")) ? readJson("results.json") : {}
  const page = readFileSync(
    path.join(path.dirname(process.argv[1]), "judge.html"),
  )
  createServer((req, res) => {
    const url = req.url ?? "/"
    if (req.method === "GET" && url === "/") {
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(page)
      return
    }
    if (req.method === "GET" && url === "/state") {
      const body = JSON.stringify({
        tasks,
        pairs: judgeable(),
        answers: answersOf(),
      })
      res.writeHead(200, { "content-type": "application/json" }).end(body)
      return
    }
    const built = url.match(/^\/b\/([a-z0-9]{6})$/)
    if (req.method === "GET" && built) {
      const shown = judgeable().some(
        (p) => p.left === built[1] || p.right === built[1],
      )
      if (!shown) {
        res.writeHead(404).end()
        return
      }
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(readFileSync(at("builds", `${built[1]}.html`)))
      return
    }
    if (req.method === "POST" && url === "/answer") {
      let body = ""
      req.on("data", (d) => {
        body += d
      })
      req.on("end", () => {
        try {
          const { pair, answer } = JSON.parse(body) as {
            pair: string
            answer: Answer
          }
          if (!judgeable().some((p) => p.id === pair)) throw new Error()
          writeJson("results.json", { ...answersOf(), [pair]: answer })
          res.writeHead(204).end()
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }
    res.writeHead(404).end()
  }).listen(PORT, "127.0.0.1", () =>
    console.log(
      `Judge on http://localhost:${PORT}. Your verdicts save to results.json as you go.`,
    ),
  )
}

function scoreAll() {
  const settings = readJson<Settings>("test.json")
  const { builds } = readJson<{ builds: Build[] }>("key.json")
  const answers: Record<string, Answer> = existsSync(at("results.json"))
    ? readJson("results.json")
    : {}
  const s = score(builds, judgeable(), answers, settings.minutes)
  const text = scoreText(s, settings)
  writeFileSync(at("results.md"), text)
  console.log(text)
  if (rounds().length) scoreRounds(settings)
}

/** The rounds started so far, oldest first. */
const rounds = () =>
  files(".")
    .filter((f) => /^round-\d+$/.test(f))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))

/**
 * The next round of corrections (D154), once every pair so far is judged, since it says which way
 * made the builds it draws: each way's first build of the task, to correct, and the next task to
 * build from the corrections.
 */
function round() {
  const settings = readJson<Settings>("test.json")
  const tasks = settings.tasks.filter((t) => t.trim())
  const n = rounds().length + 1
  if (n >= tasks.length)
    throw new Error("Every task has had its round. Next: score.")
  const from = n === 1 ? "." : `round-${n - 1}`
  if (!existsSync(at(from, "key.json")))
    throw new Error(`Build and judge ${from === "." ? "the test" : from} first.`)
  const { builds } = readJson<{ builds: Build[] }>(path.join(from, "key.json"))
  const { pairs } = readJson<{ pairs: Pair[] }>(path.join(from, "blind.json"))
  const answers: Record<string, Answer> = existsSync(at(from, "results.json"))
    ? readJson(path.join(from, "results.json"))
    : {}
  if (pairs.some((p) => !answers[p.id]))
    throw new Error(
      `Judge every pair in ${from === "." ? "the test" : from} first: a round says which way made which build.`,
    )
  const to = `round-${n}`
  mkdirSync(at(to, "pinch"), { recursive: true })
  cpSync(at("screens"), at(to, "screens"), { recursive: true })
  cpSync(at(from, "hand"), at(to, "hand"), { recursive: true })
  for (const arm of ARMS) {
    const b = builds.find(
      (x) => x.arm === arm && x.task === 0 && x.run === 0,
    ) as Build
    const png =
      arm === "hand"
        ? at(to, "hand", `render-${n}.png`)
        : at(to, `for-pinch-${n}.png`)
    spawnSync(
      CHROME,
      [
        "--headless=new",
        "--hide-scrollbars",
        "--window-size=1440,2400",
        "--virtual-time-budget=8000",
        `--screenshot=${png}`,
        `file://${at(from, "builds", `${b.id}.html`)}`,
      ],
      { stdio: "ignore" },
    )
    if (!existsSync(png)) throw new Error(`Couldn't draw ${png}.`)
  }
  const notes = readFileSync(at(to, "hand", "notes.md"), "utf8").trimEnd()
  writeFileSync(
    at(to, "hand", "notes.md"),
    `${notes}\n\n## Corrections on render-${n}.png\n\n${CORRECT_HERE}\n`,
  )
  writeJson(path.join(to, "test.json"), {
    ...SETTINGS,
    tasks: [tasks[n]],
    runs: settings.runs,
    model: settings.model,
    round: n,
  } satisfies Settings)
  console.log(`Round ${n} is ready in ${at(to)}. Each way corrects its own build, at most five notes, timed:
  1. Pinch: add for-pinch-${n}.png, say "This is ours", talk it through, Export. The zip, with the earlier notes in it, goes in ${to}/pinch/.
  2. By hand: look at ${to}/hand/render-${n}.png and write your corrections in ${to}/hand/notes.md.
  3. Your minutes for each in ${to}/test.json, then build, judge and score ${to}.`)
}

/** Every round's pairs together, on the minutes of all their corrections: the loop's verdict (D154). */
function scoreRounds(settings: Settings) {
  const each = rounds()
    .filter((r) => existsSync(at(r, "key.json")))
    .map((r, task) => ({
      settings: readJson<Settings>(path.join(r, "test.json")),
      builds: readJson<{ builds: Build[] }>(
        path.join(r, "key.json"),
      ).builds.map((b) => ({ ...b, task })),
      pairs: readJson<{ pairs: Pair[] }>(path.join(r, "blind.json")).pairs.map(
        (p) => ({ ...p, task }),
      ),
      answers: existsSync(at(r, "results.json"))
        ? readJson<Record<string, Answer>>(path.join(r, "results.json"))
        : {},
    }))
  const spent = (arm: Arm) =>
    each.every((e) => e.settings.minutes[arm] !== null)
      ? Math.round(
          each.reduce((all, e) => all + (e.settings.minutes[arm] ?? 0), 0) * 10,
        ) / 10
      : null
  const minutes = { pinch: spent("pinch"), hand: spent("hand") }
  const s = score(
    each.flatMap((e) => e.builds),
    each.flatMap((e) => e.pairs),
    Object.assign({}, ...each.map((e) => e.answers)),
    minutes,
  )
  const text = `${scoreText(
    s,
    {
      ...settings,
      tasks: each.flatMap((e) => e.settings.tasks),
      minutes,
    },
    "The rounds of corrections",
  )}\nBuild the loop only if this is Dramatically better and you'd do another round unprompted (D154).\n`
  writeFileSync(at("results-rounds.md"), text)
  console.log(text)
}

async function main() {
  if (command === "init") init()
  else if (command === "build") await build()
  else if (command === "judge") judge()
  else if (command === "round") round()
  else scoreAll()
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
