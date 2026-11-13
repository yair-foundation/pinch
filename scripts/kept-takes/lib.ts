// The kept takes (plan-2026-11-13.md, section 3; D201): real takes with the author's labels on
// every remark, and the numbers Pinch's reading scores on them. Pure: `prepare.ts` writes a take
// out for labelling, `label.html` is where the author labels it, `score.ts` reads the labels back
// and scores the reading as the code stands now.
//
// A label belongs to what was said, not to how the code cut it into notes, so a later change to
// the reading is scored on the same labels: a label finds its remark again by its words.
import type { Area, Asset, Shape } from "../../src/lib/pin/model"
import { placesOf } from "../../src/lib/pin/model"
import type { Take } from "../../src/lib/pin/narration"
import { asks, kindOf, takesBack } from "../../src/lib/pin/note-kind"
import { remarksOf } from "../../src/lib/pin/take-transcript"
import { applyTake, isWhole, voiceNotes } from "../../src/lib/pin/voice-notes"

/** What a remark does: finds fault, says something is right, both, asks, or none of these. */
export type Stance = "objection" | "approval" | "mixed" | "question" | "other"
export const STANCES: Stance[] = [
  "objection",
  "approval",
  "mixed",
  "question",
  "other",
]

/**
 * What a remark is about, as its author meant it: the spots it points at, the whole screen, no
 * place at all ("This take is a set of bad examples"), or it is not a note ("Okay.", "This is.").
 */
export type Target =
  | { kind: "spots"; boxes: Area[] }
  | { kind: "screen" }
  | { kind: "nowhere" }
  | { kind: "none" }

/** The author's reading of one remark. Only a checked label is scored. */
export type Label = {
  /** The screen and the time the remark began, when it was labelled. */
  key: string
  screen: number
  at: number
  /** The words as they were read, by which the label finds its remark again. */
  text: string
  target: Target
  stance?: Stance
  /** It takes back the remark before it: "Actually you can use this color." */
  takesBack?: boolean
  /** Its words came out wrong: "Too much more, Gene" for "too much margin". */
  misheard?: boolean
  /** Its start or its end is missing. */
  cut?: boolean
  /** What was meant, in full, where the words alone don't say it. Not scored yet. */
  meant?: string
  checked: boolean
}

export type LabelFile = {
  version: 1
  take: string
  labelledAt: string
  labels: Label[]
}

/** A note as the reading makes it now. */
export type PredictedNote = {
  screen: number
  words: string
  spots: Shape[]
  whole: boolean
  unpointed: boolean
  stance: Stance
  takesBack: boolean
}

/** A remark as the reading files it now, with the note it became, if any. */
export type PredictedRemark = {
  key: string
  screen: number
  at: number
  text: string
  kind: "note" | "tag" | "left"
  unsure?: string
  note: PredictedNote | null
}

/** What a note says it does, as the package would tell its reader (D195). */
export function stanceOf(words: string): Stance {
  const kind = kindOf(words)
  if (kind === "right") return "approval"
  if (kind === "partly") return "mixed"
  if (asks(words)) return "question"
  return "objection"
}

/** A remark's words for matching: lower case, letters and digits only. */
export const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** How much of `a` is in `b`, counting a repeated word as often as it is said: 0 to 1. */
export function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length) return 0
  const left = new Map<string, number>()
  for (const t of b) left.set(t, (left.get(t) ?? 0) + 1)
  let found = 0
  for (const t of a) {
    const n = left.get(t) ?? 0
    if (n > 0) {
      found++
      left.set(t, n - 1)
    }
  }
  return found / a.length
}

/** Below this much of its words in common, a remark is not the one a label was made on. */
const SAME = 0.5

