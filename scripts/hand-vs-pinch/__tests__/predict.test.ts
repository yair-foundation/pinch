import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { agreed, agreement } from "../predict"

describe("predicting the author's picks", () => {
  it("counts a judge's pick only when both orders agree", () => {
    assert.equal(agreed({ asShown: "a", swapped: "b" }), "left")
    assert.equal(agreed({ asShown: "b", swapped: "a" }), "right")
    assert.equal(agreed({ asShown: "a", swapped: "a" }), null)
    assert.equal(agreed({ asShown: "a" }), null)
  })

  it("scores a match as one and unsure as half", () => {
    const a = agreement([
      { author: "left", judge: "left" },
      { author: "left", judge: "right" },
      { author: "right", judge: null },
      { author: "right", judge: "right" },
    ])
    assert.deepEqual(a, { score: 0.625, n: 4, hits: 2, unsure: 1 })
  })
})
