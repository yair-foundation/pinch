// The hand-vs-Pinch test run with a made-up designer (D145, docs/hand-vs-pinch.md): the designer
// correcting work done for them. A fresh Claude Code session holding the hidden taste looks at one
// build's render, not told how it was made, and says what it would say talking over it: at most
// five notes, each on an element it can point at. They come out in designer.json's shape for notes,
// so `take.ts` can say them to Pinch, and they can be kept in a notes file word for word.
//
//   node --import tsx scripts/hand-vs-pinch/simulate/correct.ts <designer.json> <render.png> <task> <screen name> <out.json>
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Correction = {
  verdict: "works" | "doesnt"
  text: string
  box: { x: number; y: number; w: number; h: number }
  what: string
}

const MOST = 5
const [designerFile, render, task, screen, out] = process.argv.slice(2)
if (!out) {
  console.error(
    "Usage: correct.ts <designer.json> <render.png> <task> <screen name> <out.json>",
  )
  process.exit(1)
}
const d = JSON.parse(readFileSync(designerFile, "utf8")) as {
  designer: string
  product: string
  taste: string[]
}

const PROMPT = `You are helping run a test, by playing a product designer. ./designer.md says who they are, what they are designing and their taste, point by point: they never wrote it down, but it is exactly what they want. Someone built a screen of their product for them, for the task in ./task.md. It is ./render.png, rendered 1440px wide (ignore any blank space below the end of the page).

Look at it closely, then correct it, as this designer would talking over the render to whoever built it: at most ${MOST} notes, the ones that matter most to them.

- Each note reacts to one specific element they can point at, names it so it is clear which one, and says what is wrong and what they want instead, in their own voice, in one or two sentences. If something is exactly right and they would want it kept, one note may say so.
- Notes are reactions, not rules: never state a taste point word for word.
- Speak only of what is on this render.
- Give the box around the element as fractions of the image's width and height: x and y of the top-left corner, then w and h. Keep it tight, and look carefully: it must sit on that element.

Write ./corrections.json and nothing else:
{"notes": [{"verdict": "doesnt" or "works", "text": "…", "box": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}, "what": "a few words naming what is in the box"}]}
Don't ask questions: no one is there to answer them.`

const work = mkdtempSync(path.join(tmpdir(), "hvp-correct-"))
try {
  writeFileSync(
    path.join(work, "designer.md"),
    `# The designer\n\n${d.designer}\n\n## What they are designing\n\n${d.product}\n\n## Their taste\n\n${d.taste.map((t, i) => `${i}. ${t}`).join("\n")}\n`,
  )
  writeFileSync(path.join(work, "task.md"), `${task}\n`)
  cpSync(render, path.join(work, "render.png"))
  spawnSync(
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
    { cwd: work, stdio: "ignore", timeout: 15 * 60_000 },
  )
  const file = path.join(work, "corrections.json")
  if (!existsSync(file)) {
    console.error(`No corrections for ${screen}.`)
    process.exit(1)
  }
  const { notes } = JSON.parse(readFileSync(file, "utf8")) as {
    notes: Correction[]
  }
  const kept = notes.slice(0, MOST).map((n) => ({ ...n, screen }))
  writeFileSync(out, `${JSON.stringify({ notes: kept }, null, 2)}\n`)
  console.log(`${kept.length} corrections on ${screen}.`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
