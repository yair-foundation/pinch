// Replays a take kept beside an export (D183) through Pinch's own placing of notes, with no
// browser and no audio, and prints each note as it lands: the screen, its number, where, and the
// words. It is the baseline the pointer reading is tuned against: run it on the same takes before
// and after a change to `voice-notes.ts` and compare.
//
//   node --import tsx scripts/replay-take.ts <pinch-take-….json> [more…]
import { readFileSync } from "node:fs"
import type { Asset, Shape } from "../src/lib/pin/model"
import type { Take } from "../src/lib/pin/narration"
import { applyTake, isWhole, voiceNotes } from "../src/lib/pin/voice-notes"

const pct = (n: number) => `${Math.round(n * 100)}%`

/** A note's place, in a line: where the mark is, in fractions of the screenshot. */
function placeOf(s: Shape): string {
  if (isWhole(s)) return "whole screen"
  if (s.kind === "dot") return `dot ${pct(s.x)},${pct(s.y)}`
  if (s.kind === "arrow")
    return `arrow ${pct(s.x)},${pct(s.y)} to ${pct(s.x2)},${pct(s.y2)}`
  return `area ${pct(s.x)},${pct(s.y)} ${pct(s.w)}x${pct(s.h)}`
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error(
    "Usage: node --import tsx scripts/replay-take.ts <pinch-take-….json> [more…]",
  )
  process.exit(1)
}

for (const file of files) {
  const take = JSON.parse(readFileSync(file, "utf8")) as Take
  const assets: Asset[] = take.screens.map((s) => ({
    id: s.id,
    name: s.name,
    type: "image/png",
    width: s.width,
    height: s.height,
    note: "",
    marks: [],
  }))
  const made = applyTake(assets, take)
  const notes = made.reduce((n, a) => n + voiceNotes(a).length, 0)
  console.log(
    `# ${file}: ${take.screens.length} screens, ${Math.round(take.durationMs / 1000)} s, ` +
      `${take.pointer.length} pointer samples, ${take.words?.length ?? 0} words, ${notes} notes`,
  )
  for (const a of made) {
    const list = voiceNotes(a)
    if (!list.length) continue
    console.log(`\n## ${a.name}`)
    list.forEach((m, i) => {
      const words = m.quote ?? [m.good, m.bad].filter(Boolean).join(" ")
      // Every spot the note points at, in the order pointed at (D190).
      // One said with nothing pointed at is kept on the whole screen, and says so (D194).
      const places = m.unpointed
        ? "not pointed at"
        : [m.shape, ...(m.also ?? [])].map(placeOf).join("; ")
      console.log(`- ${i + 1}. ${places}: ${words}`)
    })
  }
  console.log()
}
