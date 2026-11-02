// The hand-vs-Pinch test judged without its author (D145, docs/hand-vs-pinch.md): each build drawn
// by headless Chrome at 1440px, then each pair judged twice, sides swapped, by a fresh Claude Code
// session holding only the made-up designer's hidden taste, the task and the two renders. A pick
// counts only when both orders agree; otherwise the pair is a tie. Changes are the mean of the two
// orders. Writes results.json as the judging page would, and judge-detail.json with the taste
// points each build follows and breaks.
//
//   node --import tsx scripts/hand-vs-pinch/simulate/judge.ts <test dir> <designer.json>
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

const [dir, designerFile] = process.argv.slice(2)
const at = (...p: string[]) => path.join(dir, ...p)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const d = JSON.parse(readFileSync(designerFile, "utf8"))
const { builds, tasks } = JSON.parse(readFileSync(at("key.json"), "utf8"))
const { pairs } = JSON.parse(readFileSync(at("blind.json"), "utf8"))

mkdirSync(at("renders"), { recursive: true })
for (const b of builds) {
  const png = at("renders", `${b.id}.png`)
  if (existsSync(png)) continue
  spawnSync(
    CHROME,
    [
      "--headless=new",
      "--hide-scrollbars",
      "--window-size=1440,2400",
      "--virtual-time-budget=8000",
      `--screenshot=${png}`,
      `file://${at("builds", `${b.id}.html`)}`,
    ],
    { stdio: "ignore" },
  )
}

const designer = `# The designer\n\n${d.designer}\n\n## Their taste\n\n${d.taste.map((t: string, i: number) => `${i}. ${t}`).join("\n")}\n`
const PROMPT = `You are judging two screens for one designer. ./designer.md says who they are and their taste, point by point: they never wrote it down, but it is exactly what they want. Both screens were built for the task in ./task.md. They are ./left.png and ./right.png, rendered 1440px wide (ignore any blank space below the end of a page), with their code in ./left.html and ./right.html.

Look at both renders closely. For each screen, list the taste points, by number, it follows and those it breaks, wherever the screen gives a chance to show them. Then count the changes this designer would ask for before the screen is theirs: one for each distinct edit. Then say which screen is closer to their taste: "left", "right", or "same" only when you truly can't separate them.

Write ./verdict.json and nothing else:
{"left": {"follows": [0, 2], "breaks": [5], "changes": 4}, "right": {"follows": [], "breaks": [], "changes": 0}, "pick": "left", "why": "One sentence."}

Judge only what you see, not how either screen might have been made. Don't ask questions: no one is there to answer them.`

type Verdict = {
  left: { follows: number[]; breaks: number[]; changes: number }
  right: { follows: number[]; breaks: number[]; changes: number }
  pick: "left" | "right" | "same"
  why: string
}

async function judgeOnce(
  task: string,
  left: string,
  right: string,
): Promise<Verdict | null> {
  const work = mkdtempSync(path.join(tmpdir(), "hvp-judge-"))
  try {
    writeFileSync(path.join(work, "designer.md"), designer)
    writeFileSync(path.join(work, "task.md"), `${task}\n`)
    cpSync(at("renders", `${left}.png`), path.join(work, "left.png"))
    cpSync(at("renders", `${right}.png`), path.join(work, "right.png"))
    cpSync(at("builds", `${left}.html`), path.join(work, "left.html"))
    cpSync(at("builds", `${right}.html`), path.join(work, "right.html"))
    await new Promise<void>((resolve) => {
      const child = spawn(
        "claude",
        [
          "-p",
          PROMPT,
          "--tools",
          "Read,Write",
          "--allowedTools",
          "Read",
          "Write",
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
    const file = path.join(work, "verdict.json")
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Verdict)
      : null
  } catch {
    return null
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

async function main() {
  const detail: Record<string, unknown> = existsSync(at("judge-detail.json"))
    ? JSON.parse(readFileSync(at("judge-detail.json"), "utf8"))
    : {}
  const jobs = pairs
    .flatMap((p: { id: string; task: number; left: string; right: string }) => [
      { key: `${p.id}:as-shown`, p, left: p.left, right: p.right },
      { key: `${p.id}:swapped`, p, left: p.right, right: p.left },
    ])
    .filter((j: { key: string }) => !detail[j.key])
  console.log(`${jobs.length} judgments to run`)
  const queue = [...jobs]
  let done = 0
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        const v = await judgeOnce(tasks[j.p.task], j.left, j.right)
        if (v) detail[j.key] = { leftId: j.left, rightId: j.right, verdict: v }
        writeFileSync(at("judge-detail.json"), JSON.stringify(detail, null, 2))
        console.log(`${++done} of ${jobs.length}${v ? "" : " (failed)"}`)
      }
    }),
  )
  // Each pair's answer, as the judging page saves it, from the pair's own left and right.
  const results: Record<string, unknown> = {}
  for (const p of pairs) {
    const a = (detail[`${p.id}:as-shown`] as { verdict: Verdict } | undefined)
      ?.verdict
    const b = (detail[`${p.id}:swapped`] as { verdict: Verdict } | undefined)
      ?.verdict
    if (!a || !b) continue
    const winner = (v: Verdict, l: string, r: string) =>
      v.pick === "same" ? null : v.pick === "left" ? l : r
    const wa = winner(a, p.left, p.right)
    const wb = winner(b, p.right, p.left)
    const pick = wa && wa === wb ? (wa === p.left ? "left" : "right") : "same"
    results[p.id] = {
      pick,
      changes: {
        left: (a.left.changes + b.right.changes) / 2,
        right: (a.right.changes + b.left.changes) / 2,
      },
      note: `as shown: ${a.pick}; swapped: ${b.pick}`,
    }
  }
  writeFileSync(at("results.json"), JSON.stringify(results, null, 2))
  console.log(`${Object.keys(results).length} of ${pairs.length} pairs judged`)
}
main()
