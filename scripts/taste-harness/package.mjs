// Does a change to the package change what an agent builds from it? (docs/taste-harness.md.)
// run.mjs writes its notes.md by hand, as Export did on 2026-11-06, so it can't tell. Here the same
// take is packaged twice by Pinch's own code, from two trees: P, the package as it was (BEFORE, a
// checkout of the commit to compare with), and N, the package as this tree writes it. Both get the
// same pictures (pack-take.ts) and the check as a sub-agent in the project, as Export leaves it.
// New screens are built from each and judged blind against each other, by the designer's hidden taste.
//
//   OUT=<dir> ONLY=1,3,4 node scripts/taste-harness/run.mjs designers|seed|take   (take's crop step may fail: not used)
//   OUT=<dir> BEFORE=<tree> node scripts/taste-harness/package.mjs pack|build|judge|report
//
// ONLY (default 1,3,4: the designers far from the agent's own taste), RUNS (2) and AT_ONCE (6)
// size it. Stages skip what exists, so rerun to resume. PW_PATH names a Playwright to draw with.
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const NOW = path.resolve(HERE, "../..")
const EXP = path.resolve(
  (process.env.OUT ?? "~/taste-harness").replace(
    /^~(?=$|\/)/,
    process.env.HOME ?? "~",
  ),
)
const BEFORE = process.env.BEFORE ? path.resolve(process.env.BEFORE) : null
const IDX = (process.env.ONLY ?? "1,3,4").split(",").map(Number)
const AT_ONCE = Number(process.env.AT_ONCE || 6)
const RUNS = Number(process.env.RUNS || 2)
const ARMS = ["P", "N"]
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const dd = (i) => path.join(EXP, `d${i + 1}`)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-exp-"))

/** One `claude -p` session in `cwd`, as run.mjs starts them; a build keeps every step in its log. */
function claude(cwd, prompt, { build = false, minutes = 20 } = {}) {
  const args = [
    "-p",
    prompt,
    "--tools",
    build ? "Read,Write,Glob,Grep,Bash,Agent" : "Read,Write,Glob,Grep",
    "--allowedTools",
    "Read",
    "Write",
    "Glob",
    "Grep",
    ...(build
      ? ["Agent", "Bash(node render.mjs)", "Bash(node render.mjs:*)"]
      : []),
    "--permission-mode",
    "acceptEdits",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-session-persistence",
    ...(build ? ["--output-format", "stream-json", "--verbose"] : []),
  ]
  return new Promise((res) => {
    const out = []
    const c = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const t = setTimeout(() => c.kill("SIGTERM"), minutes * 60000)
    c.stdout.on("data", (d) => out.push(String(d)))
    c.stderr.on("data", (d) => out.push(String(d)))
    c.on("close", (code) => {
      clearTimeout(t)
      res({ code, log: out.join("") })
    })
    c.on("error", (e) => {
      clearTimeout(t)
      res({ code: -1, log: String(e) })
    })
  })
}
async function pool(jobs) {
  let i = 0
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (i < jobs.length) await jobs[i++]()
    }),
  )
}
function render(dir) {
  cpSync(path.join(HERE, "render.mjs"), path.join(dir, "render.mjs"))
  const r = spawnSync("node", ["render.mjs"], { cwd: dir, encoding: "utf8" })
  if (existsSync(path.join(dir, "render.png"))) return true
  log("render failed", dir, r.stderr)
  return false
}

// The prompts are run.mjs's, word for word: only the package differs between the arms.
const buildPrompt = (d, task) => `You're the coding agent on ${d.product}.

The designer's feedback on earlier screens is in ./pinch/: read all of it first and open the images. It is everything you know about their taste.

Build this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:

${task}

- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if you want a typeface; load nothing else from outside.
- No external images: draw with inline SVG or CSS, and write realistic text.
- Where you have no guidance, use your own judgment.

You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

const judgePrompt = (
  n,
) => `You are judging ${n} screens for one designer. ./designer.md says who they are and their taste point by point: they never wrote it down, but it is exactly what they want. ./earlier.md lists the corrections they gave their agent on an earlier screen. All ${n} screens were built for the task in ./task.md: ./s1.png … ./s${n}.png, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at each closely. For each screen: the taste points by number it breaks (where it had a chance to show them), the earlier corrections by number that it repeats (the same mistake made again, on this screen), and the changes this designer would ask for before it is theirs, one per distinct edit. Then rank all ${n} from closest to their taste to furthest, ties not allowed.

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "repeats": [], "changes": 0}, …}, "rank": ["s3","s1",…], "why": "two sentences"}. Judge only what you see. Don't ask questions.`

