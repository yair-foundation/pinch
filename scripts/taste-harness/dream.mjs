// When taste changes, do old takes hold the agent back, and does a "dream" pass fix it?
// (docs/taste-harness.md; the pass is the consolidation in Anthropic's "The components of agent
// memory", 2026-11-06.) For each made-up designer of rounds.mjs, after their first two takes 4 of
// their 12 taste points change. They correct two more screens with the new taste, so later takes
// contradict earlier ones. New screens are then built three ways, twice each:
//
//   R  the four takes, raw, as Export gives them
//   L  the same, with a line in each notes.md: where two notes disagree, the later take holds
//   D  the same raw takes, with an INDEX.md from a dream pass: each take in a line, every earlier note
//      a later one replaces, and words that look misheard. It rewrites nothing.
//
// A session holding the new taste and the 4 points given up judges them blind.
//
//   OUT=<dir> node scripts/taste-harness/dream.mjs flip|takes|dream|build|judge|report
//
// <dir> is rounds.mjs's (it reads each designer's rounds/pinch/ takes 1 and 2, and more-tasks.json).
// ONLY (default d2,d4,d5) and AT_ONCE (8) size it. Stages skip what exists.
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
const EXP = path.resolve(
  (process.env.OUT ?? "~/taste-harness").replace(
    /^~(?=$|\/)/,
    process.env.HOME ?? "~",
  ),
)
const DESIGNERS = (process.env.ONLY ?? "d2,d4,d5").split(",")
const AT_ONCE = Number(process.env.AT_ONCE || 8)
const ARMS = ["R", "R2", "L", "L2", "D", "D2"]
/** Tasks, by index into the designer's six: two for the new takes, two to judge on. */
const TAKE_TASKS = { 3: 2, 4: 3 }
const EVAL = [4, 5]
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-dream-"))
const at = (dn, ...p) => path.join(EXP, dn, "dream", ...p)

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
const tasksOf = (dn) => [
  ...J(path.join(EXP, dn, "designer.json")).tasks,
  ...J(path.join(EXP, dn, "more-tasks.json")).tasks,
]

const FLIP = `./designer.json describes a designer and their taste, 12 statements. Some months on, their taste has moved: exactly 4 of the 12 statements no longer hold, and each is replaced by a different preference they now hold instead, one a real person could arrive at (tired of a look, a new product direction), coherent with the 8 that stay. Change the 4 that would show most on a screen.

Write ./designer-v2.json and nothing else: the same object with "taste" holding the 12 statements as they are now (the 4 replaced in place, at the same index), plus "changed": [the 4 indexes] and "given_up": [the 4 old statements, word for word, in the same order]. Don't ask questions.`

const TAKE = `You are playing the designer described in ./designer.json; their taste there is hidden, they never write it down. Their coding agent just built a screen for them: ./render.png (1440 by 2400; blank space below the page's end means nothing). Open it and look closely.

Now they correct it the way they would in Pinch: talking aloud while pointing at spots with the cursor. Write 5 to 8 remarks, most important first. Each one:
- is about one spot they point at, and uses the pointing: "this", "these", "that bit" rather than naming the element in full;
- is spoken, informal and short, one or two sentences, a reaction and what they'd want instead, never a rule or a taste statement word for word;
- is honest to the taste as it is now: mostly what's wrong, plus one or two things they like if any are there.
For each, the box around the spot on render.png as fractions of its width and height (x, y of the top-left corner, w, h): look carefully so it sits on the element.

Write ./take.json and nothing else: {"notes": [{"words": "…", "box": {"x":0,"y":0,"w":0,"h":0}, "what": "a few words naming what's in the box", "taste": [indexes of the taste statements it reflects]}]}. Don't ask questions.`

const DREAM = `./pinch/ holds one designer's takes, folders pinch-notes-take-1 to pinch-notes-take-4, numbered in the order they were made. Each has a notes.md with notes they said while pointing at a screen, and images. Read every notes.md and open the images.

Write ./pinch/INDEX.md, and change nothing else: never edit or delete a note or a take. It is for the coding agent, who reads it before the takes. In this order:
1. A first line: "Read this first. The takes below are numbered in the order they were made; where two notes disagree, the later one holds."
2. "## Takes": one line per take: its number, the screen it was on, and what its notes are about, in a few words.
3. "## Replaced": every earlier note that a later note contradicts or changes, each as one line quoting the earlier note (take and number, its words) and the later one (take and number, its words). Only where they really disagree about the same kind of thing; a later note that only adds detail replaces nothing. If none, say so.
4. "## Words that look wrong": notes whose words look misheard or make no sense, with what they probably meant. If none, say so.
Keep it short. Don't ask questions.`

