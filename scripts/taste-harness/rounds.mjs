// The learning curve (docs/taste-harness.md): does an agent keep improving as a person's takes pile
// up, or does it flatten? For each made-up designer of run.mjs: round 1 is the agent's first screen,
// built with nothing; the designer corrects it by pointing and talking, as in Pinch, and each take
// goes into the project as a Pinch Export folder, `pinch-check.md` included. Rounds 2 to 6 build a
// new screen each, with every take so far in the project, and the designer corrects that too. Each
// round also builds the same task with nothing (the control), since tasks differ in difficulty. A
// fresh session holding the designer's hidden taste judges both screens: the changes it would ask
// for, the taste points broken and the earlier corrections repeated.
//
//   node --import tsx scripts/taste-harness/print-check.ts > <dir>/real-check.json
//   OUT=<dir> node scripts/taste-harness/rounds.mjs tasks|run|judge|report
//
// <dir> is run.mjs's, holding each designer's folder with designer.json, seed/ and take.json.
// ONLY (default d2,d4,d5), ROUNDS (6) and AT_ONCE (8) size it. Stages skip what exists.
import { spawn, spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
const ROUNDS = Number(process.env.ROUNDS || 6)
const AT_ONCE = Number(process.env.AT_ONCE || 8)
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
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
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-rounds-"))
const real = () => J(process.env.CHECK_JSON ?? path.join(EXP, "real-check.json"))
const at = (dn, ...p) => path.join(EXP, dn, "rounds", ...p)

function claude(cwd, prompt, { agent = false, bash = false, minutes = 25 } = {}) {
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
    ...(agent ? ["--output-format", "stream-json", "--verbose"] : []),
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

// ---------- prompts ----------
const MORE = (d) => `Read ./designer.json. This designer's coding agent has built three screens for them so far:
${d.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Write three more tasks for this product: screens they would ask the agent to build next, one or two sentences each, saying only what each screen holds and does, never how it looks. Each a different kind of screen from the others and from these three (for instance a detail page, an empty or first-use state, a settings or account screen, a calendar, a conversation or a report).

Write ./more.json and nothing else: {"tasks": ["…","…","…"]}. Don't ask questions.`

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task, memory) => `${PROJECT(d)}.${
  memory
    ? `

The designer's feedback on earlier screens is in ./pinch/: read all of it first and open the images. It is everything you know about their taste.`
    : ""
}

Build this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:

${task}

- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if you want a typeface; load nothing else from outside.
- No external images: draw with inline SVG or CSS, and write realistic text.
- Where you have no guidance, use your own judgment.

You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

const takePrompt = (n) => `You are playing the designer described in ./designer.json; their taste there is hidden, they never write it down. Their coding agent just built a screen for them: ./render.png (1440 by 2400; blank space below the page's end means nothing). Open it and look closely.

Now they correct it the way they would in Pinch: talking aloud while pointing at spots with the cursor. Write ${n === 1 ? "5 to 8" : "0 to 8"} remarks, most important first. Each one:
- is about one spot they point at, and uses the pointing: "this", "these", "that bit" rather than naming the element in full;
- is spoken, informal and short, one or two sentences, a reaction and what they'd want instead, never a rule or a taste statement word for word;
- is honest to the taste: what is still wrong on this screen, and any thing they like. A screen that already fits their taste gets few remarks or none: they never invent faults.
For each, the box around the spot on render.png as fractions of its width and height (x, y of the top-left corner, w, h): look carefully so it sits on the element.

Write ./take.json and nothing else: {"notes": [{"words": "…", "box": {"x":0,"y":0,"w":0,"h":0}, "what": "a few words naming what's in the box", "taste": [indexes of the taste statements it reflects]}]}. Don't ask questions.`

const judgePrompt = (n) => `You are judging ${n} screen${n > 1 ? "s" : ""} for one designer. ./designer.md says who they are and their taste point by point: they never wrote it down, but it is exactly what they want. ./earlier.md lists the corrections they gave their agent on earlier screens (none, in the first round). ${n > 1 ? `All ${n} screens were` : "The screen was"} built for the task in ./task.md: ${Array.from({ length: n }, (_, i) => `./s${i + 1}.png`).join(", ")}, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at ${n > 1 ? "each" : "it"} closely. For each screen: the taste points by number it breaks (where it had a chance to show them), the earlier corrections by number that it repeats (the same mistake made again, on this screen), and the changes this designer would ask for before it is theirs, one per distinct edit.${n > 1 ? ` Then rank all ${n} from closest to their taste to furthest, ties not allowed.` : ""}

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "repeats": [], "changes": 0}${n > 1 ? ", …" : ""}}, "rank": [${n > 1 ? '"s2","s1"' : '"s1"'}], "why": "two sentences"}. Judge only what you see. Don't ask questions: no one is there to answer them.`