const cells = () =>
  IDX.flatMap((i) =>
    [1, 2].flatMap((t) =>
      Array.from({ length: RUNS }, (_, r) => ({
        i,
        t,
        r: r + 1,
        dir: path.join(dd(i), "package", `t${t}`, `r${r + 1}`),
      })),
    ),
  )
/** The package of an arm for a designer: the folder holding its `pinch-notes-…`. */
const packageOf = (i, arm) => path.join(dd(i), "package", `pinch-${arm}`)

// ---------- stages ----------
function pack() {
  if (!BEFORE) throw new Error("BEFORE=<tree to compare with> is needed")
  for (const i of IDX) {
    const seed = path.join(dd(i), "seed")
    for (const [arm, tree] of [
      ["P", BEFORE],
      ["N", NOW],
    ]) {
      const out = packageOf(i, arm)
      rmSync(out, { recursive: true, force: true })
      const r = spawnSync(
        "node",
        [
          "--import",
          "tsx",
          path.join(HERE, "pack-take.ts"),
          path.join(seed, "render.png"),
          path.join(seed, "render-text.json"),
          path.join(dd(i), "take.json"),
          out,
          tree,
        ],
        { cwd: NOW, encoding: "utf8" },
      )
      if (r.status) throw new Error(`pack ${arm} d${i + 1}: ${r.stderr}`)
      log("packed", `d${i + 1}`, arm, r.stdout.trim())
    }
  }
}

async function buildInto(dest, d, task, from) {
  if (existsSync(path.join(dest, "index.html"))) return
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  cpSync(from, path.join(w, "pinch"), { recursive: true })
  // The check as a sub-agent in the project, where Export's notes.md says to put it.
  const [folder] = readdirSync(path.join(w, "pinch"))
  cpSync(
    path.join(w, "pinch", folder, "pinch-check.md"),
    path.join(w, ".claude", "agents", "pinch-check.md"),
  )
  const r = await claude(w, buildPrompt(d, task), { build: true, minutes: 25 })
  W(path.join(dest, "log.txt"), r.log)
  if (!existsSync(path.join(w, "index.html"))) return log("build failed", dest)
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", path.relative(EXP, dest))
}

async function build() {
  const jobs = []
  for (const c of cells()) {
    const d = J(path.join(dd(c.i), "designer.json"))
    for (const arm of ARMS)
      jobs.push(() =>
        buildInto(path.join(c.dir, arm), d, d.tasks[c.t], packageOf(c.i, arm)),
      )
  }
  await pool(jobs)
}

async function judge() {
  const jobs = []
  for (const c of cells())
    for (const pass of [1, 2])
      jobs.push(async () => {
        const f = path.join(c.dir, `verdict-${pass}.json`)
        if (existsSync(f)) return
        const d = J(path.join(dd(c.i), "designer.json"))
        const arms = ARMS.filter((a) =>
          existsSync(path.join(c.dir, a, "render.png")),
        )
        if (arms.length < 2) return log("not judged", c.dir)
        // Each order once, so that a judge's lean to the first or the last cancels.
        const order = pass === 1 ? arms : [...arms].reverse()
        const w = work()
        W(
          path.join(w, "designer.md"),
          `# The designer\n\n${d.designer}\n\n## Their taste\n\n${d.taste.map((t, k) => `${k}. ${t}`).join("\n")}\n`,
        )
        W(
          path.join(w, "earlier.md"),
          `# Corrections on an earlier screen\n\n${J(
            path.join(dd(c.i), "take.json"),
          )
            .notes.map((n, k) => `${k + 1}. On ${n.what}: "${n.words}"`)
            .join("\n")}\n`,
        )
        W(path.join(w, "task.md"), d.tasks[c.t])
        for (const [k, a] of order.entries())
          cpSync(
            path.join(c.dir, a, "render.png"),
            path.join(w, `s${k + 1}.png`),
          )
        const r = await claude(w, judgePrompt(order.length), { minutes: 12 })
        if (!existsSync(path.join(w, "verdict.json")))
          return log("judge failed", c.dir, r.log.slice(-300))
        const v = J(path.join(w, "verdict.json"))
        const map = Object.fromEntries(order.map((a, k) => [`s${k + 1}`, a]))
        W(f, {
          order,
          screens: Object.fromEntries(
            Object.entries(v.screens).map(([s, x]) => [map[s], x]),
          ),
          rank: v.rank.map((s) => map[s]),
          why: v.why,
        })
        log("judged", path.relative(EXP, c.dir), pass)
      })
  await pool(jobs)
}