const LATER =
  "Takes are numbered in the order I made them. Where two of my notes disagree, the later take holds."

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task) => `${PROJECT(d)}.

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
) => `You are judging ${n} screens for one designer. ./designer.md says who they are and their taste now, point by point: they never wrote it down, but it is exactly what they want. ./given-up.md lists four things they used to want and no longer do. All ${n} screens were built for the task in ./task.md: ${Array.from({ length: n }, (_, i) => `./s${i + 1}.png`).join(", ")}, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at each closely. For each screen: the taste points by number it breaks (where it had a chance to show them), the given-up points by number it still follows (it does the old thing), and the changes this designer would ask for before it is theirs, one per distinct edit. Then rank all ${n} from closest to their taste now to furthest, ties not allowed.

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "outdated": [], "changes": 0}, …}, "rank": ["s2","s1",…], "why": "two sentences"}. Judge only what you see. Don't ask questions: no one is there to answer them.`

// ---------- the package of one take, as rounds.mjs makes it ----------
function pack(page, takeFile, pk) {
  const real = J(process.env.CHECK_JSON ?? path.join(EXP, "real-check.json"))
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
  W(
    path.join(pk, "notes.md"),
    `${[
      intro,
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
  W(path.join(pk, "pinch-check.md"), real.check)
}

/** A project's ./pinch/ holding takes 1 to n. */
function takesInto(dn, w, n) {
  for (let k = 1; k <= n; k++) {
    const pk =
      k <= 2
        ? path.join(EXP, dn, "rounds", "pinch", `pinch-notes-take-${k}`)
        : at(dn, "pinch", `pinch-notes-take-${k}`)
    if (existsSync(pk))
      cpSync(pk, path.join(w, "pinch", `pinch-notes-take-${k}`), {
        recursive: true,
      })
  }
}

async function buildInto(dn, task, dest, n, arm = "R") {
  if (existsSync(path.join(dest, "index.html"))) return
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  takesInto(dn, w, n)
  if (arm.startsWith("L"))
    for (const f of readdirSync(path.join(w, "pinch"))) {
      const md = path.join(w, "pinch", f, "notes.md")
      const text = readFileSync(md, "utf8")
      const first = text.indexOf("\n\n", text.indexOf("When you design for me"))
      writeFileSync(
        md,
        `${text.slice(0, first)}\n\n${LATER}${text.slice(first)}`,
      )
    }
  if (arm.startsWith("D"))
    cpSync(at(dn, "INDEX.md"), path.join(w, "pinch", "INDEX.md"))
  const run = await claude(
    w,
    buildPrompt(J(path.join(EXP, dn, "designer.json")), task),
    { bash: true, agent: true },
  )
  W(path.join(dest, "log.txt"), run.log)
  if (!existsSync(path.join(w, "index.html"))) return log("build failed", dest)
  mkdirSync(dest, { recursive: true })
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", path.relative(EXP, dest))
}

// ---------- stages ----------
async function flip() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      const f = at(dn, "designer-v2.json")
      if (existsSync(f)) return
      const w = work()
      cpSync(path.join(EXP, dn, "designer.json"), path.join(w, "designer.json"))
      const run = await claude(w, FLIP, { minutes: 8 })
      const v = existsSync(path.join(w, "designer-v2.json"))
        ? lenient(readFileSync(path.join(w, "designer-v2.json"), "utf8"))
        : null
      if (!v?.changed?.length)
        return log("flip failed", dn, run.log.slice(-300))
      W(f, v)
      log("flip", dn, v.changed)
    }),
  )
}

async function takes() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      const tasks = tasksOf(dn)
      for (const k of [3, 4]) {
        const page = at(dn, `take-${k}`, "page")
        await buildInto(dn, tasks[TAKE_TASKS[k]], page, k - 1)
        const f = at(dn, `take-${k}`, "take.json")
        if (!existsSync(f)) {
          const w = work()
          W(path.join(w, "designer.json"), J(at(dn, "designer-v2.json")))
          cpSync(path.join(page, "render.png"), path.join(w, "render.png"))
          const run = await claude(w, TAKE, { minutes: 10 })
          if (!existsSync(path.join(w, "take.json")))
            return log("take failed", dn, k, run.log.slice(-300))
          cpSync(path.join(w, "take.json"), f)
        }
        pack(page, f, at(dn, "pinch", `pinch-notes-take-${k}`))
        log("take", dn, k, J(f).notes.length, "notes")
      }
    }),
    DESIGNERS.length,
  )
}

async function dream() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      if (existsSync(at(dn, "INDEX.md"))) return
      const w = work()
      takesInto(dn, w, 4)
      const run = await claude(w, DREAM, { minutes: 15 })
      if (!existsSync(path.join(w, "pinch", "INDEX.md")))
        return log("dream failed", dn, run.log.slice(-300))
      cpSync(path.join(w, "pinch", "INDEX.md"), at(dn, "INDEX.md"))
      log("dream", dn)
    }),
  )
}

async function build() {
  await pool(
    DESIGNERS.flatMap((dn) =>
      EVAL.flatMap((t) =>
        ARMS.map(
          (arm) => () =>
            buildInto(dn, tasksOf(dn)[t], at(dn, `t${t + 1}`, arm), 4, arm),
        ),
      ),
    ),
  )
}

async function judge() {
  const jobs = []
  for (const dn of DESIGNERS)
    for (const t of EVAL)
      for (const pass of [1, 2])
        jobs.push(async () => {
          const f = at(dn, `t${t + 1}`, `verdict-${pass}.json`)
          if (existsSync(f)) return
          const v2 = J(at(dn, "designer-v2.json"))
          const present = ARMS.filter((a) =>
            existsSync(at(dn, `t${t + 1}`, a, "render.png")),
          )
          const order = [...present].sort(() => Math.random() - 0.5)
          const w = work()
          W(
            path.join(w, "designer.md"),
            `# The designer\n\n${v2.designer}\n\n## Their taste now\n\n${v2.taste.map((x, k) => `${k}. ${x}`).join("\n")}\n`,
          )
          W(
            path.join(w, "given-up.md"),
            `# What they no longer want\n\n${v2.given_up.map((x, k) => `${k}. ${x}`).join("\n")}\n`,
          )
          W(path.join(w, "task.md"), tasksOf(dn)[t])
          for (const [k, a] of order.entries())
            cpSync(
              at(dn, `t${t + 1}`, a, "render.png"),
              path.join(w, `s${k + 1}.png`),
            )
          const run = await claude(w, judgePrompt(order.length), {
            minutes: 12,
          })
          const v = existsSync(path.join(w, "verdict.json"))
            ? lenient(readFileSync(path.join(w, "verdict.json"), "utf8"))
            : null
          if (!v) return log("judge failed", dn, t, run.log.slice(-200))
          const map = Object.fromEntries(order.map((a, k) => [`s${k + 1}`, a]))
          W(f, {
            screens: Object.fromEntries(
              Object.entries(v.screens).map(([s, x]) => [map[s], x]),
            ),
            rank: v.rank.map((s) => map[s]),
            why: v.why,
          })
          log("judged", dn, `t${t + 1}`, pass)
        })
  await pool(jobs)
}

