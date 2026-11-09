// Scores the stroke reading (D185) against a gesture take: one where the author said each
// gesture's name as they made it ("circle", "scrub", "travel", "point", "nothing", "underline"),
// so the words are the labels. For each label word it prints what the pointer reading made of the
// second and a half after it, then tallies labels against readings. Run it on the same takes
// before and after a change to `voice-notes.ts`.
//
//   node --import tsx scripts/take-strokes.ts <pinch-take-….json> [more…]
import { readFileSync } from "node:fs"
import type { Take } from "../src/lib/pin/narration"
import { pointerOn } from "../src/lib/pin/voice-notes"

const LABELS = ["circle", "scrub", "underline", "travel", "point", "nothing"]
/** The pointer is read from a little before the word to this long after it: name, then gesture. */
const BEFORE = 300
const AFTER = 1200

const files = process.argv.slice(2)
if (!files.length) {
  console.error(
    "Usage: node --import tsx scripts/take-strokes.ts <pinch-take-….json> [more…]",
  )
  process.exit(1)
}

const tally = new Map<string, Map<string, number>>()
const count = (label: string, read: string) => {
  const row = tally.get(label) ?? new Map<string, number>()
  row.set(read, (row.get(read) ?? 0) + 1)
  tally.set(label, row)
}

for (const file of files) {
  const take = JSON.parse(readFileSync(file, "utf8")) as Take
  const shown = take.shown.filter((e) => !("click" in e))
  const screenAt = (t: number) => {
    let s: number | null = null
    for (const e of shown) if (e.t <= t) s = e.screen
    return s
  }
  console.log(`# ${file}`)
  for (const w of take.words ?? []) {
    const label = w.text.replace(/[.,!?]/g, "").toLowerCase()
    if (!LABELS.includes(label)) continue
    const k = screenAt(w.start)
    if (k === null) continue
    const size = take.screens[k]
    const seen = pointerOn(
      take.pointer,
      k,
      w.start - BEFORE,
      w.end + AFTER,
      size,
    )
    const parts = [
      ...seen.strokes.map((s) => s.kind),
      ...seen.rests.map((r) => (r.to - r.from >= 450 ? "rest" : "")),
    ].filter(Boolean)
    const read = parts.length ? parts.join("+") : "still"
    count(label, read)
    console.log(
      `${(w.start / 1000).toFixed(1).padStart(6)}s  ${label.padEnd(10)} ${read}`,
    )
  }
  console.log()
}

console.log(
  "label      what the reading saw after it (strokes and rests, in order)",
)
for (const label of LABELS) {
  const row = tally.get(label)
  if (!row) continue
  const total = [...row.values()].reduce((a, b) => a + b, 0)
  const line = [...row.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")
  console.log(`${label.padEnd(10)} n=${String(total).padStart(2)}  ${line}`)
}
