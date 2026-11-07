// Does Pinch still add anything when the agent already has a design system? (docs/taste-harness.md.)
// For each made-up designer, a session plays their design-system lead and writes one from their hidden
// taste, in the layers people now write for agents: primitives, tokens named by purpose, components with
// their markup and when to use them, and short rules with reasons in CLAUDE.md. Rounds 4 to 6 of
// rounds.mjs are built again with the design system alone (S, S2) and with it and the takes so far
// (SP, SP2), then judged blind with the takes alone (M) and scored by measure.mjs's oracle.
//
//   OUT=<dir> node scripts/taste-harness/design-system.mjs ds|build|judge|measure|report
//
// <dir> is rounds.mjs's. ONLY (default d2,d4,d5) and AT_ONCE (8) size it. Stages skip what exists.
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const HERE = path.dirname(new URL(import.meta.url).pathname)
const EXP = path.resolve(
  (process.env.OUT ?? "~/taste-harness").replace(
    /^~(?=$|\/)/,
    process.env.HOME ?? "~",
  ),
)
const DESIGNERS = (process.env.ONLY ?? "d2,d4,d5").split(",")
const AT_ONCE = Number(process.env.AT_ONCE || 8)
const ROUNDS = [4, 5, 6]
const ARMS = ["S", "S2", "SP", "SP2"]
const JUDGED = ["M", ...ARMS]
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-ds-"))
const at = (dn, ...p) => path.join(EXP, dn, "rounds", ...p)
const ds = (dn) => path.join(EXP, dn, "design-system")

function claude(
  cwd,
  prompt,
  { agent = false, bash = false, minutes = 25 } = {},
) {
  const tools = ["Read", "Write", "Glob", "Grep"]
  if (bash) tools.push("Edit", "Bash")
  if (agent) tools.push("Agent")
  const allowed = tools.filter((t) => t !== "Bash")
  if (bash)
    allowed.push(
      "Bash(node render.mjs)",
      "Bash(node render.mjs:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
    )
  const args = [
    "-p",
    prompt,
    "--tools",
    tools.join(","),
    "--allowedTools",
    ...allowed,
    "--permission-mode",
    "acceptEdits",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-session-persistence",
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
async function pool(jobs, size = AT_ONCE) {
  let i = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < jobs.length) await jobs[i++]()
    }),
  )
}
function render(dir) {
  cpSync(path.join(HERE, "render.mjs"), path.join(dir, "render.mjs"))
  spawnSync("node", ["render.mjs"], { cwd: dir, encoding: "utf8" })
  return existsSync(path.join(dir, "render.png"))
}
/** The first JSON object in a text, for a session that wrote more after it; null when none parses. */
function lenient(text) {
  let depth = 0
  let inString = false
  let from = -1
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === "\\") i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === "{") {
      if (depth++ === 0) from = i
    } else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(from, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}
const roundTasks = (dn) => [
  ...J(path.join(EXP, dn, "designer.json")).tasks,
  ...J(path.join(EXP, dn, "more-tasks.json")).tasks,
]

const DS = `You are the design-system lead for the product in ./designer.json, working for that designer. Its "taste" is their taste: you know it well, and the design system should carry it. Write the design system an AI coding agent will build every screen from, in ./design-system/:

- tokens.css: primitives as CSS custom properties (colours, type scale and families, spacing scale, radius, borders, shadows), then tokens named by purpose that point at them (--text-muted, --surface-raised, --space-section, …), then a few base rules for the page, headings and body text.
- components.md: 6 to 10 components (for instance button, input, card or tile, list row, tag or status, page header, section, empty state), each with its HTML markup using those tokens (plain CSS classes defined in a <style> block at the top of the file, or Tailwind classes with arbitrary values reading the variables), its variants and states, and when to use it.
- CLAUDE.md: 5 to 10 short rules for building screens with this system, each with its reason, the way a lead writes them for an agent ("Separate sections with space, not boxes: the brand reads as calm").

Write what a skilled lead would, from this taste; never copy its statements word for word. Write only the three files.`

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task, takes) => `${PROJECT(d)}.

This project has a design system in ./design-system/: read CLAUDE.md, tokens.css and components.md first, and build with it. Put tokens.css (and the component styles you use) into a <style> in the page, and use the components' markup.${
  takes
    ? `

The designer's feedback on earlier screens is in ./pinch/: read all of it too and open the images. With the design system, it is everything you know about their taste.`
    : ""
}

Build this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:

${task}

- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if the design system names a typeface; load nothing else from outside.
- No external images: draw with inline SVG or CSS, and write realistic text.
- Where you have no guidance, use your own judgment.

