import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PointerSample, Take } from "../../../src/lib/pin/narration"
import type { TimedWord } from "../../../src/lib/pin/voice-tags"
import {
  hits,
  type Label,
  type LabelFile,
  overlap,
  predict,
  remarkFor,
  scoreLabel,
  scoreTake,
  stanceOf,
  targetOf,
  tokens,
} from "../lib"

/** Words 300ms apart from `t`. */
function say(text: string, t: number): TimedWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((token, i) => ({
      text: token,
      start: t + i * 300,
      end: t + i * 300 + 250,
    }))
}

/** The pointer going round a circle on a screen from `from`, one sample every 20ms. */
function circle(
  screen: number,
  cx: number,
  cy: number,
  r: number,
  from: number,
): PointerSample[] {
  const out: PointerSample[] = []
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI
    out.push([
      from + i * 20,
      screen,
      cx + r * Math.cos(a),
      cy + r * Math.sin(a),
    ])
  }
  return out
}

const take = (words: TimedWord[], pointer: PointerSample[] = []): Take => ({
  id: "kept-test",
  version: 1,
  recordedAt: "2026-11-13T10:00:00.000Z",
  durationMs: 40_000,
  mimeType: "audio/webm",
  screens: ["one", "two", "three"].map((id) => ({
    id,
    name: `${id}.png`,
    width: 1000,
    height: 1000,
  })),
  shown: [
    { t: 0, screen: 0 },
    { t: 10_000, screen: 1 },
    { t: 20_000, screen: 2 },
    { t: 30_000, screen: null },
  ],
  pointer,
  words,
})

const box = (x: number, y: number, w: number, h: number) => ({
  kind: "area" as const,
  x,
  y,
  w,
  h,
})

const label = (
  more: Partial<Label> & Pick<Label, "screen" | "text" | "target">,
): Label => ({
  key: `${more.screen}@0`,
  at: 0,
  checked: true,
  ...more,
})

describe("kept takes: what a note does", () => {
  it("reads approval, a question and the rest as the package would", () => {
    assert.equal(stanceOf("This slide is okay."), "approval")
    assert.equal(
      stanceOf("Do you have an idea how to make it better?"),
      "question",
    )
    assert.equal(stanceOf("Off-brand."), "objection")
  })
})

describe("kept takes: whether a mark lands on what was meant", () => {
  const target = box(0.4, 0.3, 0.2, 0.2)
  it("takes a point on the thing, or just beside it", () => {
    assert.ok(hits({ kind: "dot", x: 0.5, y: 0.4 }, target))
    assert.ok(hits({ kind: "dot", x: 0.61, y: 0.4 }, target))
    assert.ok(!hits({ kind: "dot", x: 0.8, y: 0.8 }, target))
  })
  it("takes a loose circle round it and a tight one inside it", () => {
    assert.ok(hits(box(0.35, 0.25, 0.3, 0.3), target))
    assert.ok(hits(box(0.45, 0.35, 0.05, 0.05), target))
  })
  it("does not take the whole screen, or half of it", () => {
    assert.ok(!hits(box(0, 0, 1, 1), target))
    assert.ok(!hits(box(0, 0, 1, 0.5), target))
  })
})

describe("kept takes: finding a remark again", () => {
  it("matches words however they were cut, and nothing unrelated", () => {
    assert.equal(
      overlap(
        tokens("These cards are calm"),
        tokens("These three cards are calm."),
      ),
      1,
    )
    const { remarks } = predict(take(say("These three cards are calm.", 1000)))
    assert.ok(
      remarkFor(
        remarks,
        label({
          screen: 0,
          text: "these cards are calm",
          target: { kind: "screen" },
        }),
      ),
    )
    assert.equal(
      remarkFor(
        remarks,
        label({
          screen: 0,
          text: "The logo is too big",
          target: { kind: "screen" },
        }),
      ),
      null,
    )
  })
  it("looks on the screen either side, for a remark said as the reel turned", () => {
    const { remarks } = predict(take(say("These three cards are calm.", 1000)))
    assert.ok(
      remarkFor(
        remarks,
        label({
          screen: 1,
          text: "These three cards are calm.",
          target: { kind: "screen" },
        }),
      ),
    )
  })
})

describe("kept takes: scoring a take", () => {
  const circled = take(
    say("These three cards are calm.", 1000),
    circle(0, 0.5, 0.4, 0.1, 1100),
  )

  it("proposes a note's spots as boxes, a point as a small one", () => {
    const { remarks } = predict(circled)
    const note = remarks[0].note
    assert.ok(note)
    assert.equal(targetOf(note).kind, "spots")
    const dot = targetOf({
      ...note,
      spots: [{ kind: "dot", x: 0.5, y: 0.5 }],
    })
    assert.ok(dot.kind === "spots" && dot.boxes[0].w < 0.05)
  })

  it("scores a mark on the spot meant as placed", () => {
    const file: LabelFile = {
      version: 1,
      take: circled.id,
      labelledAt: "",
      labels: [
        label({
          screen: 0,
          text: "These three cards are calm.",
          target: { kind: "spots", boxes: [box(0.38, 0.28, 0.24, 0.24)] },
          stance: "objection",
        }),
      ],
    }
    const t = scoreTake(circled, file)
    assert.deepEqual(
      [t.labels, t.placed, t.placedOf, t.hit, t.onTarget, t.stance],
      [1, 1, 1, 1, 1, 1],
    )
  })

  it("scores a mark somewhere else as not placed, and a missed approval", () => {
    const file: LabelFile = {
      version: 1,
      take: circled.id,
      labelledAt: "",
      labels: [
        label({
          screen: 0,
          text: "These three cards are calm.",
          target: { kind: "spots", boxes: [box(0.05, 0.8, 0.1, 0.1)] },
          stance: "approval",
        }),
      ],
    }
    const t = scoreTake(circled, file)
    assert.deepEqual(
      [t.placed, t.hit, t.hitOf, t.onTarget, t.onTargetOf],
      [0, 0, 1, 0, 1],
    )
    assert.deepEqual([t.stance, t.approvals, t.approvalsOf], [0, 0, 1])
  })

  it("counts a misheard remark the list did not name, and leaves unchecked labels out", () => {
    const { remarks } = predict(circled)
    const missed = scoreLabel(
      label({
        screen: 0,
        text: remarks[0].text,
        target: { kind: "screen" },
        misheard: true,
      }),
      remarks[0],
    )
    assert.deepEqual([missed.caught, missed.caughtOf, missed.flags], [0, 1, 0])
    const open = scoreLabel(
      label({
        screen: 0,
        text: remarks[0].text,
        target: { kind: "screen" },
        checked: false,
      }),
      remarks[0],
    )
    assert.equal(open.labels, 0)
  })

  it("counts a remark that is not a note as kept out only when no note was made of it", () => {
    const { remarks } = predict(circled)
    const made = scoreLabel(
      label({ screen: 0, text: remarks[0].text, target: { kind: "none" } }),
      remarks[0],
    )
    assert.deepEqual([made.keptOut, made.keptOutOf], [0, 1])
    const none = scoreLabel(
      label({ screen: 0, text: "Okay.", target: { kind: "none" } }),
      null,
    )
    assert.deepEqual([none.keptOut, none.keptOutOf], [1, 1])
  })
})