/** The item on this screen or the next one either side whose words hold most of `text`. */
function closest<T extends { screen: number; at?: number }>(
  items: readonly T[],
  screen: number,
  text: string,
  wordsOf: (item: T) => string,
  at?: number,
): T | null {
  const want = tokens(text)
  let best: { item: T; score: number } | null = null
  for (const item of items) {
    const away = Math.abs(item.screen - screen)
    if (away > 1) continue
    // A screen either side counts for a little less, so a tie stays on the screen labelled.
    let score = overlap(want, tokens(wordsOf(item))) - away * 0.01
    if (at !== undefined && item.at !== undefined)
      score -= Math.min(Math.abs(item.at - at), 60_000) / 6_000_000
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= SAME - 0.02 ? best.item : null
}

/** Every note and every remark of a take, as the reading makes them now. */
export function predict(take: Take): {
  notes: PredictedNote[]
  remarks: PredictedRemark[]
} {
  const assets: Asset[] = take.screens.map((s) => ({
    id: s.id,
    name: s.name,
    type: "image/png",
    width: s.width,
    height: s.height,
    note: "",
    marks: [],
  }))
  const notes = applyTake(assets, take).flatMap((asset, screen) =>
    voiceNotes(asset).map((m): PredictedNote => {
      const words = m.quote ?? [m.good, m.bad].filter(Boolean).join(" ")
      const spots = placesOf(m)
      return {
        screen,
        words,
        spots,
        whole: !m.unpointed && spots.length === 1 && isWhole(spots[0]),
        unpointed: Boolean(m.unpointed),
        stance: stanceOf(words),
        takesBack: takesBack(words),
      }
    }),
  )
  const remarks = remarksOf(take).map(
    (r): PredictedRemark => ({
      key: `${r.screen}@${r.at}`,
      screen: r.screen,
      at: r.at,
      text: r.text,
      kind: r.kind,
      ...(r.unsure && { unsure: r.unsure }),
      note:
        r.kind === "note"
          ? closest(notes, r.screen, r.text, (n) => n.words)
          : null,
    }),
  )
  return { notes, remarks }
}

/** The remark a label was made on, found again by its words in the reading as it is now. */
export const remarkFor = (remarks: readonly PredictedRemark[], label: Label) =>
  closest(remarks, label.screen, label.text, (r) => r.text, label.at)

/** A small box round a point, for a dot taken as a target. */
export const boxAround = (x: number, y: number, r = 0.02): Area => ({
  kind: "area",
  x: Math.max(0, x - r),
  y: Math.max(0, y - r),
  w: Math.min(1, x + r) - Math.max(0, x - r),
  h: Math.min(1, y + r) - Math.max(0, y - r),
})

/** The target a note's spots stand for, as the labelling page proposes it before it is checked. */
export function targetOf(note: PredictedNote | null): Target {
  if (!note) return { kind: "none" }
  if (note.unpointed) return { kind: "nowhere" }
  if (note.whole) return { kind: "screen" }
  return {
    kind: "spots",
    boxes: note.spots.flatMap((s) =>
      s.kind === "area"
        ? [s]
        : s.kind === "dot"
          ? [boxAround(s.x, s.y)]
          : [boxAround(s.x, s.y), boxAround(s.x2, s.y2)],
    ),
  }
}

/** A point is on a box, or within 2% of the screen of it. */
const onBox = (x: number, y: number, b: Area, pad = 0.02) =>
  x >= b.x - pad &&
  x <= b.x + b.w + pad &&
  y >= b.y - pad &&
  y <= b.y + b.h + pad

/** At least this much of a mark has to lie on the thing meant: a loose circle passes, a frame round half the screen doesn't. */
const ON_TARGET = 0.35

/** Whether a mark lands on a box the author drew round what they meant. */
export function hits(spot: Shape, box: Area): boolean {
  if (spot.kind === "dot") return onBox(spot.x, spot.y, box)
  if (spot.kind === "arrow")
    return onBox(spot.x, spot.y, box) || onBox(spot.x2, spot.y2, box)
  const w = Math.min(spot.x + spot.w, box.x + box.w) - Math.max(spot.x, box.x)
  const h = Math.min(spot.y + spot.h, box.y + box.h) - Math.max(spot.y, box.y)
  const area = spot.w * spot.h
  return w > 0 && h > 0 && area > 0 && (w * h) / area >= ON_TARGET
}

/** The numbers, as counts, so takes add up and two runs compare. */
export type Tally = {
  /** Checked labels. */
  labels: number
  /** Remarks that are notes, placed as meant: on every spot meant and nowhere else, on the screen, or nowhere. */
  placed: number
  placedOf: number
  /** Spots meant that a mark landed on, and marks that landed on a spot meant. */
  hit: number
  hitOf: number
  onTarget: number
  onTargetOf: number
  /** Remarks that are not notes, kept out of the notes. */
  keptOut: number
  keptOutOf: number
  /** Notes meant that the reading made no note of. */
  missing: number
  stance: number
  stanceOf: number
  approvals: number
  approvalsOf: number
  questions: number
  questionsOf: number
  /** Notes that take back the one before, found, and found where none was. */
  backs: number
  backsOf: number
  backsWrong: number
  /** Remarks misheard or cut short that the "Not sure" list names, and how many it names. */
  caught: number
  caughtOf: number
  flagsRight: number
  flags: number
}

export const emptyTally = (): Tally => ({
  labels: 0,
  placed: 0,
  placedOf: 0,
  hit: 0,
  hitOf: 0,
  onTarget: 0,
  onTargetOf: 0,
  keptOut: 0,
  keptOutOf: 0,
  missing: 0,
  stance: 0,
  stanceOf: 0,
  approvals: 0,
  approvalsOf: 0,
  questions: 0,
  questionsOf: 0,
  backs: 0,
  backsOf: 0,
  backsWrong: 0,
  caught: 0,
  caughtOf: 0,
  flagsRight: 0,
  flags: 0,
})

export function addTally(a: Tally, b: Tally): Tally {
  const out = { ...a }
  for (const k of Object.keys(b) as (keyof Tally)[]) out[k] += b[k]
  return out
}

/** One label against the reading as it is now. */
export function scoreLabel(
  label: Label,
  remark: PredictedRemark | null,
): Tally {
  const t = emptyTally()
  if (!label.checked) return t
  t.labels = 1
  const note = remark?.note ?? null
  const target = label.target

  // The "Not sure" list, on every remark: it should name what was misheard or cut, and only that.
  const should = Boolean(label.misheard || label.cut)
  const flagged = Boolean(remark?.unsure)
  if (should) t.caughtOf = 1
  if (should && flagged) t.caught = 1
  if (flagged) t.flags = 1
  if (flagged && should) t.flagsRight = 1

  if (target.kind === "none") {
    t.keptOutOf = 1
    if (!note) t.keptOut = 1
    return t
  }

  t.placedOf = 1
  if (!note) {
    t.missing = 1
    if (target.kind === "spots") t.hitOf = target.boxes.length
    return t
  }
  if (target.kind === "screen") t.placed = note.whole ? 1 : 0
  else if (target.kind === "nowhere")
    t.placed = note.unpointed || note.whole ? 1 : 0
  else {
    const marks = note.whole || note.unpointed ? [] : note.spots
    const hit = target.boxes.filter((b) => marks.some((s) => hits(s, b))).length
    const onTarget = marks.filter((s) =>
      target.boxes.some((b) => hits(s, b)),
    ).length
    t.hitOf = target.boxes.length
    t.hit = hit
    t.onTargetOf = marks.length
    t.onTarget = onTarget
    t.placed = hit === target.boxes.length && onTarget === marks.length ? 1 : 0
  }

  if (label.stance) {
    t.stanceOf = 1
    if (note.stance === label.stance) t.stance = 1
    if (label.stance === "approval") {
      t.approvalsOf = 1
      if (note.stance === "approval") t.approvals = 1
    }
    if (label.stance === "question") {
      t.questionsOf = 1
      if (note.stance === "question") t.questions = 1
    }
  }
  if (label.takesBack) {
    t.backsOf = 1
    if (note.takesBack) t.backs = 1
  } else if (note.takesBack) t.backsWrong = 1
  return t
}

/** A take's labels against the reading as it is now. */
export function scoreTake(take: Take, file: LabelFile): Tally {
  const { remarks } = predict(take)
  return file.labels
    .map((label) => scoreLabel(label, remarkFor(remarks, label)))
    .reduce(addTally, emptyTally())
}

/** The rates a run is judged by, each with the counts behind it. Higher is better for all. */
export const RATES: { name: string; of: [keyof Tally, keyof Tally] }[] = [
  { name: "Placed as meant", of: ["placed", "placedOf"] },
  { name: "Spots meant that were marked", of: ["hit", "hitOf"] },
  { name: "Marks on a spot meant", of: ["onTarget", "onTargetOf"] },
  { name: "Non-notes kept out", of: ["keptOut", "keptOutOf"] },
  { name: "Stance right", of: ["stance", "stanceOf"] },
  { name: "Approvals found", of: ["approvals", "approvalsOf"] },
  { name: "Questions found", of: ["questions", "questionsOf"] },
  { name: "Take-backs found", of: ["backs", "backsOf"] },
  { name: "Misheard or cut, flagged", of: ["caught", "caughtOf"] },
  { name: "Flags that were right", of: ["flagsRight", "flags"] },
]

export const rate = (t: Tally, [n, of]: [keyof Tally, keyof Tally]) =>
  t[of] ? t[n] / t[of] : null
