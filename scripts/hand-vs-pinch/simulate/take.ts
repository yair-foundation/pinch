// The hand-vs-Pinch test run with a made-up designer (D145, docs/hand-vs-pinch.md): their
// walkthrough as Pinch hears it, with no audio. Each note is said as words with their times, while
// the pointer moves to the element the designer means, circles it, then rests on it. Pinch's own
// code (`applyTake`) makes the notes and their marks from that, as it does from a real take
// (D137). Then the designer checks the end card, as a person would: a note whose works or doesn't
// came out other than they meant is switched.
//
//   node --import tsx scripts/hand-vs-pinch/simulate/take.ts <designer.json> <sizes.json> <session.json> [--as-filed]
//
// designer.json is what designer-prompt.md asks for; sizes.json maps each screenshot's file name
// to [width, height]. The session goes into the browser's IndexedDB `pin-notes`: the assets under
// `assets` in `state`, each screenshot under its asset's id in `images`.
import { readFileSync, writeFileSync } from "node:fs"
import type { Asset } from "../../../src/lib/pin/model"
import type { PointerSample, Shown, Take } from "../../../src/lib/pin/narration"
import {
  applyTake,
  flipVerdict,
  isWhole,
  removedScreens,
  voiceNotes,
} from "../../../src/lib/pin/voice-notes"
import type { TimedWord } from "../../../src/lib/pin/voice-tags"

type Note = {
  screen: string
  verdict: "works" | "doesnt"
  text: string
  box: { x: number; y: number; w: number; h: number }
}
const [designerFile, sizesFile, out, flag] = process.argv.slice(2)
// With --as-filed, the notes stay as Pinch filed them, unchecked, to see what a reading catches.
const check = flag !== "--as-filed"
const d = JSON.parse(readFileSync(designerFile, "utf8")) as { notes: Note[] }
const sizes: Record<string, [number, number]> = JSON.parse(
  readFileSync(sizesFile, "utf8"),
)
const names = Object.keys(sizes).sort()
const assets: Asset[] = names.map((name, i) => ({
  id: `sim${i.toString(36)}${name.replace(/\W/g, "")}`,
  name,
  type: "image/webp",
  width: sizes[name][0],
  height: sizes[name][1],
  note: "",
  marks: [],
}))

const WORD = 280
const GAP = 60
const BETWEEN = 1200
const STEP = 40
const words: TimedWord[] = []
const pointer: PointerSample[] = []
const shown: Shown[] = []
let t = 0
const said: { note: Note; screen: number }[] = []
// Where the hand is, so it moves to the next element before the words start, as pointing leads
// speech: it arrives 500 ms before the first word and waits there.
let hand: [number, number] = [0.5, 0.5]
names.forEach((name, k) => {
  shown.push({ t, screen: k })
  hand = [0.5, 0.5]
  t += 1200
  for (const note of d.notes.filter((n) => n.screen === name)) {
    const parts = note.text.trim().split(/\s+/)
    const start = t
    for (const text of parts) {
      words.push({ text, start: t, end: t + WORD })
      t += WORD + GAP
    }
    const end = t - GAP
    const cx = note.box.x + note.box.w / 2
    const cy = note.box.y + note.box.h / 2
    const rx = note.box.w / 2 + 0.015
    const ry = note.box.h / 2 + 0.015
    const circle = Math.min(1800, end - start)
    const arrive: [number, number] = [cx, cy - ry]
    for (let s = start - 900; s <= start - 500; s += STEP) {
      const f = (s - (start - 900)) / 400
      pointer.push([
        s,
        k,
        hand[0] + (arrive[0] - hand[0]) * f,
        hand[1] + (arrive[1] - hand[1]) * f,
      ])
    }
    for (let s = start - 300; s <= end; s += STEP) {
      const f = Math.min(1, Math.max(0, (s - (start - 300)) / circle))
      const a = -Math.PI / 2 + f * 2.2 * Math.PI
      const p: [number, number] =
        f < 1 ? [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] : [cx, cy]
      pointer.push([
        s,
        k,
        Math.min(1, Math.max(0, p[0])),
        Math.min(1, Math.max(0, p[1])),
      ])
    }
    hand = [cx, cy]
    said.push({ note, screen: k })
    t += BETWEEN
  }
  t += 400
})
shown.push({ t, screen: null })

const take: Take = {
  id: "simtake1",
  version: 1,
  recordedAt: new Date().toISOString(),
  durationMs: t,
  mimeType: "audio/webm",
  screens: assets.map((a) => ({
    id: a.id,
    name: a.name,
    width: a.width,
    height: a.height,
  })),
  shown,
  pointer,
  words,
}

let made = applyTake(assets, take)
const removed = removedScreens(take, [])
// The end card's check: a note whose works or doesn't came out other than the designer meant is
// switched. Each note is matched to the designer's note on its screen it shares most words with
// (a note can join what was said in several sentences, D147). A note holding both sides is left
// as it is: the designer may have said both.
const wordsOf = (x: string) => new Set(x.toLowerCase().match(/[a-z']+/g) ?? [])
const meantOf = (screen: string, quote: string) => {
  const mine = wordsOf(quote)
  let best: Note | undefined
  let most = 0
  for (const s of said) {
    if (s.note.screen !== screen) continue
    const shared = [...wordsOf(s.note.text)].filter((w) => mine.has(w)).length
    if (shared > most) {
      most = shared
      best = s.note
    }
  }
  return best
}
let flipped = 0
let mixed = 0
made = made.map((a) => ({
  ...a,
  marks: a.marks.map((m) => {
    const note = meantOf(a.name, m.quote ?? "")
    if (!note || !check) return m
    if (m.good.trim() && m.bad.trim()) {
      mixed++
      return m
    }
    const meant = note.verdict === "works" ? "good" : "bad"
    const got = m.good.trim() ? "good" : "bad"
    if (meant === got) return m
    flipped++
    return flipVerdict(m)
  }),
}))
const marks = made.flatMap((a) => voiceNotes(a))
const kinds = marks.reduce<Record<string, number>>((n, m) => {
  const k = isWhole(m.shape) ? "whole" : m.shape.kind
  n[k] = (n[k] ?? 0) + 1
  return n
}, {})
writeFileSync(out, JSON.stringify(made))
console.log(
  JSON.stringify({
    notesSaid: said.length,
    notesMade: marks.length,
    shapes: kinds,
    flipped,
    mixed,
    screensRemoved: removed,
    minutes: +(t / 60000).toFixed(1),
  }),
)
