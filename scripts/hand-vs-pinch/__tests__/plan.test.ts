import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  type Answer,
  blind,
  buildPrompt,
  SETTINGS,
  score,
  settingsProblems,
} from "../plan"

describe("the hand-vs-Pinch test", () => {
  const { builds, pairs } = blind(2, 2)
  const armOf = new Map(builds.map((b) => [b.id, b.arm]))
  /** Every pair judged for Pinch, its builds needing `pinch` changes against the hand's `hand`. */
  const pinchWins = (pinch: number, hand: number): Record<string, Answer> =>
    Object.fromEntries(
      pairs.map((p) => {
        const left = armOf.get(p.left) === "pinch"
        return [
          p.id,
          {
            pick: left ? "left" : "right",
            changes: { left: left ? pinch : hand, right: left ? hand : pinch },
          },
        ]
      }),
    )
  const ties: Record<string, Answer> = Object.fromEntries(
    pairs.map((p) => [p.id, { pick: "same", changes: { left: 2, right: 2 } }]),
  )

  it("pairs one build from each input per task and run, named by ids that say nothing", () => {
    assert.equal(builds.length, 8)
    assert.equal(pairs.length, 4)
    const ids = [...builds, ...pairs].map((x) => x.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.match(id, /^[a-z0-9]{6}$/)
    for (const p of pairs) {
      assert.notEqual(armOf.get(p.left), armOf.get(p.right))
      assert.equal(builds.find((b) => b.id === p.left)?.task, p.task)
    }
  })

  it("asks both inputs the same, the task in its words", () => {
    const prompt = buildPrompt("  A pricing page.  ")
    assert.match(prompt, /\n\nA pricing page\.\n\n/)
    assert.match(prompt, /\.\/input/)
    assert.doesNotMatch(prompt, /pinch|notes\.md|index\.md/i)
  })

  it("wants two to four tasks before building", () => {
    assert.equal(settingsProblems(SETTINGS).length, 1)
    assert.deepEqual(settingsProblems({ ...SETTINGS, tasks: ["a", "b"] }), [])
    assert.equal(
      settingsProblems({ ...SETTINGS, tasks: ["a", "b", "c", "d", "e"] })
        .length,
      1,
    )
  })

  it("gives the verdict set before the test", () => {
    const v = (
      a: Record<string, Answer>,
      pinch: number | null,
      hand: number | null,
    ) => score(builds, pairs, a, { pinch, hand }).verdict
    assert.equal(v(pinchWins(1, 4), 10, 10), "Dramatically better")
    assert.equal(
      v(pinchWins(1, 4), 13, 10),
      "Better",
      "more than 1.25 times the minutes",
    )
    assert.equal(v(pinchWins(4, 4), 10, 10), "Better", "no fewer changes")
    assert.equal(v(pinchWins(5, 4), 10, 10), "Not better", "more changes")
    assert.equal(
      v(pinchWins(1, 4), 16, 10),
      "Not better",
      "more than 1.5 times the minutes",
    )
    assert.equal(
      v(ties, 5, 10),
      "Dramatically better",
      "as good in half the minutes",
    )
    assert.equal(v(ties, 6, 10), "Not better", "a tie isn't more than half")
    assert.equal(v(pinchWins(1, 4), null, 10), "Needs the minutes")
  })

  it("counts only what was judged", () => {
    const first = pairs[0].id
    const s = score(
      builds,
      pairs,
      { [first]: pinchWins(1, 4)[first] },
      { pinch: 10, hand: 10 },
    )
    assert.equal(s.judged, 1)
    assert.equal(s.pairs, 4)
    assert.deepEqual(s.changes, { hand: 4, pinch: 1 })
    assert.equal(s.pinchShare, 1)
  })
})
