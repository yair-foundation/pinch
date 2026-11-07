// The taste harness, simulated (docs/taste-harness.md). Made-up designers with a hidden taste
// correct an agent's first screen by pointing and talking; new screens are then built five ways:
//   A no memory · B the take as a Pinch folder · C B, then a separate check against the take and a fix
//   D B, then a generic design review and a fix · E B, with a line in notes.md asking for the check
//   F B, with the check as a sub-agent file in the project and a line in notes.md to run it
//   G F on Haiku · H F reading words first · I H on Haiku, with pictures at half size (D178)
// and judged blind by a session holding the hidden taste. Every step is a `claude -p` session.
//
//   OUT=~/taste-harness node scripts/taste-harness/run.mjs all     designers to judging, arms A–D
//   ONLY=1,3,4 node scripts/taste-harness/run.mjs e|judgeE|f|judgeF   arms E and F, judged against B and C
//   ONLY=1,3,4 node scripts/taste-harness/run.mjs ghi|judgeCost       arms G to I, judged with B and F
//   python3 -I scripts/taste-harness/cost.py ~/taste-harness            what each screen cost
//   python3 -I scripts/taste-harness/report.py ~/taste-harness
//
// Stages are designers, seed, take, build, check, judge, report; each skips what exists, so
// rerun to resume. ONLY picks designers by index, SKIP_D leaves arm D out, RUNS and AT_ONCE size it.
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
  (process.env.OUT ?? "~/taste-harness").replace(/^~(?=$|\/)/, process.env.HOME ?? "~"),
)
mkdirSync(EXP, { recursive: true })
const AT_ONCE = Number(process.env.AT_ONCE || 6)
const RUNS = Number(process.env.RUNS || 2)
const DESIGNERS = [
  "a budgeting and invoicing app for freelance illustrators",
  "a class booking app for small independent yoga and pilates studios. This designer is loud and playful, the opposite of quiet editorial minimalism: think heavy chunky grotesque type, big saturated flat colour blocks, thick dark outlines, hard offset shadows, generous radius on purpose, cheeky copy. No warm-paper-and-serif look",
  "an incident and on-call dashboard for site reliability teams",
  "a recipe and meal-planning app for families. This designer loves soft, cute and illustrated: pastel colour fields, big rounded friendly sans, chunky hand-drawn style illustrations made in CSS/SVG, bouncy rounded shapes, warm jokey copy. No warm-paper-and-serif look, no editorial minimalism",
  "a ticketing and line-up app for an underground electronic music festival. This designer is a dark, high-contrast brutalist: black background, one acid neon colour, enormous condensed uppercase type, raw visible grid lines, mono metadata, harsh and dense. No warm-paper-and-serif look, no soft cards",
]
const IDX = process.env.ONLY
  ? process.env.ONLY.split(",").map(Number)
  : [0, 1, 2]
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function claude(
  cwd,
  prompt,
  { bash = false, minutes = 20, agent = false } = {},
) {
  const args = [
    "-p",
    prompt,
    "--tools",
    (bash ? "Read,Write,Glob,Grep,Bash" : "Read,Write,Glob,Grep") +
      (agent ? ",Agent" : ""),
    "--allowedTools",
    "Read",
    "Write",
    "Glob",
    "Grep",
    ...(agent ? ["Agent"] : []),
    ...(bash ? ["Bash(node render.mjs)", "Bash(node render.mjs:*)"] : []),
    "--permission-mode",
    "acceptEdits",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-session-persistence",
    // With a sub-agent allowed, the log keeps every step, to count the checks that ran.
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
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-exp-"))
const dd = (i) => path.join(EXP, `d${i + 1}`)

// ---------- prompts ----------
const designerPrompt = (
  product,
) => `You are helping run a test by playing a product designer who is designing ${product}. Invent them.

1. Who they are: one short paragraph.
2. Their taste: exactly 12 statements, each concrete enough to check on a rendered web page ("Headlines are set in a light serif, never bold", not "Clean typography"). Cover type, colour, layout and spacing, components, imagery or icons, and the words on the page. At least 8 of the 12 must go against what an AI coding agent tends to do by default when asked to build a screen with Tailwind (for instance its rounded cards with soft shadows, gradient heroes, indigo/violet accents, emoji or generic icons, centred hero layouts, pill badges everywhere, three equal feature cards, chatty marketing copy). Their taste is coherent, the taste of one real person, not a list of contrarian points. It is hidden: the designer never writes it down.
3. Three tasks: screens of their product they would ask a coding agent to build, one or two sentences each, saying only what each screen holds and does, never how it looks. The three screens should be different kinds (e.g. a list, a form or settings, an overview).

Write ./designer.json and nothing else: {"designer": "…", "product": "…one line naming and describing the product…", "taste": ["…"], "tasks": ["…","…","…"]}. Don't ask questions.`

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task, memory, lean = false) => `${PROJECT(d)}.${
  memory
    ? lean
      ? `

The designer's feedback on earlier screens is in ./pinch/: read it first. It is everything you know about their taste.`
      : `

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

const takePrompt = `You are playing the designer described in ./designer.json; their taste there is hidden, they never write it down. Their coding agent just built its first screen for them: ./render.png (1440 by 2400; blank space below the page's end means nothing). Open it and look closely.

Now they correct it the way they would in Pinch: talking aloud while pointing at spots with the cursor. Write 5 to 8 remarks, most important first. Each one:
- is about one spot they point at, and uses the pointing: "this", "these", "that bit" rather than naming the element in full;
- is spoken, informal and short, one or two sentences, a reaction and what they'd want instead, never a rule or a taste statement word for word;
- is honest to the taste: mostly what's wrong, plus one or two things they like if any are there.
For each, the box around the spot on render.png as fractions of its width and height (x, y of the top-left corner, w, h): look carefully so it sits on the element.

Write ./take.json and nothing else: {"notes": [{"words": "…", "box": {"x":0,"y":0,"w":0,"h":0}, "what": "a few words naming what's in the box", "taste": [indexes of the taste statements it reflects]}]}. Don't ask questions.`

const checkPrompt = (taste) =>
  taste
    ? `You check a screen before the designer sees it. ./pinch/ holds everything this designer has said about earlier screens: each note is tied to a spot they pointed at, with a close-up and marked copy, so open the images. ./render.png is the agent's new screen for the task in ./task.md, with its code in ./index.html.

Find where the new screen repeats something the designer corrected before, or goes against what they said they like or don't. Only what their notes support: carry a note across to a different element only where it plainly has the same role. Don't add taste of your own. At most 6, the most important first, or none.

Write ./check.json and nothing else: {"findings": [{"note": "the note's number and its words, quoted", "where": "what in the new screen", "fix": "the change to make"}]}. Don't ask questions.`
    : `You review a screen before the client sees it, as a senior product designer would. ./render.png is the new screen for the task in ./task.md, with its code in ./index.html.

Find the most important design problems: hierarchy, layout, type, colour, components, the words. At most 6, the most important first, or none.

Write ./check.json and nothing else: {"findings": [{"where": "what in the screen", "problem": "…", "fix": "the change to make"}]}. Don't ask questions.`

const fixPrompt = (
  d,
) => `${PROJECT(d)}. The designer's feedback on earlier screens is in ./pinch/: read it and open the images. ./index.html is the screen you built for the task in ./task.md, and ./check.json is a review of it.

Make the changes in the review that are right for this designer, and change nothing else. Then \`node render.mjs\` and open ./render.png to check it.

Write ./index.html and nothing else. Don't ask questions.`

const judgePrompt = (
  n,
) => `You are judging ${n} screens for one designer. ./designer.md says who they are and their taste point by point: they never wrote it down, but it is exactly what they want. ./earlier.md lists the corrections they gave their agent on an earlier screen. All ${n} screens were built for the task in ./task.md: ./s1.png … ./s${n}.png, rendered 1440 by 2400 (blank space below a page's end means nothing).

Look at each closely. For each screen: the taste points by number it breaks (where it had a chance to show them), the earlier corrections by number that it repeats (the same mistake made again, on this screen), and the changes this designer would ask for before it is theirs, one per distinct edit. Then rank all ${n} from closest to their taste to furthest, ties not allowed.

Write ./verdict.json and nothing else: {"screens": {"s1": {"breaks": [], "repeats": [], "changes": 0}, …}, "rank": ["s3","s1",…], "why": "two sentences"}. Judge only what you see. Don't ask questions.`

// ---------- stages ----------
async function designers() {
  await pool(
    DESIGNERS.map((p, i) => async () => {
      if (!IDX.includes(i)) return
      const f = path.join(dd(i), "designer.json")
      if (existsSync(f)) return
      const w = work()
      const r = await claude(w, designerPrompt(p), { minutes: 8 })
      if (existsSync(path.join(w, "designer.json"))) {
        W(f, J(path.join(w, "designer.json")))
        log("designer", i + 1)
      } else log("designer failed", i + 1, r.log.slice(-500))
    }),
  )
}

const CHECK_LINE =
  "Before you show me a screen, check it against these notes: draw it, then have a fresh agent that sees only this folder and your drawing list where the screen repeats something I said or goes against it, and fix those. Only what my notes say: don't add taste of your own."
const AGENT_LINE =
  "Before you show me a screen, draw it and run the pinch-check agent on the drawing, then fix what it finds."
/** Arm F: the check as a sub-agent the export puts in the project, as Claude Code reads it. */
const CHECK_AGENT = `---
name: pinch-check
description: Checks a drawn screen against the designer's Pinch notes in ./pinch/. Use it every time after drawing a screen, before saying it is done. Give it the path of the drawing.
tools: Read, Glob
---

You check a screen before the designer sees it. ./pinch/ holds everything this designer has said about earlier screens: each note is tied to a spot they pointed at, with a close-up and marked copy, so open notes.md and the images.

Look at the drawing you were given. Find where it repeats something the designer corrected before, or goes against what they said they like or don't. Only what their notes support: carry a note across to a different element only where it plainly has the same role. Don't add taste of your own. At most 6, the most important first, or none. For each: the note's number and words, what in the screen, and the change to make.
`
/*
 * Arms G, H and I: the same check, cheaper (docs/taste-harness.md). G runs it on Haiku. H reads
 * words first: notes.md and the check open a close-up only where the screen has the same kind of
 * thing. I is H with the Haiku check and the screenshots and marked copies at half size.
 */
const MODES = {
  agent: {},
  haiku: { model: "haiku" },
  lean: { lean: true },
  "lean-all": { lean: true, model: "haiku", half: true },
}
const OPEN_ALL =
  "When you design for me, read all of this first and open the images: it is everything you know about my taste."
const WORDS_FIRST =
  "When you design for me, read all of this first: it is everything you know about my taste. Each note says where it is and what's there. Open a note's close-up when the screen you're making has the same kind of thing, and a screenshot only when a note isn't clear without it."
const checkAgent = ({ model, lean }) => {
  let text = CHECK_AGENT
  if (model) text = text.replace("tools: Read, Glob\n", `tools: Read, Glob\nmodel: ${model}\n`)
  if (lean)
    text = text.replace(
      "so open notes.md and the images.",
      "so read notes.md: every note's words, where it is and what's there. Open a note's close-up only when the drawing has the same kind of element and you need to see what the note meant.",
    )
  return text
}
function halve(dir) {
  const r = spawnSync(
    "python3",
    [
      "-I",
      "-c",
      "import sys\nfrom PIL import Image\nfor f in sys.argv[1:]:\n  im=Image.open(f); im.resize((im.width//2, im.height//2), Image.LANCZOS).save(f)",
      ...["screens/1.png", "marked/1.png"].map((f) => path.join(dir, f)),
    ],
    { encoding: "utf8" },
  )
  if (r.status) throw new Error(r.stderr)
}
async function buildInto(dest, d, task, memoryFrom, withCheck = false) {
  if (existsSync(path.join(dest, "index.html"))) return
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  if (memoryFrom) cpSync(memoryFrom, path.join(w, "pinch"), { recursive: true })
  const mode = MODES[withCheck]
  if (withCheck) {
    const take = path.join(w, "pinch", "pinch-notes-take-1")
    const f = path.join(take, "notes.md")
    const line = mode ? AGENT_LINE : CHECK_LINE
    let text = readFileSync(f, "utf8").replace(
      "everything you know about my taste.\n",
      `everything you know about my taste.\n\n${line}\n`,
    )
    if (mode?.lean) text = text.replace(OPEN_ALL, WORDS_FIRST)
    writeFileSync(f, text)
    if (mode) W(path.join(w, ".claude", "agents", "pinch-check.md"), checkAgent(mode))
    if (mode?.half) halve(take)
  }
  const r = await claude(w, buildPrompt(d, task, !!memoryFrom, !!mode?.lean), {
    bash: true,
    agent: withCheck,
    minutes: 25,
  })
  W(path.join(dest, "log.txt"), r.log)
  if (!existsSync(path.join(w, "index.html"))) return log("build failed", dest)
  mkdirSync(dest, { recursive: true })
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", path.relative(EXP, dest))
}

async function seed() {
  await pool(
    IDX.map((i) => async () => {
      const d = J(path.join(dd(i), "designer.json"))
      await buildInto(path.join(dd(i), "seed"), d, d.tasks[0], null)
    }),
  )
}

async function take() {
  await pool(
    IDX.map((i) => async () => {
      const s = path.join(dd(i), "seed"),
        tk = path.join(dd(i), "take.json")
      if (!existsSync(tk)) {
        const w = work()
        cpSync(path.join(dd(i), "designer.json"), path.join(w, "designer.json"))
        cpSync(path.join(s, "render.png"), path.join(w, "render.png"))
        const r = await claude(w, takePrompt, { minutes: 10 })
        if (!existsSync(path.join(w, "take.json")))
          return log("take failed", i + 1, r.log.slice(-400))
        cpSync(path.join(w, "take.json"), tk)
      }
      // the Pinch package for this take
      const pk = path.join(dd(i), "pinch", "pinch-notes-take-1")
      rmSync(path.join(dd(i), "pinch"), { recursive: true, force: true })
      const c = spawnSync(
        "python3",
        [
          "-I",
          path.join(HERE, "crop.py"),
          path.join(s, "render.png"),
          path.join(s, "render-text.json"),
          tk,
          pk,
        ],
        { encoding: "utf8" },
      )
      if (c.status) return log("crop failed", c.stderr)
      const where = J(path.join(pk, "where.json"))
      rmSync(path.join(pk, "where.json"))
      const notes = J(tk).notes
      const md = [
        "# My notes on these screenshots",
        "",
        "When you design for me, read all of this first and open the images: it is everything you know about my taste.",
        "",
        "Each note has a number. Each marked copy has those numbers on the spots I pointed at while saying the notes. Each close-up shows one spot, bright, with the rest dimmed. Under each note is where it is, the text there and the spot's main colours. A mark's colour means nothing.",
        "",
        "## first-screen.png",
        "",
        "My own work.",
        "Screenshot: `screens/1.png`",
        "Marked copy: `marked/1.png`",
        "",
        ...notes.flatMap((n, k) => [
          `- ${k + 1}. (\`close-ups/1-${k + 1}.png\`) ${n.words}`,
          `  ${where[k].where}`,
        ]),
      ]
      W(path.join(pk, "notes.md"), `${md.join("\n")}\n`)
      log("take", i + 1, notes.length, "notes")
    }),
  )
}

const cells = () =>
  IDX.flatMap((i) =>
    [1, 2].flatMap((t) =>
      Array.from({ length: RUNS }, (_, r) => ({
        i,
        t,
        r: r + 1,
        dir: path.join(dd(i), `t${t}`, `r${r + 1}`),
      })),
    ),
  )

async function build() {
  const jobs = []
  for (const c of cells()) {
    const d = J(path.join(dd(c.i), "designer.json"))
    jobs.push(() => buildInto(path.join(c.dir, "A"), d, d.tasks[c.t], null))
    jobs.push(() =>
      buildInto(
        path.join(c.dir, "B"),
        d,
        d.tasks[c.t],
        path.join(dd(c.i), "pinch"),
      ),
    )
  }
  await pool(jobs)
}

async function buildE(mode = true, arm = "E") {
  const jobs = []
  for (const c of cells()) {
    const d = J(path.join(dd(c.i), "designer.json"))
    jobs.push(() =>
      buildInto(
        path.join(c.dir, arm),
        d,
        d.tasks[c.t],
        path.join(dd(c.i), "pinch"),
        mode,
      ),
    )
  }
  await pool(jobs)
}

async function checkAndFix() {
  const jobs = []
  for (const c of cells())
    for (const [arm, taste] of process.env.SKIP_D
      ? [["C", true]]
      : [
          ["C", true],
          ["D", false],
        ])
      jobs.push(async () => {
        const d = J(path.join(dd(c.i), "designer.json")),
          B = path.join(c.dir, "B"),
          out = path.join(c.dir, arm)
        if (
          !existsSync(path.join(B, "render.png")) ||
          existsSync(path.join(out, "index.html"))
        )
          return
        if (!existsSync(path.join(out, "check.json"))) {
          const w = work()
          for (const f of ["index.html", "render.png"])
            cpSync(path.join(B, f), path.join(w, f))
          W(path.join(w, "task.md"), d.tasks[c.t])
          if (taste)
            cpSync(path.join(dd(c.i), "pinch"), path.join(w, "pinch"), {
              recursive: true,
            })
          const r = await claude(w, checkPrompt(taste), { minutes: 10 })
          if (!existsSync(path.join(w, "check.json")))
            return log("check failed", out, r.log.slice(-300))
          W(path.join(out, "check.json"), J(path.join(w, "check.json")))
        }
        const w = work()
        for (const f of ["index.html"]) cpSync(path.join(B, f), path.join(w, f))
        cpSync(path.join(out, "check.json"), path.join(w, "check.json"))
        cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
        W(path.join(w, "task.md"), d.tasks[c.t])
        cpSync(path.join(dd(c.i), "pinch"), path.join(w, "pinch"), {
          recursive: true,
        })
        const r = await claude(w, fixPrompt(d), { bash: true })
        W(path.join(out, "log.txt"), r.log)
        cpSync(path.join(w, "index.html"), path.join(out, "index.html"))
        render(out)
        log("fixed", path.relative(EXP, out))
      })
  await pool(jobs)
}

const ARMS = ["A", "B", "C", "D", "E"]
async function judge(only = null, prefix = "verdict") {
  const jobs = []
  for (const c of cells())
    for (const pass of [1, 2])
      jobs.push(async () => {
        const f = path.join(c.dir, `${prefix}-${pass}.json`)
        if (existsSync(f)) return
        const d = J(path.join(dd(c.i), "designer.json"))
        const arms = (only || ARMS).filter((a) =>
          existsSync(path.join(c.dir, a, "render.png")),
        )
        const order = [...arms].sort(() => Math.random() - 0.5)
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
          cpSync(path.join(c.dir, a, "render.png"), path.join(w, `s${k + 1}.png`))
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

function report() {
  const rows = [],
    agg = Object.fromEntries(
      ARMS.map((a) => [
        a,
        { changes: 0, breaks: 0, repeats: 0, rank: 0, n: 0 },
      ]),
    )
  const pairs = {
    "B vs A": [0, 0, 0],
    "C vs B": [0, 0, 0],
    "D vs B": [0, 0, 0],
    "C vs D": [0, 0, 0],
  }
  for (const c of cells()) {
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
        agg[a][k] += m[a][k]
      agg[a].n++
    }
    rows.push(
      `| d${c.i + 1} t${c.t} r${c.r} | ${ARMS.map((a) => (m[a] ? `${m[a].changes.toFixed(1)} / ${m[a].breaks.toFixed(1)} / ${m[a].repeats.toFixed(1)} / ${m[a].rank.toFixed(1)}` : "–")).join(" | ")} |`,
    )
    for (const [k, [x, y]] of Object.entries({
      "B vs A": ["B", "A"],
      "C vs B": ["C", "B"],
      "D vs B": ["D", "B"],
      "C vs D": ["C", "D"],
    })) {
      if (!m[x] || !m[y]) continue
      const s = m[x].rank < m[y].rank ? 0 : m[x].rank > m[y].rank ? 2 : 1
      pairs[k][s]++
    }
  }
  const out = [
    "| cell | A none | B takes | C takes+taste check | D takes+generic review |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "Each cell: changes / taste points broken / earlier corrections repeated / mean rank (1 best), averaged over two judge passes.",
    "",
    "| arm | changes | breaks | repeats | rank | cells |",
    "|---|---|---|---|---|---|",
    ...ARMS.map((a) => {
      const g = agg[a]
      return `| ${a} | ${(g.changes / g.n).toFixed(2)} | ${(g.breaks / g.n).toFixed(2)} | ${(g.repeats / g.n).toFixed(2)} | ${(g.rank / g.n).toFixed(2)} | ${g.n} |`
    }),
    "",
    "| pair (by mean rank) | first wins | tie | second wins |",
    "|---|---|---|---|",
    ...Object.entries(pairs).map(
      ([k, [a, b, c]]) => `| ${k} | ${a} | ${b} | ${c} |`,
    ),
  ]
  W(path.join(EXP, "report.md"), `${out.join("\n")}\n`)
  console.log(out.join("\n"))
}

const stage = process.argv[2]
const all = {
  e: () => buildE(),
  judgeE: () => judge(["B", "C", "E"], "verdict-e"),
  f: () => buildE("agent", "F"),
  judgeF: () => judge(["B", "C", "F"], "verdict-f"),
  g: () => buildE("haiku", "G"),
  h: () => buildE("lean", "H"),
  i: () => buildE("lean-all", "I"),
  ghi: () => Promise.all([buildE("haiku", "G"), buildE("lean", "H"), buildE("lean-all", "I")]),
  judgeCost: () => judge(["B", "F", "G", "H", "I"], "verdict-cost"),
  designers,
  seed,
  take,
  build,
  check: checkAndFix,
  judge,
  report,
}
if (stage === "all") {
  for (const s of ["designers", "seed", "take", "build", "check", "judge"]) {
    log("==", s)
    await all[s]()
  }
  report()
} else if (all[stage]) await all[stage]()
else console.error("stage?")
