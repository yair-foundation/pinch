// Can a check in code, written from a person's notes, help an agent keep what can be measured, and
// can it be scored without a model's eye? (docs/taste-harness.md.) On rounds 4 to 6 of rounds.mjs:
//
//   oracle  per designer, a script written from their hidden taste alone that measures a page in
//           Chromium and says, point by point, met, broken or not measurable by code
//   checks  per designer and round, a script written from the takes so far: it measures what the
//           notes make measurable, says which note each finding comes from, and adds no taste
//   build   each round's task again with the takes (M2), and with the takes and the check (K, K2)
//   measure the oracle on every page: nothing (A), the takes (M, M2), the takes and the check (K, K2)
//   spots   the takes again, each note with a line of what was measured at its spot on the page: the
//           text's size, weight, family, colour and case, and its box's padding, corners, border,
//           shadow and background (built as N, N2)
//
//   OUT=<dir> node scripts/taste-harness/measure.mjs oracle|checks|build|spots|buildSpots|measure
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
import { createRequire } from "node:module"
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
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const W = (f, o) => {
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 2))
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const work = () => mkdtempSync(path.join(tmpdir(), "pinch-measure-"))
const at = (dn, ...p) => path.join(EXP, dn, "rounds", ...p)
const mine = (dn, ...p) => path.join(EXP, dn, "measure", ...p)

