// Packages one harness take as Export does, with the code of a given Pinch tree, so that two
// versions of the package can be built from the same corrections and the same pictures
// (package.mjs). The pictures are drawn here, in the harness's own headless Chromium: a marked
// copy with numbered boxes and a dimmed close-up of each spot. Each note's "Where" line comes from
// this tree's mark-words.ts; notes.md, pinch-check.md and which files go in come from <tree>.
//
//   node --import tsx scripts/taste-harness/pack-take.ts <render.png> <render-text.json> <take.json> <out> <tree>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import {
  mainColours,
  spotOf,
  type TextLine,
  textIn,
  whereLine,
} from "../../src/lib/pin/mark-words"

const [png, textFile, takeFile, out, tree] = process.argv.slice(2)
if (!png || !textFile || !takeFile || !out || !tree) {
  console.error(
    "Usage: node --import tsx scripts/taste-harness/pack-take.ts <render.png> <render-text.json> <take.json> <out> <tree>",
  )
  process.exit(1)
}

const STAMP = "2026-11-13T10:00:00.000Z"
type Box = { x: number; y: number; w: number; h: number }
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))
/** A box as the designer gave it, kept on the screen and never thinner than a hair. */
function onScreen(b: Box): Box {
  const x = clamp(b.x, 0, 0.99)
  const y = clamp(b.y, 0, 0.99)
  return {
    x,
    y,
    w: clamp(b.w, 0.005, 1 - x),
    h: clamp(b.h, 0.005, 1 - y),
  }
}

/**
 * What the page draws, as plain JavaScript: handed over as text, since a function compiled here
 * carries helpers the page doesn't have. The marked copy is 1800 on its long side, as Export's is.
 */
const DRAW = `async ({ url, boxes }) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const canvasOf = (w, h) => {
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.round(w))
    c.height = Math.max(1, Math.round(h))
    return c
  }
  const jpeg = (c, q) => c.toDataURL("image/jpeg", q).split(",")[1]
  const s = Math.min(1, 1800 / Math.max(W, H))
  const marked = canvasOf(W * s, H * s)
  const g = marked.getContext("2d")
  g.drawImage(img, 0, 0, marked.width, marked.height)
  boxes.forEach((b, i) => {
    const x = b.x * marked.width
    const y = b.y * marked.height
    g.lineWidth = 4
    g.strokeStyle = "#2563eb"
    g.strokeRect(x, y, b.w * marked.width, b.h * marked.height)
    const r = 14
    const cx = Math.max(r + 2, x - 4)
    const cy = Math.max(r + 2, y - 4)
    g.beginPath()
    g.arc(cx, cy, r, 0, 7)
    g.fillStyle = "#2563eb"
    g.fill()
    g.fillStyle = "#ffffff"
    g.font = "600 15px ui-monospace, monospace"
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(String(i + 1), cx, cy + 1)
  })
  const crops = []
  const pixels = []
  for (const b of boxes) {
    const x0 = b.x * W
    const y0 = b.y * H
    const w = b.w * W
    const h = b.h * H
    const pad = 120
    const left = Math.max(0, x0 - pad)
    const top = Math.max(0, y0 - pad)
    const right = Math.min(W, x0 + w + pad)
    const bottom = Math.min(H, y0 + h + pad)
    const crop = canvasOf(right - left, bottom - top)
    const k = crop.getContext("2d")
    k.drawImage(img, left, top, right - left, bottom - top, 0, 0, crop.width, crop.height)
    k.fillStyle = "rgba(0, 0, 0, 0.45)"
    k.beginPath()
    k.rect(0, 0, crop.width, crop.height)
    k.rect(x0 - left, y0 - top, w, h)
    k.fill("evenodd")
    crops.push(jpeg(crop, 0.92))
    // The spot small, for its main colours.
    const small = Math.min(1, 96 / Math.max(w, h))
    const spot = canvasOf(w * small, h * small)
    const q = spot.getContext("2d")
    q.drawImage(img, x0, y0, w, h, 0, 0, spot.width, spot.height)
    pixels.push(Array.from(q.getImageData(0, 0, spot.width, spot.height).data))
  }
  return { marked: jpeg(marked, 0.88), crops, pixels }
}`

async function main() {
  const image = readFileSync(png)
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  const notes = (
    JSON.parse(readFileSync(takeFile, "utf8")) as {
      notes: { words: string; box: Box }[]
    }
  ).notes.map((n) => ({ words: n.words, box: onScreen(n.box) }))
  const lines: TextLine[] = (
    JSON.parse(readFileSync(textFile, "utf8")) as (Box & { t: string })[]
  ).map(({ t, ...box }) => ({ ...box, text: t }))

  const require = createRequire(import.meta.url)
  const { chromium } = require(process.env.PW_PATH || "playwright")
  const browser = await chromium.launch()
  let drawn: { marked: string; crops: string[]; pixels: number[][] }
  try {
    const page = await browser.newPage()
    drawn = await page.evaluate(
      `(${DRAW})(${JSON.stringify({
        url: `data:image/png;base64,${image.toString("base64")}`,
        boxes: notes.map((n) => n.box),
      })})`,
    )
  } finally {
    await browser.close()
  }

  const lib = (file: string) => import(path.join(tree, "src/lib/pin", file))
  const { manifest, assetFiles } = await lib("model.ts")
  const { readExport } = await lib("import.ts")
  const { takePackage } = await lib("notes-package.ts")

  const marks = notes.map((n, k) => ({
    id: `m${k}`,
    shape: { kind: "area" as const, ...n.box },
    label: "",
    good: "",
    bad: n.words,
    origin: "voice" as const,
    quote: n.words,
  }))
  const where = new Map(
    marks.map((mark, k) => {
      const spot = spotOf(mark.shape, width, height)
      const colours = mainColours(new Uint8ClampedArray(drawn.pixels[k]))
      return [`m${k}`, whereLine(spot, textIn(lines, spot), colours)]
    }),
  )
  const asset = {
    id: "a1",
    name: "first-screen.png",
    type: "image/png",
    width,
    height,
    note: "",
    source: { kind: "ours" as const },
    marks,
  }
  const names = assetFiles(asset, 0, 1)
  const data = manifest(
    [asset],
    STAMP,
    undefined,
    (_a: unknown, m: { id: string }, place = 0) =>
      place ? undefined : where.get(m.id),
  )
  const bytes = (base64: string) =>
    new Uint8Array(Buffer.from(base64, "base64"))
  const root = "pinch-x/"
  const files = new Map<string, Uint8Array>([
    [`${root}notes.json`, new TextEncoder().encode(JSON.stringify(data))],
    [root + names.image, new Uint8Array(image)],
    [root + names.marked, bytes(drawn.marked)],
    ...notes.map((_, k): [string, Uint8Array] => [
      root + names.crop(k),
      bytes(drawn.crops[k]),
    ]),
  ])
  const pack = takePackage(readExport(files), files, STAMP, []) as {
    files: { name: string; data: Uint8Array }[]
    notes: number
    missing: number
  }
  for (const file of pack.files) {
    const to = path.join(out, file.name)
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, file.data)
  }
  const text = pack.files.find((f) => f.name.endsWith("/notes.md"))
  console.log(
    JSON.stringify({
      notes: pack.notes,
      missing: pack.missing,
      files: pack.files.length,
      closeUps: pack.files.filter((f) => f.name.includes("/crops/")).length,
      notesChars: text ? text.data.length : 0,
    }),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