function report() {
  const mean = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN
  const len = (x) => (Array.isArray(x) ? x.length : x)
  const verdicts = DESIGNERS.flatMap((dn) =>
    EVAL.flatMap((t) =>
      [1, 2]
        .map((p) => at(dn, `t${t + 1}`, `verdict-${p}.json`))
        .filter(existsSync)
        .map(J),
    ),
  )
  const groups = {
    "Raw takes (R)": ["R", "R2"],
    "Later take holds (L)": ["L", "L2"],
    "Dream pass (D)": ["D", "D2"],
  }
  const rows = [
    `${verdicts.length} judgings`,
    "| Way | Changes | Taste points broken | Given-up points still followed | Mean rank of 6 |",
    "| --- | ---: | ---: | ---: | ---: |",
  ]
  for (const [name, arms] of Object.entries(groups)) {
    const pick = (key) =>
      verdicts.flatMap((v) =>
        arms
          .filter((a) => v.screens[a])
          .map((a) => len(v.screens[a][key] ?? [])),
      )
    const rank = verdicts.flatMap((v) =>
      arms.filter((a) => v.rank.includes(a)).map((a) => v.rank.indexOf(a) + 1),
    )
    rows.push(
      `| ${name} | ${mean(pick("changes")).toFixed(1)} | ${mean(pick("breaks")).toFixed(1)} | ${mean(pick("outdated")).toFixed(2)} | ${mean(rank).toFixed(2)} |`,
    )
  }
  for (const [x, y] of [
    ["D", "R"],
    ["L", "R"],
    ["D", "L"],
  ]) {
    let above = 0
    let below = 0
    let level = 0
    for (const v of verdicts) {
      const a = mean(
        [x, `${x}2`].map((s) => v.rank.indexOf(s)).filter((i) => i >= 0),
      )
      const b = mean(
        [y, `${y}2`].map((s) => v.rank.indexOf(s)).filter((i) => i >= 0),
      )
      if (a < b) above++
      else if (a > b) below++
      else level++
    }
    rows.push(
      `${x} ranked above ${y} in ${above} judgings, below in ${below}, level in ${level}.`,
    )
  }
  console.log(rows.join("\n"))
}

const stage = process.argv[2]
const stages = { flip, takes, dream, build, judge, report }
if (stages[stage]) await stages[stage]()
else console.error("Usage: dream.mjs flip|takes|dream|build|judge|report")