// ---------- the package of one take ----------
/** One take as the Export folder: notes.md with where each note is, the marked copy, the close-ups. */
function pack(screen, takeFile, pk) {
  const notes = J(takeFile).notes
  rmSync(pk, { recursive: true, force: true })
  if (!notes.length) return 0
  const c = spawnSync(
    "python3",
    [
      "-I",
      path.join(HERE, "crop.py"),
      path.join(screen, "render.png"),
      path.join(screen, "render-text.json"),
      takeFile,
      pk,
    ],
    { encoding: "utf8" },
  )
  if (c.status) throw new Error(c.stderr)
  const where = J(path.join(pk, "where.json"))
  rmSync(path.join(pk, "where.json"))
  const r = real()
  const [intro, marks] = [
    r.notes.split("Each note has a number.")[0],
    `Each note has a number.${r.notes.split("Each note has a number.")[1].split("\n")[0]}`,
  ]
  W(
    path.join(pk, "notes.md"),
    `${[
      intro.trimEnd(),
      "",
      marks,
      "",
      "## screen.png",
      "",
      "My own work.",
      "Screenshot: `screens/1.png`",
      "Marked copy: `marked/1.png`",
      "",
      ...notes.flatMap((n, k) => [
        `- ${k + 1}. (\`close-ups/1-${k + 1}.png\`) ${n.words}`,
        `  ${where[k].where}`,
      ]),
    ].join("\n")}\n`,
  )
  W(path.join(pk, "pinch-check.md"), r.check)
  return notes.length
}

// ---------- stages ----------
async function tasksStage() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      const f = path.join(EXP, dn, "more-tasks.json")
      if (existsSync(f)) return
      const w = work()
      const d = J(path.join(EXP, dn, "designer.json"))
      cpSync(path.join(EXP, dn, "designer.json"), path.join(w, "designer.json"))
      const r = await claude(w, MORE(d), { minutes: 8 })
      if (!existsSync(path.join(w, "more.json")))
        return log("tasks failed", dn, r.log.slice(-300))
      W(f, J(path.join(w, "more.json")))
      log("tasks", dn)
    }),
  )
}
const roundTasks = (dn) => [
  ...J(path.join(EXP, dn, "designer.json")).tasks,
  ...J(path.join(EXP, dn, "more-tasks.json")).tasks,
]

async function buildFor(dn, r, arm) {
  const dest = at(dn, `r${r}`, arm)
  if (existsSync(path.join(dest, "index.html"))) return
  const d = J(path.join(EXP, dn, "designer.json"))
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  if (arm === "M")
    for (let k = 1; k < r; k++) {
      const pk = at(dn, "pinch", `pinch-notes-take-${k}`)
      if (existsSync(pk))
        cpSync(pk, path.join(w, "pinch", `pinch-notes-take-${k}`), {
          recursive: true,
        })
    }
  const run = await claude(w, buildPrompt(d, roundTasks(dn)[r - 1], arm === "M"), {
    bash: true,
    agent: arm === "M",
  })
  W(path.join(dest, "log.txt"), run.log)
  if (!existsSync(path.join(w, "index.html")))
    return log("build failed", dn, r, arm)
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", dn, `r${r}`, arm)
}

async function takeOf(dn, r, screen) {
  const f = r === 1 ? path.join(EXP, dn, "take.json") : at(dn, `r${r}`, "take.json")
  if (!existsSync(f)) {
    const w = work()
    cpSync(path.join(EXP, dn, "designer.json"), path.join(w, "designer.json"))
    cpSync(path.join(screen, "render.png"), path.join(w, "render.png"))
    const run = await claude(w, takePrompt(r), { minutes: 10 })
    if (!existsSync(path.join(w, "take.json")))
      return log("take failed", dn, r, run.log.slice(-300))
    cpSync(path.join(w, "take.json"), f)
  }
  const n = pack(screen, f, at(dn, "pinch", `pinch-notes-take-${r}`))
  log("take", dn, `r${r}`, n, "notes")
}

async function chain(dn) {
  await takeOf(dn, 1, path.join(EXP, dn, "seed"))
  for (let r = 2; r <= ROUNDS; r++) {
    await buildFor(dn, r, "M")
    if (r < ROUNDS) await takeOf(dn, r, at(dn, `r${r}`, "M"))
  }
}

async function run() {
  const controls = DESIGNERS.flatMap((dn) =>
    Array.from({ length: ROUNDS - 1 }, (_, i) => () => buildFor(dn, i + 2, "A")),
  )
  await Promise.all([
    ...DESIGNERS.map((dn) => chain(dn)),
    pool(controls, Math.max(2, AT_ONCE - DESIGNERS.length)),
  ])
}

const earlier = (dn, r) => {
  const lines = []
  for (let k = 1; k < r; k++) {
    const f = k === 1 ? path.join(EXP, dn, "take.json") : at(dn, `r${k}`, "take.json")
    if (existsSync(f))
      for (const n of J(f).notes)
        lines.push(`${lines.length + 1}. On ${n.what}: "${n.words}"`)
  }
  return lines.length ? lines.join("\n") : "(none yet)"
}

async function judge() {
  const jobs = []
  for (const dn of DESIGNERS)
    for (let r = 1; r <= ROUNDS; r++) {
      if (r === 1) {
        const a = at(dn, "r1", "A")
        mkdirSync(a, { recursive: true })
        cpSync(path.join(EXP, dn, "seed", "render.png"), path.join(a, "render.png"))
      }
      for (const pass of [1, 2])
        jobs.push(async () => {
          const f = at(dn, `r${r}`, `verdict-${pass}.json`)
          if (existsSync(f)) return
          const arms = ["A", "M"].filter((a) =>
            existsSync(at(dn, `r${r}`, a, "render.png")),
          )
          if (!arms.length) return
          const d = J(path.join(EXP, dn, "designer.json"))
          const order = [...arms].sort(() => Math.random() - 0.5)
          const w = work()
          W(
            path.join(w, "designer.md"),
            `# The designer\n\n${d.designer}\n\n## Their taste\n\n${d.taste.map((t, k) => `${k}. ${t}`).join("\n")}\n`,
          )
          W(path.join(w, "earlier.md"), `# Earlier corrections\n\n${earlier(dn, r)}\n`)
          W(path.join(w, "task.md"), roundTasks(dn)[r - 1])
          for (const [k, a] of order.entries())
            cpSync(
              at(dn, `r${r}`, a, "render.png"),
              path.join(w, `s${k + 1}.png`),
            )
          const run = await claude(w, judgePrompt(order.length), { minutes: 12 })
          if (!existsSync(path.join(w, "verdict.json")))
            return log("judge failed", dn, r, run.log.slice(-200))
          const v = lenient(readFileSync(path.join(w, "verdict.json"), "utf8"))
          if (!v) return log("judge unreadable", dn, r, pass)
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
    }
  await pool(jobs)
}

