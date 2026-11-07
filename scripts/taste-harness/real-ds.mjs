// Pinch on top of a real design system (docs/taste-harness.md). The design system is a folder the
// person supplies, put in each build's project as ./design-system/ and kept out of this repository.
// A made-up senior designer who works with it every day, with a taste of their own on top of it,
// corrects two pages built with it, by pointing and talking as in Pinch. Three new pages are then
// built twice with the design system alone (S, S2) and twice with it and the takes (SPD, SPD2,
// whose notes.md says to keep the design system's values), and judged blind by a session holding
// the designer's taste.
//
//   OUT=<dir> DS=<design system folder> NAME=<short name> node scripts/taste-harness/real-ds.mjs designer|takes|build|judge|report
//
// The design system must have a styles.css at its root (it is linked from every page) and a
// README.md; the prompts send the agent to its guidelines/00-index.md where there is one.
// Everything is written under <dir>/real/<name>/. Stages skip what exists.
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
const home = (p) =>
  path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"))
const EXP = home(process.env.OUT ?? "~/taste-harness")
const DS = process.env.DS ? home(process.env.DS) : null
const NAME = process.env.NAME ?? "ds1"
const ROOT = path.join(EXP, "real", NAME)
const AT_ONCE = Number(process.env.AT_ONCE || 6)
const ARMS = ["S", "S2", "SPD", "SPD2"]
const EVAL = [2, 3, 4]
/** What the pages are: "web pages" for a marketing system, "product screens" for a product one. */
const SURFACE = process.env.SURFACE ?? "web pages"
/** What a build may load from outside, when the design system's own pages load more than Tailwind. */
const OUTSIDE =
  process.env.OUTSIDE ??
  'Load Tailwind with <script src="https://cdn.tailwindcss.com"></script> if you want it, and nothing else from outside: images and fonts come from ./design-system/ only.'
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-real-"))

function claude(
  cwd,
  prompt,
  { agent = false, bash = false, minutes = 30 } = {},
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
/** A project folder holding the design system, linked rather than copied: it can be large. */
function project() {
  const w = work()
  spawnSync("cp", ["-al", DS, path.join(w, "design-system")])
  if (!existsSync(path.join(w, "design-system")))
    cpSync(DS, path.join(w, "design-system"), { recursive: true })
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  return w
}
/** Draws a page where it was built, beside its design system, and keeps the drawing. */
function keep(w, dest) {
  spawnSync("node", ["render.mjs"], { cwd: w, encoding: "utf8" })
  mkdirSync(dest, { recursive: true })
  for (const f of ["index.html", "render.png", "render-text.json"])
    if (existsSync(path.join(w, f))) cpSync(path.join(w, f), path.join(dest, f))
  rmSync(w, { recursive: true, force: true })
  return existsSync(path.join(dest, "render.png"))
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

const DESIGNER = `./design-system/ is the design system of the company you work at. Read its README.md, then guidelines/00-index.md where there is one and the guidelines it says to read first for ${SURFACE}, and look at a few of its components and references.

You play a senior designer there who uses this system every day and has a strong taste of their own on top of it: what the system leaves open, where agents and newer designers misuse it, and their own preferences within its rules. Invent them.

Write ./designer.json and nothing else:
{"designer": "who they are, one paragraph", "product": "what the company's pages are for, one line", "taste": [12 statements], "tasks": [5 tasks]}
- taste: 12 statements, each concrete enough to check on a rendered page, consistent with the design system's laws but beyond what it states: none simply restates one of its rules. Cover hierarchy, layout and spacing, type in use, colour in use, imagery, components in use and the words.
- tasks: 5 ${SURFACE} they would ask the coding agent to build, one or two sentences each, saying only what each holds and does, never how it looks; each a different kind.
Don't ask questions.`

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task, takes) => `${PROJECT(d)}.

This project has the company's design system in ./design-system/: read its README.md and, where it has one, guidelines/00-index.md first, follow them, and look at its components and references. Link ./design-system/styles.css from the page, and use its tokens, fonts, assets and photography by relative path.${
  takes
    ? `

The designer's feedback on earlier pages is in ./pinch/: read all of it too and open the images.`
    : ""
}

Build this, as one HTML file, ./index.html, for a desktop window 1440px wide:

${task}

- ${OUTSIDE}
- Write realistic text.
- Where you have no guidance, use your own judgment.

You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