You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

const judgePrompt = (
  n,
) => `You are judging ${n} screens for one designer. ./designer.md says who they are and their taste point by point: they never wrote it down, but it is exactly what they want. ./earlier.md lists the corrections they gave their agent on earlier screens. All ${n} screens were built for the task in ./task.md: ${Array.from({ length: n }, (_, i) => `./s${i + 1}.png`).join(", ")}, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at each closely. For each screen: the taste points by number it breaks (where it had a chance to show them), the earlier corrections by number that it repeats (the same mistake made again, on this screen), and the changes this designer would ask for before it is theirs, one per distinct edit. Then rank all ${n} from closest to their taste to furthest, ties not allowed.

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "repeats": [], "changes": 0}, …}, "rank": ["s2","s1",…], "why": "two sentences"}. Judge only what you see. Don't ask questions: no one is there to answer them.`

async function dsStage() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      if (existsSync(path.join(ds(dn), "CLAUDE.md"))) return
      const w = work()
      cpSync(path.join(EXP, dn, "designer.json"), path.join(w, "designer.json"))
      const run = await claude(w, DS, { minutes: 15 })
      const out = path.join(w, "design-system")
      if (
        !["tokens.css", "components.md", "CLAUDE.md"].every((f) =>
          existsSync(path.join(out, f)),
        )
      )
        return log("design system failed", dn, run.log.slice(-300))
      cpSync(out, ds(dn), { recursive: true })
      log("design system", dn)
    }),
  )
}

async function buildFor(dn, r, arm) {
  const dest = at(dn, `r${r}`, arm)
  if (existsSync(path.join(dest, "index.html"))) return
  const takes = arm.startsWith("SP")
  const d = J(path.join(EXP, dn, "designer.json"))
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  cpSync(ds(dn), path.join(w, "design-system"), { recursive: true })
  if (takes)
    for (let k = 1; k < r; k++) {
      const pk = at(dn, "pinch", `pinch-notes-take-${k}`)
      if (existsSync(pk))
        cpSync(pk, path.join(w, "pinch", `pinch-notes-take-${k}`), {
          recursive: true,
        })
    }
  const run = await claude(w, buildPrompt(d, roundTasks(dn)[r - 1], takes), {
    bash: true,
    agent: takes,
  })
  W(path.join(dest, "log.txt"), run.log)
  if (!existsSync(path.join(w, "index.html")))
    return log("build failed", dn, r, arm)
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", dn, `r${r}`, arm)
}

const earlier = (dn, r) => {
  const lines = []
  for (let k = 1; k < r; k++) {
    const f =
      k === 1 ? path.join(EXP, dn, "take.json") : at(dn, `r${k}`, "take.json")
    if (existsSync(f))
      for (const n of J(f).notes)
        lines.push(`${lines.length + 1}. On ${n.what}: "${n.words}"`)
  }
  return lines.join("\n")
}

async function judge() {
  const jobs = []
  for (const dn of DESIGNERS)
    for (const r of ROUNDS)
      for (const pass of [1, 2])
        jobs.push(async () => {
          const f = at(dn, `r${r}`, `verdict-ds-${pass}.json`)
          if (existsSync(f)) return
          const arms = JUDGED.filter((a) =>
            existsSync(at(dn, `r${r}`, a, "render.png")),
          )
          const d = J(path.join(EXP, dn, "designer.json"))
          const order = [...arms].sort(() => Math.random() - 0.5)
          const w = work()
          W(
            path.join(w, "designer.md"),
            `# The designer\n\n${d.designer}\n\n## Their taste\n\n${d.taste.map((t, k) => `${k}. ${t}`).join("\n")}\n`,
          )
          W(
            path.join(w, "earlier.md"),
            `# Earlier corrections\n\n${earlier(dn, r)}\n`,
          )
          W(path.join(w, "task.md"), roundTasks(dn)[r - 1])
          for (const [k, a] of order.entries())
            cpSync(
              at(dn, `r${r}`, a, "render.png"),
              path.join(w, `s${k + 1}.png`),
            )
          const run = await claude(w, judgePrompt(order.length), {
            minutes: 12,
          })
          const v = existsSync(path.join(w, "verdict.json"))
            ? lenient(readFileSync(path.join(w, "verdict.json"), "utf8"))
            : null
          if (!v) return log("judge failed", dn, r, run.log.slice(-200))
          const map = Object.fromEntries(order.map((a, k) => [`s${k + 1}`, a]))
          W(f, {
            screens: Object.fromEntries(
              Object.entries(v.screens).map(([s, x]) => [map[s], x]),
            ),
            rank: v.rank.map((s) => map[s]),
            why: v.why,
          })
          log("judged", dn, `r${r}`, pass)
        })
  await pool(jobs)
}

