// Writes one take out for labelling (D201): the take, Pinch's reading of it as the code stands,
// the screenshots it was said over, and the page to label it on. Run it on the take that sits
// beside an export (`pinch-take-….json`, D183), with the export's folder for the screenshots:
//
//   node --import tsx scripts/kept-takes/prepare.ts <pinch-take-….json> \
//     --images <pinch-notes-… folder or a folder of the original screenshots> [--images <more>] \
//     --out <kept takes folder>/<name>
//
// Then open <out>/label.html in a browser, label, and save `labels.json` into <out>. The folder
// holds the author's words: keep it out of this repository.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { slug } from "../../src/lib/pin/model"
import type { Take } from "../../src/lib/pin/narration"
import { type LabelFile, predict, STANCES, targetOf } from "./lib"

const here = dirname(fileURLToPath(import.meta.url))
const IMAGE = /\.(png|jpe?g|webp|gif)$/i

function args(argv: string[]) {
  const out = { take: "", images: [] as string[], out: "" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--images") out.images.push(argv[++i])
    else if (a === "--out") out.out = argv[++i]
    else if (!out.take) out.take = a
  }
  return out
}

/** Every image under a folder, by the name it would have as a screen, plain copies first. */
function imagesUnder(dirs: readonly string[]): Map<string, string> {
  const found = new Map<string, { path: string; rank: number }>()
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!IMAGE.test(name)) continue
      // An export names a screenshot "04-<slug>.png" and keeps a marked copy and close-ups beside it.
      const folder = basename(dir)
      if (folder === "crops" || /-note-\d+(-\d+)?\.[a-z]+$/i.test(name))
        continue
      const rank = folder === "images" ? 0 : folder === "marked" ? 2 : 1
      const stem = name.replace(IMAGE, "")
      for (const key of [slug(stem), slug(stem.replace(/^\d+-/, ""))]) {
        const had = found.get(key)
        if (!had || rank < had.rank) found.set(key, { path, rank })
      }
    }
  }
  for (const dir of dirs) walk(resolve(dir))
  return new Map([...found].map(([k, v]) => [k, v.path]))
}

const opts = args(process.argv.slice(2))
if (!opts.take || !opts.out) {
  console.error(
    "Usage: node --import tsx scripts/kept-takes/prepare.ts <pinch-take-….json> --images <folder> --out <folder>",
  )
  process.exit(1)
}

const take = JSON.parse(readFileSync(opts.take, "utf8")) as Take
const out = resolve(opts.out)
mkdirSync(join(out, "screens"), { recursive: true })

const { remarks } = predict(take)
const said = new Set(remarks.map((r) => r.screen))
const images = imagesUnder(opts.images)
const digits = String(take.screens.length).length
let found = 0
let marked = 0
const screens = take.screens.map((s, i) => {
  const from = said.has(i) ? images.get(slug(s.name)) : undefined
  if (!from)
    return { name: s.name, width: s.width, height: s.height, image: null }
  found++
  if (basename(dirname(from)) === "marked") marked++
  const to = `screens/${String(i + 1).padStart(digits, "0")}${extname(from).toLowerCase()}`
  copyFileSync(from, join(out, to))
  return { name: s.name, width: s.width, height: s.height, image: to }
})

if (resolve(opts.take) !== join(out, "take.json"))
  writeFileSync(join(out, "take.json"), JSON.stringify(take))

const labelsPath = join(out, "labels.json")
const saved = existsSync(labelsPath)
  ? (JSON.parse(readFileSync(labelsPath, "utf8")) as LabelFile)
  : null

const draft = {
  take: take.id,
  name: basename(out),
  recordedAt: take.recordedAt,
  stances: STANCES,
  screens,
  remarks: remarks.map((r) => ({
    key: r.key,
    screen: r.screen,
    at: r.at,
    text: r.text,
    kind: r.kind,
    unsure: r.unsure ?? null,
    note: r.note && {
      spots: r.note.spots,
      whole: r.note.whole,
      unpointed: r.note.unpointed,
      stance: r.note.stance,
      takesBack: r.note.takesBack,
    },
    proposed: targetOf(r.note),
  })),
  labels: saved?.labels ?? null,
}
writeFileSync(
  join(out, "draft.js"),
  `window.PINCH_DRAFT = ${JSON.stringify(draft)};\n`,
)
copyFileSync(join(here, "label.html"), join(out, "label.html"))

const need = said.size
console.log(
  `${basename(out)}: ${take.screens.length} screens, ${remarks.length} remarks on ${need} of them.`,
)
console.log(
  `Screenshots found for ${found} of the ${need} screens spoken over` +
    (marked
      ? `, ${marked} of them marked copies (no plain screenshot found)`
      : "") +
    ".",
)
if (found < need)
  console.log(
    "Remarks on a screen with no screenshot can still be labelled, but not placed.",
  )
if (saved)
  console.log(
    `Picked up ${saved.labels.filter((l) => l.checked).length} checked labels from labels.json.`,
  )
const page = relative(process.cwd(), join(out, "label.html"))
console.log(
  `Open ${page.startsWith("..") ? join(out, "label.html") : page} in a browser to label.`,
)