function report() {
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
  const len = (x) => (Array.isArray(x) ? x.length : x)
  const cell = (r, arm, key) =>
    DESIGNERS.flatMap((dn) =>
      [1, 2].flatMap((p) => {
        const f = at(dn, `r${r}`, `verdict-${p}.json`)
        const s = existsSync(f) ? J(f).screens[arm] : null
        return s ? [len(s[key])] : []
      }),
    )
  const lines = [
    "| round | changes, with the takes | changes, with nothing | repeats, with the takes | repeats, with nothing | taste points broken, with the takes | with nothing | remarks the designer made |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ]
  for (let r = 1; r <= ROUNDS; r++) {
    const remarks = DESIGNERS.flatMap((dn) => {
      const f = r === 1 ? path.join(EXP, dn, "take.json") : at(dn, `r${r}`, "take.json")
      return existsSync(f) ? [J(f).notes.length] : []
    })
    const f1 = (x) => (Number.isNaN(x) ? "–" : x.toFixed(1))
    lines.push(
      `| ${r} | ${r === 1 ? "–" : f1(mean(cell(r, "M", "changes")))} | ${f1(mean(cell(r, "A", "changes")))} | ${r === 1 ? "–" : f1(mean(cell(r, "M", "repeats")))} | ${f1(mean(cell(r, "A", "repeats")))} | ${r === 1 ? "–" : f1(mean(cell(r, "M", "breaks")))} | ${f1(mean(cell(r, "A", "breaks")))} | ${f1(mean(remarks))} |`,
    )
  }
  const wins = [0, 0, 0]
  for (const dn of DESIGNERS)
    for (let r = 2; r <= ROUNDS; r++)
      for (const p of [1, 2]) {
        const f = at(dn, `r${r}`, `verdict-${p}.json`)
        if (!existsSync(f)) continue
        const { rank } = J(f)
        if (rank.length < 2) continue
        wins[rank[0] === "M" ? 0 : 1]++
      }
  lines.push(
    "",
    `The screen built with the takes ranked first in ${wins[0]} judgings of ${wins[0] + wins[1]}.`,
    "",
    "Per designer, changes with the takes by round:",
  )
  for (const dn of DESIGNERS)
    lines.push(
      `${dn}: ${Array.from({ length: ROUNDS - 1 }, (_, i) => {
        const xs = [1, 2].flatMap((p) => {
          const f = at(dn, `r${i + 2}`, `verdict-${p}.json`)
          const s = existsSync(f) ? J(f).screens.M : null
          return s ? [len(s.changes)] : []
        })
        return mean(xs).toFixed(1)
      }).join("  ")}`,
    )
  console.log(lines.join("\n"))
}

const stage = process.argv[2]
const stages = { tasks: tasksStage, run, judge, report }
if (stages[stage]) await stages[stage]()
else console.error("Usage: rounds.mjs tasks|run|judge|report")