const TAKE = `You are playing the designer described in ./designer.json; their taste there is hidden, they never write it down. Their coding agent just built a page for them with the company's design system: ./render.png (1440 by 2400; blank space below the page's end means nothing). Open it and look closely.

Now they correct it the way they would in Pinch: talking aloud while pointing at spots with the cursor. Write 5 to 8 remarks, most important first. Each one:
- is about one spot they point at, and uses the pointing: "this", "these", "that bit" rather than naming the element in full;
- is spoken, informal and short, one or two sentences, a reaction and what they'd want instead, never a rule or a taste statement word for word;
- is honest to the taste: mostly what's wrong, plus one or two things they like if any are there.
For each, the box around the spot on render.png as fractions of its width and height (x, y of the top-left corner, w, h): look carefully so it sits on the element.

Write ./take.json and nothing else: {"notes": [{"words": "…", "box": {"x":0,"y":0,"w":0,"h":0}, "what": "a few words naming what's in the box", "taste": [indexes of the taste statements it reflects]}]}. Don't ask questions.`

const DEFER =
  "Where this project has a design system, use its values, tokens and components as they are; read these notes for how and where to use them, and for what still comes out wrong."

const judgePrompt = (
  n,
) => `You are judging ${n} pages for one designer at a company with its own design system. ./designer.md says who they are and their taste point by point: they never wrote it down, but it is exactly what they want, on top of the design system. ./earlier.md lists the corrections they gave their agent on earlier pages. All ${n} pages were built for the task in ./task.md: ${Array.from({ length: n }, (_, i) => `./s${i + 1}.png`).join(", ")}, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at each closely. For each page: the taste points by number it breaks (where it had a chance to show them), the earlier corrections by number that it repeats (the same mistake made again, on this page), and the changes this designer would ask for before it is theirs, one per distinct edit. Then rank all ${n} from closest to their taste to furthest, ties not allowed.

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "repeats": [], "changes": 0}, …}, "rank": ["s2","s1",…], "why": "two sentences"}. Judge only what you see. Don't ask questions: no one is there to answer them.`

const designer = () => J(path.join(ROOT, "designer.json"))

async function designerStage() {
  if (existsSync(path.join(ROOT, "designer.json"))) return
  const w = project()
  const run = await claude(w, DESIGNER, { minutes: 20 })
  if (!existsSync(path.join(w, "designer.json")))
    return log("designer failed", run.log.slice(-400))
  W(path.join(ROOT, "designer.json"), J(path.join(w, "designer.json")))
  log("designer", NAME)
}

async function build(task, dest, takes) {
  if (existsSync(path.join(dest, "render.png"))) return
  const w = project()
  if (takes)
    cpSync(path.join(ROOT, "pinch"), path.join(w, "pinch"), { recursive: true })
  const run = await claude(w, buildPrompt(designer(), task, takes), {
    bash: true,
    agent: takes,
  })
  W(`${dest}.log`, run.log)
  if (!existsSync(path.join(w, "index.html"))) return log("build failed", dest)
  if (keep(w, dest)) log("built", path.relative(ROOT, dest))
}

