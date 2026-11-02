// The hand-vs-Pinch test (D145): is an agent's work from Pinch's package closer to the author's
// taste, for less of their time, than from the same screenshots noted by hand? The protocol is in
// docs/hand-vs-pinch.md.
//
//   node --import tsx scripts/hand-vs-pinch/run.ts init <dir>    the folder, test.json and notes.md
//   node --import tsx scripts/hand-vs-pinch/run.ts build <dir>   every build, through Claude Code
//   node --import tsx scripts/hand-vs-pinch/run.ts judge <dir>   the blind judging page
//   node --import tsx scripts/hand-vs-pinch/run.ts score <dir>   the score, in results.md
//
// The builds run on the author's own Claude Code (`claude -p`), not the API: no key and no spend
// beyond their plan. Each runs in a folder of its own outside <dir>, holding only its input, with
// no MCP servers (Pinch's included), skills or slash commands, and only Read, Write, Glob and
// Grep. The same prompt goes to both inputs (`buildPrompt`). Build again to redo any that failed.
import { spawn } from "node:child_process"
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
  type Answer,
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

if (!dirArg || !["init", "build", "judge", "score"].includes(command)) {
  console.error(
    "Usage: node --import tsx scripts/hand-vs-pinch/run.ts init|build|judge|score <dir>",
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
  3. Pinch first: talk them through, Add to your rules, read them, Export. The zip goes in pinch/.
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
    const args = [
      "-p",
      buildPrompt(task),
      "--tools",
      "Read,Write,Glob,Grep",
      "--allowedTools",
      "Read",
      "Write",
      "Glob",
      "Grep",
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
}

async function main() {
  if (command === "init") init()
  else if (command === "build") await build()
  else if (command === "judge") judge()
  else scoreAll()
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
