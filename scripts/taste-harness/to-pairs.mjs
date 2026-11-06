// Turns the simulated results into hand-vs-Pinch test folders, one per designer, so predict.ts can
// be run end to end: pairs of arms from each cell, picked by the hidden-taste judge's mean rank.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

const EXP = process.argv[2] ?? path.join(process.env.HOME ?? "~", "taste-harness")
const J = (f) => JSON.parse(readFileSync(f, "utf8"))
const PAIRS = [
  ["A", "B"],
  ["B", "C"],
  ["C", "D"],
  ["A", "D"],
]
for (const i of [1, 2, 3]) {
  const d = J(path.join(EXP, `d${i}`, "designer.json"))
  const out = path.join(EXP, "pairs", `d${i}`)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(path.join(out, "builds"), { recursive: true })
  mkdirSync(path.join(out, "renders"), { recursive: true })
  const pairs = [],
    results = {}
  let n = 0
  for (const t of [1, 2])
    for (const r of [1, 2]) {
      const dir = path.join(EXP, `d${i}`, `t${t}`, `r${r}`)
      const vs = [1, 2]
        .map((p) => path.join(dir, `verdict-${p}.json`))
        .filter(existsSync)
        .map(J)
      if (!vs.length) continue
      const rank = (a) =>
        vs.reduce((s, v) => s + v.rank.indexOf(a), 0) / vs.length
      for (const [x, y] of PAIRS) {
        if (
          !existsSync(path.join(dir, x, "render.png")) ||
          !existsSync(path.join(dir, y, "render.png"))
        )
          continue
        if (rank(x) === rank(y)) continue
        const id = `p${++n}`,
          lx = `${id}${x}`.toLowerCase(),
          ly = `${id}${y}`.toLowerCase()
        for (const [bid, arm] of [
          [lx, x],
          [ly, y],
        ]) {
          cpSync(
            path.join(dir, arm, "index.html"),
            path.join(out, "builds", `${bid}.html`),
          )
          cpSync(
            path.join(dir, arm, "render.png"),
            path.join(out, "renders", `${bid}.png`),
          )
        }
        const swap = n % 2 === 0
        const left = swap ? ly : lx,
          right = swap ? lx : ly
        pairs.push({ id, task: t, left, right, arms: swap ? [y, x] : [x, y] })
        const winner = rank(x) < rank(y) ? lx : ly
        results[id] = {
          pick: winner === left ? "left" : "right",
          changes: { left: 0, right: 0 },
        }
      }
    }
  writeFileSync(
    path.join(out, "key.json"),
    JSON.stringify({ tasks: d.tasks }, null, 2),
  )
  writeFileSync(
    path.join(out, "blind.json"),
    JSON.stringify({ pairs }, null, 2),
  )
  writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
  )
  console.log(`d${i}: ${pairs.length} pairs`)
}