function measure() {
  const scores = existsSync(path.join(EXP, "measure-scores.json"))
    ? J(path.join(EXP, "measure-scores.json"))
    : {}
  for (const dn of DESIGNERS)
    for (const r of ROUNDS)
      for (const arm of ARMS) {
        const key = `${dn}/r${r}/${arm}`
        const page = at(dn, `r${r}`, arm, "index.html")
        if (scores[key] || !existsSync(page)) continue
        const run = spawnSync(
          "node",
          [path.join(EXP, dn, "measure", "oracle.mjs"), page],
          {
            encoding: "utf8",
            timeout: 120000,
          },
        )
        try {
          scores[key] = JSON.parse(
            (run.stdout ?? "").trim().split("\n").at(-1),
          ).points
        } catch {
          log("oracle failed on", key)
        }
      }
  W(path.join(EXP, "measure-scores.json"), scores)
}

function report() {
  const mean = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN
  const len = (x) => (Array.isArray(x) ? x.length : x)
  const groups = {
    "Takes only (M)": ["M"],
    "Design system only (S)": ["S", "S2"],
    "Design system and takes (SP)": ["SP", "SP2"],
  }
  const judged = (arms, key) =>
    DESIGNERS.flatMap((dn) =>
      ROUNDS.flatMap((r) =>
        [1, 2].flatMap((p) => {
          const f = at(dn, `r${r}`, `verdict-ds-${p}.json`)
          if (!existsSync(f)) return []
          const v = J(f)
          return arms.flatMap((a) => {
            if (!v.screens[a]) return []
            return [
              key === "rank" ? v.rank.indexOf(a) + 1 : len(v.screens[a][key]),
            ]
          })
        }),
      ),
    )
  const scores = existsSync(path.join(EXP, "measure-scores.json"))
    ? J(path.join(EXP, "measure-scores.json"))
    : {}
  const broken = (arms) =>
    Object.entries(scores)
      .filter(
        ([k]) =>
          DESIGNERS.includes(k.split("/")[0]) &&
          ROUNDS.includes(Number(k.split("/")[1].slice(1))) &&
          arms.includes(k.split("/")[2]),
      )
      .map(([, p]) => {
        const known = Object.values(p).filter((x) => x !== null)
        return known.length
          ? known.filter((x) => x === false).length / known.length
          : Number.NaN
      })
      .filter((x) => !Number.isNaN(x))
  const rows = [
    "| Way | Changes | Repeats | Taste points broken | Mean rank of 5 | Measurable points broken (oracle) |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Nothing (A) | | | | | ${(100 * mean(broken(["A"]))).toFixed(0)}% |`,
  ]
  for (const [name, arms] of Object.entries(groups))
    rows.push(
      `| ${name} | ${mean(judged(arms, "changes")).toFixed(1)} | ${mean(judged(arms, "repeats")).toFixed(1)} | ${mean(judged(arms, "breaks")).toFixed(1)} | ${mean(judged(arms, "rank")).toFixed(2)} | ${(100 * mean(broken(arms))).toFixed(0)}% |`,
    )
  // The design system with the takes against it alone, paired by cell and pass.
  let more = 0
  let less = 0
  let same = 0
  for (const dn of DESIGNERS)
    for (const r of ROUNDS)
      for (const p of [1, 2]) {
        const f = at(dn, `r${r}`, `verdict-ds-${p}.json`)
        if (!existsSync(f)) continue
        const { rank } = J(f)
        const sp = mean(
          ["SP", "SP2"].map((a) => rank.indexOf(a)).filter((x) => x >= 0),
        )
        const s = mean(
          ["S", "S2"].map((a) => rank.indexOf(a)).filter((x) => x >= 0),
        )
        if (sp < s) more++
        else if (sp > s) less++
        else same++
      }
  rows.push(
    "",
    `Judgings where the design system with the takes ranked above it alone: ${more}, below: ${less}, level: ${same}.`,
  )
  console.log(rows.join("\n"))
}

const stage = process.argv[2]
const stages = {
  ds: dsStage,
  build: () =>
    pool(
      DESIGNERS.flatMap((dn) =>
        ROUNDS.flatMap((r) => ARMS.map((arm) => () => buildFor(dn, r, arm))),
      ),
    ),
  judge,
  measure,
  report,
}
if (stages[stage]) await stages[stage]()
else console.error("Usage: design-system.mjs ds|build|judge|measure|report")