/** What a build did, from its log: the pictures it opened, the checks it ran, what it cost. */
function readLog(file) {
  const seen = { marked: 0, crops: 0, images: 0, checks: 0, cost: 0 }
  if (!existsSync(file)) return seen
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === "result") seen.cost = event.total_cost_usd ?? seen.cost
    for (const part of event.message?.content ?? []) {
      if (part.type !== "tool_use") continue
      // The builder's own steps only: a sub-agent's are its own.
      if (event.parent_tool_use_id) continue
      const file = String(part.input?.file_path ?? "")
      if (part.name === "Read" && file.includes("/pinch/")) {
        if (file.includes("/marked/")) seen.marked++
        else if (file.includes("/crops/")) seen.crops++
        else if (file.includes("/images/")) seen.images++
      }
      if (
        (part.name === "Agent" || part.name === "Task") &&
        part.input?.subagent_type === "pinch-check"
      )
        seen.checks++
    }
  }
  return seen
}

function report() {
  const sum = Object.fromEntries(
    ARMS.map((a) => [
      a,
      {
        changes: 0,
        breaks: 0,
        repeats: 0,
        rank: 0,
        n: 0,
        marked: 0,
        crops: 0,
        images: 0,
        checks: 0,
        cost: 0,
        built: 0,
      },
    ]),
  )
  const pair = [0, 0, 0]
  const rows = []
  for (const c of cells()) {
    for (const a of ARMS) {
      const seen = readLog(path.join(c.dir, a, "log.txt"))
      if (!existsSync(path.join(c.dir, a, "index.html"))) continue
      sum[a].built++
      for (const k of ["marked", "crops", "images", "checks", "cost"])
        sum[a][k] += seen[k]
    }
    const vs = [1, 2]
      .map((p) => path.join(c.dir, `verdict-${p}.json`))
      .filter(existsSync)
      .map(J)
    if (!vs.length) continue
    const m = {}
    for (const a of ARMS) {
      const xs = vs.map((v) => v.screens[a]).filter(Boolean)
      if (!xs.length) continue
      const avg = (k) =>
        xs.reduce((s, x) => s + (Array.isArray(x[k]) ? x[k].length : x[k]), 0) /
        xs.length
      m[a] = {
        changes: avg("changes"),
        breaks: avg("breaks"),
        repeats: avg("repeats"),
        rank: vs.reduce((s, v) => s + v.rank.indexOf(a) + 1, 0) / vs.length,
      }
      for (const k of ["changes", "breaks", "repeats", "rank"])
        sum[a][k] += m[a][k]
      sum[a].n++
    }
    if (m.P && m.N)
      pair[m.N.rank < m.P.rank ? 0 : m.N.rank > m.P.rank ? 2 : 1]++
    rows.push(
      `| d${c.i + 1} t${c.t} r${c.r} | ${ARMS.map((a) => (m[a] ? `${m[a].changes.toFixed(1)} / ${m[a].breaks.toFixed(1)} / ${m[a].repeats.toFixed(1)} / ${m[a].rank.toFixed(1)}` : "–")).join(" | ")} |`,
    )
  }
  const per = (a, k, digits = 2) =>
    sum[a].n ? (sum[a][k] / sum[a].n).toFixed(digits) : "–"
  const each = (a, k, digits = 1) =>
    sum[a].built ? (sum[a][k] / sum[a].built).toFixed(digits) : "–"
  const out = [
    "| cell | P the package before | N the package now |",
    "|---|---|---|",
    ...rows,
    "",
    "Each cell: changes / taste points broken / earlier corrections repeated / mean rank (1 best), averaged over two judge passes, one in each order.",
    "",
    "| arm | changes | breaks | repeats | rank | cells |",
    "|---|---|---|---|---|---|",
    ...ARMS.map(
      (a) =>
        `| ${a} | ${per(a, "changes")} | ${per(a, "breaks")} | ${per(a, "repeats")} | ${per(a, "rank")} | ${sum[a].n} |`,
    ),
    "",
    `N against P, by mean rank: ${pair[0]} wins, ${pair[1]} ties, ${pair[2]} losses.`,
    "",
    "| arm | builds | marked copy opened | close-ups opened | screenshot opened | checks run | cost a build |",
    "|---|---|---|---|---|---|---|",
    ...ARMS.map(
      (a) =>
        `| ${a} | ${sum[a].built} | ${each(a, "marked")} | ${each(a, "crops")} | ${each(a, "images")} | ${each(a, "checks")} | $${each(a, "cost", 2)} |`,
    ),
    "",
    "Opened by the builder itself, a build; the check's own reading is not counted.",
  ]
  W(path.join(EXP, "package-report.md"), `${out.join("\n")}\n`)
  console.log(out.join("\n"))
}

const stages = { pack, build, judge, report }
const stage = process.argv[2]
if (stages[stage]) await stages[stage]()
else console.error("stage? pack | build | judge | report")
