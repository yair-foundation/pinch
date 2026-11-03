// The hand-vs-Pinch test run with a made-up designer (D145, docs/hand-vs-pinch.md): its notes
// checked against its hidden taste before anything is built. A made-up designer can praise in a
// note what its hidden taste rules out, and then the judge marks a build down for following the
// designer's own words, whichever input it came from. A fresh Claude Code session reads the
// designer and lists each note whose words go against a taste point, with the note rewritten
// without that part. The rewritten notes replace the old ones in a copy of designer.json.
//
//   node --import tsx scripts/hand-vs-pinch/simulate/check-notes.ts <designer.json> <checked.json>
//
// The check reads the words only: a close-up can still show what the taste rules out, where the
// note doesn't judge it.
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Note = { screen: string; verdict: "works" | "doesnt"; text: string }
type Conflict = {
  note: number
  taste: number
  why: string
  text: string
  verdict: "works" | "doesnt"
}

const [designerFile, out] = process.argv.slice(2)
if (!designerFile || !out) {
  console.error("Usage: check-notes.ts <designer.json> <checked.json>")
  process.exit(1)
}
const d = JSON.parse(readFileSync(designerFile, "utf8")) as {
  taste: string[]
  notes: Note[]
}

const PROMPT = `./designer.md is a made-up product designer for a test: their hidden taste, point by point, which a judge will hold their work to, and the notes they wrote on screenshots, numbered. The notes must not go against the taste, or the judge marks down a screen for following the designer's own words.

Find every note whose words go against a taste point: praise for something the point rules out, a fault found in something it asks for, or a wish for something against it. A note that only says less than a point, or speaks of something the point doesn't cover, is fine.

For each, rewrite the note without the part that goes against the taste: keep every other word as it is, and add nothing. Say whether what is left praises ("works") or faults ("doesnt").

Write ./conflicts.json and nothing else:
{"conflicts": [{"note": 12, "taste": 3, "why": "One sentence.", "text": "The note, rewritten.", "verdict": "works"}]}
An empty list when no note goes against the taste. Don't ask questions: no one is there to answer them.`

const work = mkdtempSync(path.join(tmpdir(), "hvp-check-"))
try {
  writeFileSync(
    path.join(work, "designer.md"),
    `# Hidden taste\n\n${d.taste.map((t, i) => `${i}. ${t}`).join("\n")}\n\n# Notes\n\n${d.notes
      .map((n, i) => `${i}. (${n.screen}, ${n.verdict}) ${n.text}`)
      .join("\n")}\n`,
  )
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
  const file = path.join(work, "conflicts.json")
  if (!existsSync(file)) {
    console.error("The check wrote no conflicts.json.")
    process.exit(1)
  }
  const { conflicts } = JSON.parse(readFileSync(file, "utf8")) as {
    conflicts: Conflict[]
  }
  const notes = d.notes.map((n) => ({ ...n }))
  for (const c of conflicts) {
    const n = notes[c.note]
    if (!n || !c.text.trim()) continue
    console.log(
      `Note ${c.note} against taste ${c.taste}: ${c.why}\n  was: ${n.text}\n  now: ${c.text.trim()}`,
    )
    n.text = c.text.trim()
    n.verdict = c.verdict === "works" ? "works" : "doesnt"
  }
  writeFileSync(
    out,
    `${JSON.stringify({ ...d, notes, checked: conflicts }, null, 2)}\n`,
  )
  console.log(`${conflicts.length} of ${notes.length} notes rewritten.`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
