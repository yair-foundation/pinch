// The package end-to-end tests: each mock take (scenarios.ts) placed and exported by the app's own
// code in headless Chromium, and its package held to what the take should make (analyze.ts). Not
// in `pnpm test`, which needs no browser: run with `pnpm test:e2e`. The zips, their notes.md and
// report.md are left in .e2e/package to read.
import assert from "node:assert/strict"
import path from "node:path"
import { before, describe, it } from "node:test"
import { type Packed, runScenarios, writeRuns } from "./run"
import { SCENARIOS } from "./scenarios"

let runs: Packed[] = []

before(async () => {
  runs = await runScenarios()
  writeRuns(runs, path.resolve(__dirname, "../../.e2e/package"))
})

describe("the package an agent gets, end to end", () => {
  for (const scenario of SCENARIOS)
    it(`${scenario.name}: ${scenario.about}`, () => {
      const run = runs.find((r) => r.scenario.name === scenario.name)
      assert.ok(run, "the scenario ran")
      const { findings, metrics } = run.report
      assert.deepEqual(
        findings.map((f) => `${f.level}: ${f.what}`),
        [],
        "everything the take should make is in the package, said as it should be",
      )
      assert.equal(metrics.notesInPackage, scenario.expect.notes.length)
      // What it costs to read stays in bounds: notes.md short, the marked copies at Export's size.
      assert.ok(
        metrics.notesMdChars < 8000,
        `notes.md is ${metrics.notesMdChars} characters`,
      )
      assert.ok(metrics.markedLongSide.every((n) => n <= 1800))
    })
})
