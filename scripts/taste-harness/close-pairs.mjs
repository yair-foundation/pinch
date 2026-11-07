// Harder pairs for predict.ts: screens all built with the designer's take, ranked by the
// hidden-taste judge in both of its passes the same way round (verdict-cost: arms B, F, G, H, I).
// One folder per designer, as hand-vs-Pinch test folders. Two judgings agreeing is the label;
// pairs where they disagree are left out.
//
//   node scripts/taste-harness/close-pairs.mjs <dir> [designers…]     default d2 d4 d5
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

const [dirArg, ...named] = process.argv.slice(2)
const EXP = dirArg ?? path.join(process.env.HOME ?? "~", "taste-harness")
const DESIGNERS = named.length ? named : ["d2", "d4", "d5"]
const ARMS = ["B", "F", "G", "H", "I"]
const J = (f) => JSON.parse(readFileSync(f, "utf8"))

for (const d of DESIGNERS) {
  const designer = J(path.join(EXP, d, "designer.json"))
  const out = path.join(EXP, "pairs-close", d)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(path.join(out, "builds"), { recursive: true })
  mkdirSync(path.join(out, "renders"), { recursive: true })
  const pairs = []
  const results = {}
  for (const t of [1, 2])
    for (const r of [1, 2]) {
      const cell = path.join(EXP, d, `t${t}`, `r${r}`)
      const verdicts = [1, 2]
        .map((p) => path.join(cell, `verdict-cost-${p}.json`))
        .filter(existsSync)
        .map(J)
      if (verdicts.length < 2) continue
      for (const [i, x] of ARMS.entries())
        for (const y of ARMS.slice(i + 1)) {
          const above = verdicts.map(
            (v) => v.rank.indexOf(x) < v.rank.indexOf(y),
          )
          if (above.at(0) !== above.at(1)) continue
          const id = `t${t}r${r}${x}${y}`.toLowerCase()
          const ids = {
            [x]: `${id}-${x.toLowerCase()}`,
            [y]: `${id}-${y.toLowerCase()}`,
          }
          for (const arm of [x, y]) {
            cpSync(
              path.join(cell, arm, "index.html"),
              path.join(out, "builds", `${ids[arm]}.html`),
            )
            cpSync(
              path.join(cell, arm, "render.png"),
              path.join(out, "renders", `${ids[arm]}.png`),
            )
          }
          const swap = pairs.length % 2 === 1
          const left = swap ? ids[y] : ids[x]
          const right = swap ? ids[x] : ids[y]
          const winner = above.at(0) ? ids[x] : ids[y]
          pairs.push({ id, task: t, left, right })
          results[id] = {
            pick: winner === left ? "left" : "right",
            changes: { left: 0, right: 0 },
          }
        }
    }
  writeFileSync(
    path.join(out, "key.json"),
    JSON.stringify({ tasks: designer.tasks }, null, 2),
  )
  writeFileSync(
    path.join(out, "blind.json"),
    JSON.stringify({ pairs }, null, 2),
  )
  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
  )
  console.log(`${d}: ${pairs.length} pairs`)
}
