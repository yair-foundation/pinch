// Scores Pinch's reading, as the code stands now, on every labelled take (D201): one line a take
// and the total. A change to the reading ships only if the total does not get worse.
//
//   node --import tsx scripts/kept-takes/score.ts [<kept takes folder>] [--save <run.json>] [--against <run.json>]
//
// The folder defaults to $PINCH_KEPT_TAKES. Each take is a folder in it with `take.json` and
// `labels.json` (from `prepare.ts` and `label.html`). `--save` keeps this run's counts;
// `--against` sets them beside an earlier run and exits 1 if any number got worse.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { Take } from "../../src/lib/pin/narration"
import {
  addTally,
  emptyTally,
  type LabelFile,
  RATES,
  rate,
  scoreTake,
  type Tally,
} from "./lib"

function args(argv: string[]) {
  const out = { dir: process.env.PINCH_KEPT_TAKES ?? "", save: "", against: "" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--save") out.save = argv[++i]
    else if (a === "--against") out.against = argv[++i]
    else out.dir = a
  }
  return out
}

const opts = args(process.argv.slice(2))
if (!opts.dir) {
  console.error(
    "Usage: node --import tsx scripts/kept-takes/score.ts <kept takes folder> [--save run.json] [--against run.json]",
  )
  process.exit(1)
}

const root = resolve(opts.dir)
/** The folder itself if it is one take, otherwise every take folder in it. */
const folders = existsSync(join(root, "labels.json"))
  ? [root]
  : readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name))
      .filter(
        (f) =>
          existsSync(join(f, "labels.json")) &&
          existsSync(join(f, "take.json")),
      )
      .sort()

if (!folders.length) {
  console.error(
    `No labelled takes in ${root}: each needs take.json and labels.json.`,
  )
  process.exit(1)
}

const pct = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`)
const cell = (t: Tally, of: [keyof Tally, keyof Tally]) =>
  t[of[1]] ? `${pct(rate(t, of))} (${t[of[0]]}/${t[of[1]]})` : "–"

const rows: { name: string; tally: Tally }[] = folders.map((f) => {
  const take = JSON.parse(readFileSync(join(f, "take.json"), "utf8")) as Take
  const labels = JSON.parse(
    readFileSync(join(f, "labels.json"), "utf8"),
  ) as LabelFile
  return { name: f.slice(root.length + 1) || f, tally: scoreTake(take, labels) }
})
const total = rows.map((r) => r.tally).reduce(addTally, emptyTally())

for (const { name, tally } of rows) {
  console.log(
    `# ${name}: ${tally.labels} labels checked, ${tally.missing} notes meant and not made`,
  )
  for (const r of RATES)
    console.log(`  ${r.name.padEnd(28)} ${cell(tally, r.of)}`)
  console.log()
}
if (rows.length > 1) {
  console.log(
    `# All ${rows.length} takes: ${total.labels} labels checked, ${total.missing} notes meant and not made`,
  )
  for (const r of RATES)
    console.log(`  ${r.name.padEnd(28)} ${cell(total, r.of)}`)
  console.log()
}

let worse = false
if (opts.against) {
  const before = JSON.parse(readFileSync(opts.against, "utf8")) as {
    total: Tally
  }
  console.log(`# Against ${opts.against}`)
  for (const r of RATES) {
    const was = rate(before.total, r.of)
    const now = rate(total, r.of)
    if (was === null || now === null) continue
    const delta = Math.round((now - was) * 1000) / 10
    if (delta < 0) worse = true
    const sign = delta > 0 ? "+" : ""
    console.log(
      `  ${r.name.padEnd(28)} ${pct(was)} to ${pct(now)} (${sign}${delta} points)${delta < 0 ? "  WORSE" : ""}`,
    )
  }
  if (before.total.labels !== total.labels)
    console.log(
      `  The runs scored different labels: ${before.total.labels} then ${total.labels}.`,
    )
}
if (opts.save) {
  writeFileSync(
    opts.save,
    `${JSON.stringify({ scoredAt: new Date().toISOString(), takes: rows, total }, null, 2)}\n`,
  )
  console.log(`Saved to ${opts.save}.`)
}
if (worse) process.exit(1)