function claude(cwd, prompt, { agent = false, bash = false, minutes = 25 } = {}) {
  const tools = ["Read", "Write", "Glob", "Grep"]
  if (bash) tools.push("Edit", "Bash")
  if (agent) tools.push("Agent")
  const allowed = tools.filter((t) => t !== "Bash")
  if (bash)
    allowed.push(
      "Bash(node render.mjs)",
      "Bash(node render.mjs:*)",
      "Bash(node check.mjs)",
      "Bash(node check.mjs:*)",
      "Bash(node oracle.mjs:*)",
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

const ORACLE = `Read ./designer.json: its "taste" lists 12 statements, the hidden taste of one designer. Write ./oracle.mjs, a Node ES module run as \`node oracle.mjs <page.html>\`. It loads that page in headless Chromium at 1440px wide with Playwright (copy the launch and page-loading pattern from ./render.mjs, including how it finds playwright), measures the page from computed styles and geometry, and prints ONE line of JSON: {"points": {"0": true, "1": false, "2": null, …}} with a key for each of the 12 statements by its index: true = the page meets it, false = the page breaks it, null = code can't tell (it needs an eye) or the page has no element the statement is about.

Use each statement's own numbers and words, so a statement is held as strictly as it states itself and no stricter. Look at what is rendered, with computed styles of the elements that show text, boxes and images: font sizes, families and weights, colours, border width, radius and shadows, spacing between sections and padding, text alignment and case, how many distinct accent colours a page uses, whether elements are centred, row heights. Don't use a page's class names. A statement with several parts is met only if all its measurable parts are met.

Test it on ./sample.html and fix it until it runs and prints sensible values. Write only ./oracle.mjs.`

const CHECK = (r) => `./pinch/ holds everything this designer has said about earlier screens: ${r - 1} take${r > 2 ? "s" : ""}, each a folder pinch-notes-take-N with notes.md and images. Read every notes.md and open the images.

Write ./check.mjs, a Node ES module run as \`node check.mjs\`. It loads ./index.html in headless Chromium at 1440px wide with Playwright (copy the launch and page-loading pattern from ./render.mjs, including how it finds playwright) and checks the page for what these notes make measurable: font sizes, colours, spacing, corner radius, borders, shadows, alignment, text case, how many accent colours, row heights and the like. Only what the notes support: when a note gives no number, take the threshold its words imply, and print it. Never add taste of your own, and carry a note to another element only where it plainly has the same role. At most 8 checks.

It prints one line for each finding: what is wrong, where (a short selector or the text of the element), what the page has against what the note wants, and the note (its take and number). With nothing to report it prints "No findings." It always exits 0.

Test it on ./sample.html (copy it to ./index.html first) and fix it until it runs. Write only ./check.mjs.`

const PROJECT = (d) => `You're the coding agent on ${d.product}`
const buildPrompt = (d, task, check) => `${PROJECT(d)}.

The designer's feedback on earlier screens is in ./pinch/: read all of it first and open the images. It is everything you know about their taste.

Build this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:

${task}

- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if you want a typeface; load nothing else from outside.
- No external images: draw with inline SVG or CSS, and write realistic text.
- Where you have no guidance, use your own judgment.
${check ? "- `node check.mjs` measures the page against what the designer's notes make measurable. Run it after you draw the page, fix what it reports, and run it again.\n" : ""}
You can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.

Write ./index.html and nothing else. Don't ask questions: no one is there to answer them.`

const roundTasks = (dn) => [
  ...J(path.join(EXP, dn, "designer.json")).tasks,
  ...J(path.join(EXP, dn, "more-tasks.json")).tasks,
]
const samplePage = (dn) => path.join(EXP, dn, "seed", "index.html")

async function oracleStage() {
  await pool(
    DESIGNERS.map((dn) => async () => {
      if (existsSync(mine(dn, "oracle.mjs"))) return
      const w = work()
      cpSync(path.join(EXP, dn, "designer.json"), path.join(w, "designer.json"))
      cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
      cpSync(samplePage(dn), path.join(w, "sample.html"))
      const run = await claude(w, ORACLE, { bash: true, minutes: 15 })
      if (!existsSync(path.join(w, "oracle.mjs")))
        return log("oracle failed", dn, run.log.slice(-300))
      cpSync(path.join(w, "oracle.mjs"), mine(dn, "oracle.mjs"))
      log("oracle", dn)
    }),
  )
}

async function checksStage() {
  const jobs = DESIGNERS.flatMap((dn) =>
    ROUNDS.map((r) => async () => {
      const dest = mine(dn, `check-r${r}.mjs`)
      if (existsSync(dest)) return
      const w = work()
      for (let k = 1; k < r; k++)
        cpSync(
          at(dn, "pinch", `pinch-notes-take-${k}`),
          path.join(w, "pinch", `pinch-notes-take-${k}`),
          { recursive: true },
        )
      cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
      cpSync(samplePage(dn), path.join(w, "sample.html"))
      const run = await claude(w, CHECK(r), { bash: true, minutes: 15 })
      if (!existsSync(path.join(w, "check.mjs")))
        return log("check failed", dn, r, run.log.slice(-300))
      cpSync(path.join(w, "check.mjs"), dest)
      log("check", dn, `r${r}`)
    }),
  )
  await pool(jobs)
}

/** What a page has at each of a take's spots, as one line per note, measured in Chromium. */
async function spotsOf(page, boxes) {
  const { chromium } = createRequire(import.meta.url)(
    process.env.PW_PATH || "playwright",
  )
  const browser = await chromium.launch()
  try {
    const tab = await browser.newPage({ viewport: { width: 1440, height: 2400 } })
    await tab
      .goto(`file://${page}`, { waitUntil: "networkidle", timeout: 30000 })
      .catch(() => {})
    await tab.waitForTimeout(1500)
    return await tab.evaluate((boxes) => {
      const hex = (c) => {
        const m = c.match(/\d+(\.\d+)?/g)
        if (!m || (m.length > 3 && Number(m.at(3)) === 0)) return null
        return `#${m
          .slice(0, 3)
          .map((x) => Number(x).toString(16).padStart(2, "0"))
          .join("")}`
      }
      return boxes.map((b) => {
        const spot = { x: b.x * 1440, y: b.y * 2400, w: b.w * 1440, h: b.h * 2400 }
        const inside = (r) => {
          const ix = Math.max(0, Math.min(r.right, spot.x + spot.w) - Math.max(r.left, spot.x))
          const iy = Math.max(0, Math.min(r.bottom, spot.y + spot.h) - Math.max(r.top, spot.y))
          return r.width * r.height > 0 ? (ix * iy) / (r.width * r.height) : 0
        }
        const texts = []
        for (const el of document.body.querySelectorAll("*")) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          if (!own) continue
          const r = el.getBoundingClientRect()
          if (inside(r) < 0.6) continue
          const cs = getComputedStyle(el)
          texts.push({
            size: Number.parseFloat(cs.fontSize),
            weight: cs.fontWeight,
            family: cs.fontFamily.split(",").at(0).replace(/["']/g, "").trim(),
            colour: hex(cs.color),
            upper: cs.textTransform === "uppercase",
          })
        }
        const cx = spot.x + spot.w / 2
        const cy = spot.y + spot.h / 2
        const box = document
          .elementsFromPoint(cx, Math.min(cy, 2399))
          .find((el) => {
            const r = el.getBoundingClientRect()
            return r.width * r.height >= 0.4 * spot.w * spot.h && el !== document.body && el !== document.documentElement
          })
        const parts = []
        if (texts.length) {
          const sizes = texts.map((t) => t.size)
          const big = texts.reduce((a, t) => (t.size > a.size ? t : a))
          const lo = Math.min(...sizes)
          const hi = Math.max(...sizes)
          const colours = [...new Set(texts.map((t) => t.colour).filter(Boolean))].slice(0, 2)
          parts.push(
            `text ${lo === hi ? `${hi}px` : `${lo} to ${hi}px`}, weight ${big.weight}, ${big.family}${big.upper ? ", uppercase" : ""}${colours.length ? `, colour ${colours.join(" and ")}` : ""}`,
          )
        }
        if (box) {
          const cs = getComputedStyle(box)
          const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
          const bits = [
            `padding ${new Set(pad).size === 1 ? pad.at(0) : pad.join(" ")}`,
            `corners ${cs.borderTopLeftRadius}`,
          ]
          if (Number.parseFloat(cs.borderTopWidth) > 0) bits.push(`border ${cs.borderTopWidth} ${hex(cs.borderTopColor) ?? ""}`.trim())
          bits.push(cs.boxShadow === "none" ? "no shadow" : `shadow ${cs.boxShadow}`)
          const bg = hex(cs.backgroundColor)
          if (bg) bits.push(`background ${bg}`)
          parts.push(`box ${bits.join(", ")}`)
        }
        return parts.length ? `Measured: ${parts.join("; ")}.` : null
      })
    }, boxes)
  } finally {
    await browser.close()
  }
}

/** Each take's folder again, with a Measured line under each note's Where line. */
async function spotsStage() {
  for (const dn of DESIGNERS)
    for (let k = 1; k <= 5; k++) {
      const pk = at(dn, "pinch", `pinch-notes-take-${k}`)
      if (!existsSync(pk)) continue
      const take = k === 1 ? path.join(EXP, dn, "take.json") : at(dn, `r${k}`, "take.json")
      const page = k === 1 ? samplePage(dn) : at(dn, `r${k}`, "M", "index.html")
      const lines = await spotsOf(
        page,
        J(take).notes.map((n) => n.box),
      )
      const dest = mine(dn, "pinch-measured", `pinch-notes-take-${k}`)
      cpSync(pk, dest, { recursive: true })
      let i = 0
      const text = readFileSync(path.join(dest, "notes.md"), "utf8")
        .split("\n")
        .flatMap((line) => {
          if (!line.startsWith("  Where:")) return [line]
          const measured = lines.at(i++)
          return measured ? [line, `  ${measured}`] : [line]
        })
        .join("\n")
      W(path.join(dest, "notes.md"), text)
      log("spots", dn, `take ${k}`, lines.filter(Boolean).length, "of", lines.length)
    }
}

async function buildFor(dn, r, arm) {
  const dest = at(dn, `r${r}`, arm)
  if (existsSync(path.join(dest, "index.html"))) return
  const withCheck = arm.startsWith("K")
  if (withCheck && !existsSync(mine(dn, `check-r${r}.mjs`)))
    return log("no check for", dn, r)
  const d = J(path.join(EXP, dn, "designer.json"))
  const w = work()
  cpSync(path.join(HERE, "render.mjs"), path.join(w, "render.mjs"))
  const takes = arm.startsWith("N") ? mine(dn, "pinch-measured") : at(dn, "pinch")
  for (let k = 1; k < r; k++)
    cpSync(
      path.join(takes, `pinch-notes-take-${k}`),
      path.join(w, "pinch", `pinch-notes-take-${k}`),
      { recursive: true },
    )
  if (withCheck) cpSync(mine(dn, `check-r${r}.mjs`), path.join(w, "check.mjs"))
  const run = await claude(w, buildPrompt(d, roundTasks(dn)[r - 1], withCheck), {
    bash: true,
    agent: true,
  })
  W(path.join(dest, "log.txt"), run.log)
  if (!existsSync(path.join(w, "index.html")))
    return log("build failed", dn, r, arm)
  cpSync(path.join(w, "index.html"), path.join(dest, "index.html"))
  render(dest)
  log("built", dn, `r${r}`, arm)
}

async function buildStage() {
  await pool(
    DESIGNERS.flatMap((dn) =>
      ROUNDS.flatMap((r) =>
        ["K", "K2", "M2"].map((arm) => () => buildFor(dn, r, arm)),
      ),
    ),
  )
}

/** The oracle's answer for one page, or null when it didn't run. */
function ask(dn, page) {
  const run = spawnSync("node", [mine(dn, "oracle.mjs"), page], {
    encoding: "utf8",
    timeout: 120000,
  })
  const line = (run.stdout ?? "").trim().split("\n").at(-1)
  try {
    return JSON.parse(line).points
  } catch {
    return null
  }
}

const ARMS = ["A", "M", "M2", "K", "K2", "N", "N2"]
function measureStage() {
  const out = {}
  for (const dn of DESIGNERS)
    for (const r of ROUNDS)
      for (const arm of ARMS) {
        const page = at(dn, `r${r}`, arm, "index.html")
        if (!existsSync(page)) continue
        const points = ask(dn, page)
        if (!points) {
          log("oracle failed on", dn, r, arm)
          continue
        }
        out[`${dn}/r${r}/${arm}`] = points
      }
  W(path.join(EXP, "measure-scores.json"), out)
  report(out)
}

function report(scores) {
  const share = (p) => {
    const v = Object.values(p)
    const known = v.filter((x) => x !== null)
    return known.length ? known.filter((x) => x === false).length / known.length : NaN
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const rows = ["| Way | Measurable points broken, mean | Pages |", "| --- | ---: | ---: |"]
  const by = (arms, pred = () => true) =>
    Object.entries(scores)
      .filter(([k]) => arms.includes(k.split("/")[2]) && pred(k))
      .map(([, p]) => share(p))
      .filter((x) => !Number.isNaN(x))
  const label = {
    A: ["A"],
    "M, M2": ["M", "M2"],
    "K, K2": ["K", "K2"],
    "N, N2": ["N", "N2"],
  }
  for (const [name, arms] of Object.entries(label)) {
    const xs = by(arms)
    rows.push(`| ${name} | ${(100 * mean(xs)).toFixed(0)}% | ${xs.length} |`)
  }
  rows.push("", "By designer:")
  for (const dn of DESIGNERS)
    rows.push(
      `${dn}: ${Object.entries(label)
        .map(([name, arms]) => {
          const xs = by(arms, (k) => k.startsWith(`${dn}/`))
          return `${name} ${(100 * mean(xs)).toFixed(0)}%`
        })
        .join(" · ")}`,
    )
  const measurable = Object.values(scores).map(
    (p) => Object.values(p).filter((x) => x !== null).length,
  )
  rows.push("", `Points the oracle could measure on a page: ${mean(measurable).toFixed(1)} of 12.`)
  // K against M, paired by cell.
  let better = 0
  let worse = 0
  let same = 0
  for (const dn of DESIGNERS)
    for (const r of ROUNDS) {
      const m = by(["M", "M2"], (k) => k.startsWith(`${dn}/r${r}/`))
      const k = by(["K", "K2"], (k) => k.startsWith(`${dn}/r${r}/`))
      if (!m.length || !k.length) continue
      const d = mean(k) - mean(m)
      if (d < -0.005) better++
      else if (d > 0.005) worse++
      else same++
    }
  rows.push(`Cells where the check had fewer measurable points broken: ${better}, more: ${worse}, same: ${same}.`)
  let nb = 0
  let nw = 0
  let ns = 0
  for (const dn of DESIGNERS)
    for (const r of ROUNDS) {
      const m = by(["M", "M2"], (k) => k.startsWith(`${dn}/r${r}/`))
      const n = by(["N", "N2"], (k) => k.startsWith(`${dn}/r${r}/`))
      if (!m.length || !n.length) continue
      const d = mean(n) - mean(m)
      if (d < -0.005) nb++
      else if (d > 0.005) nw++
      else ns++
    }
  rows.push(`Cells where measured notes had fewer measurable points broken: ${nb}, more: ${nw}, same: ${ns}.`)
  console.log(rows.join("\n"))
}

const stage = process.argv[2]
const stages = {
  oracle: oracleStage,
  checks: checksStage,
  build: buildStage,
  spots: spotsStage,
  buildSpots: () =>
    pool(
      DESIGNERS.flatMap((dn) =>
        ROUNDS.flatMap((r) => ["N", "N2"].map((arm) => () => buildFor(dn, r, arm))),
      ),
    ),
  measure: measureStage,
}
if (stages[stage]) await stages[stage]()
else console.error("Usage: measure.mjs oracle|checks|build|measure")