function pack(page, takeFile, pk, real) {
  rmSync(pk, { recursive: true, force: true })
  const notes = J(takeFile).notes
  const c = spawnSync(
    "python3",
    [
      "-I",
      path.join(HERE, "crop.py"),
      path.join(page, "render.png"),
      path.join(page, "render-text.json"),
      takeFile,
      pk,
    ],
    { encoding: "utf8" },
  )
  if (c.status) throw new Error(c.stderr)
  const where = J(path.join(pk, "where.json"))
  rmSync(path.join(pk, "where.json"))
  const intro = real.notes.split("Each note has a number.")[0].trimEnd()
  const marks = `Each note has a number.${real.notes.split("Each note has a number.")[1].split("\n")[0]}`
  const opening =
    "When you design for me, read all of this first and open the images: it is everything you know about my taste."
  W(
    path.join(pk, "notes.md"),
    `${[
      intro.replace(opening, `${opening}\n\n${DEFER}`),
      "",
      marks,
      "",
      "## page.png",
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
  W(path.join(pk, "pinch-check.md"), real.check)
}

async function takesStage() {
  const real = J(process.env.CHECK_JSON ?? path.join(EXP, "real-check.json"))
  const d = designer()
  await pool(
    [0, 1].map(
      (k) => () =>
        build(d.tasks[k], path.join(ROOT, `take-${k + 1}`, "page"), false),
    ),
  )
  for (const k of [1, 2]) {
    const page = path.join(ROOT, `take-${k}`, "page")
    const f = path.join(ROOT, `take-${k}`, "take.json")
    if (!existsSync(f)) {
      const w = work()
      cpSync(path.join(ROOT, "designer.json"), path.join(w, "designer.json"))
      cpSync(path.join(page, "render.png"), path.join(w, "render.png"))
      const run = await claude(w, TAKE, { minutes: 10 })
      if (!existsSync(path.join(w, "take.json")))
        return log("take failed", k, run.log.slice(-300))
      cpSync(path.join(w, "take.json"), f)
    }
    pack(page, f, path.join(ROOT, "pinch", `pinch-notes-take-${k}`), real)
    log("take", k, J(f).notes.length, "notes")
  }
}

async function buildStage() {
  const d = designer()
  await pool(
    EVAL.flatMap((t) =>
      ARMS.map(
        (arm) => () =>
          build(
            d.tasks[t],
            path.join(ROOT, `t${t + 1}`, arm),
            arm.startsWith("SPD"),
          ),
      ),
    ),
  )
}

const earlier = () =>
  [1, 2]
    .flatMap((k) => {
      const f = path.join(ROOT, `take-${k}`, "take.json")
      return existsSync(f) ? J(f).notes : []
    })
    .map((n, i) => `${i + 1}. On ${n.what}: "${n.words}"`)
    .join("\n")

async function judgeStage() {
  const d = designer()
  await pool(
    EVAL.flatMap((t) =>
      [1, 2].map((pass) => async () => {
        const f = path.join(ROOT, `t${t + 1}`, `verdict-${pass}.json`)
        if (existsSync(f)) return
        const present = ARMS.filter((a) =>
          existsSync(path.join(ROOT, `t${t + 1}`, a, "render.png")),
        )
        const order = [...present].sort(() => Math.random() - 0.5)
        const w = work()
        W(
          path.join(w, "designer.md"),
          `# The designer\n\n${d.designer}\n\n## Their taste\n\n${d.taste.map((x, k) => `${k}. ${x}`).join("\n")}\n`,
        )
        W(path.join(w, "earlier.md"), `# Earlier corrections\n\n${earlier()}\n`)
        W(path.join(w, "task.md"), d.tasks[t])
        for (const [k, a] of order.entries())
          cpSync(
            path.join(ROOT, `t${t + 1}`, a, "render.png"),
            path.join(w, `s${k + 1}.png`),
          )
        const run = await claude(w, judgePrompt(order.length), { minutes: 12 })
        const v = existsSync(path.join(w, "verdict.json"))
          ? lenient(readFileSync(path.join(w, "verdict.json"), "utf8"))
          : null
        if (!v) return log("judge failed", t, run.log.slice(-200))
        const map = Object.fromEntries(order.map((a, k) => [`s${k + 1}`, a]))
        W(f, {
          screens: Object.fromEntries(
            Object.entries(v.screens).map(([s, x]) => [map[s], x]),
          ),
          rank: v.rank.map((s) => map[s]),
          why: v.why,
        })
        log("judged", `t${t + 1}`, pass)
      }),
    ),
  )
}

function report() {
  const mean = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN
  const len = (x) => (Array.isArray(x) ? x.length : x)
  const verdicts = EVAL.flatMap((t) =>
    [1, 2]
      .map((p) => path.join(ROOT, `t${t + 1}`, `verdict-${p}.json`))
      .filter(existsSync)
      .map(J),
  )
  const groups = {
    "Design system alone": ["S", "S2"],
    "Design system and takes": ["SPD", "SPD2"],
  }
  const rows = [
    `${NAME}: ${verdicts.length} judgings`,
    "| Way | Changes | Repeats | Taste points broken | Mean rank of 4 |",
    "| --- | ---: | ---: | ---: | ---: |",
  ]
  for (const [name, arms] of Object.entries(groups)) {
    const pick = (key) =>
      verdicts.flatMap((v) =>
        arms.filter((a) => v.screens[a]).map((a) => len(v.screens[a][key])),
      )
    const rank = verdicts.flatMap((v) =>
      arms.filter((a) => v.rank.includes(a)).map((a) => v.rank.indexOf(a) + 1),
    )
    rows.push(
      `| ${name} | ${mean(pick("changes")).toFixed(1)} | ${mean(pick("repeats")).toFixed(1)} | ${mean(pick("breaks")).toFixed(1)} | ${mean(rank).toFixed(2)} |`,
    )
  }
  let above = 0
  let below = 0
  let level = 0
  for (const v of verdicts) {
    const a = mean(
      ["SPD", "SPD2"].map((x) => v.rank.indexOf(x)).filter((x) => x >= 0),
    )
    const b = mean(
      ["S", "S2"].map((x) => v.rank.indexOf(x)).filter((x) => x >= 0),
    )
    if (a < b) above++
    else if (a > b) below++
    else level++
  }
  rows.push(
    `With the takes ranked above the design system alone in ${above} judgings, below in ${below}, level in ${level}.`,
  )
  console.log(rows.join("\n"))
}

const stage = process.argv[2]
const stages = {
  designer: designerStage,
  takes: takesStage,
  build: buildStage,
  judge: judgeStage,
  report,
}
if (!DS && stage !== "report")
  console.error("Set DS to the design system's folder.")
else if (stages[stage]) await stages[stage]()
else console.error("Usage: real-ds.mjs designer|takes|build|judge|report")
