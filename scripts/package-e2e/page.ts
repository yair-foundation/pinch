// The browser half of the package end-to-end run, bundled by run.ts and loaded in headless
// Chromium: it draws a scenario's screens, applies its take as the reel does after Finish, and
// packs the batch as Export does (`packTake` in pin-app.tsx), with the app's own drawing code.
// The text a screen-reader would find is the text drawn, where it was drawn.
import { buildExport } from "../../src/components/pin/render"
import { readExport } from "../../src/lib/pin/import"
import type { TextLine } from "../../src/lib/pin/mark-words"
import type { Asset } from "../../src/lib/pin/model"
import { takePackage } from "../../src/lib/pin/notes-package"
import { quietOf } from "../../src/lib/pin/take-transcript"
import { unzip } from "../../src/lib/pin/unzip"
import {
  applyTake,
  removedScreens,
  takesApplied,
} from "../../src/lib/pin/voice-notes"
import { zip } from "../../src/lib/pin/zip"
import type { MockScreen, Scenario } from "./scenarios"

const STAMP = "2026-11-13T09:45:00.000Z"

async function draw(s: MockScreen): Promise<{ blob: Blob; text: TextLine[] }> {
  const canvas = document.createElement("canvas")
  canvas.width = s.width
  canvas.height = s.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D canvas")
  ctx.fillStyle = s.ground
  ctx.fillRect(0, 0, s.width, s.height)
  const text: TextLine[] = []
  for (const b of s.boxes) {
    ctx.fillStyle = b.fill
    ctx.beginPath()
    ctx.roundRect(b.x, b.y, b.w, b.h, b.radius ?? 0)
    ctx.fill()
    if (!b.text) continue
    const size = b.size ?? 16
    ctx.font = `600 ${size}px sans-serif`
    ctx.fillStyle = b.ink ?? "#000"
    ctx.textBaseline = "middle"
    const width = Math.min(ctx.measureText(b.text).width, b.w - 16)
    const x = b.x + Math.max(8, (b.w - width) / 2)
    ctx.fillText(b.text, x, b.y + b.h / 2, b.w - 16)
    text.push({
      text: b.text,
      x: x / s.width,
      y: (b.y + b.h / 2 - size * 0.6) / s.height,
      w: width / s.width,
      h: (size * 1.2) / s.height,
    })
  }
  const blob = await new Promise<Blob>((done, fail) =>
    canvas.toBlob(
      (x) => (x ? done(x) : fail(new Error("toBlob"))),
      "image/png",
    ),
  )
  return { blob, text }
}

const base64 = (parts: Uint8Array[]) => {
  let s = ""
  for (const p of parts)
    for (let i = 0; i < p.length; i += 0x8000)
      s += String.fromCharCode(...p.subarray(i, i + 0x8000))
  return btoa(s)
}

async function pack(scenario: Scenario) {
  const drawn = new Map<string, { blob: Blob; text: TextLine[] }>()
  for (const s of scenario.screens) drawn.set(s.id, await draw(s))
  const start: Asset[] = scenario.screens.map((s) => ({
    id: s.id,
    name: s.name,
    type: "image/png",
    width: s.width,
    height: s.height,
    note: "",
    marks: [],
  }))
  const { take } = scenario
  // As the reel's Finish does: the take's notes, then the screens it said to remove.
  const gone = new Set(removedScreens(take))
  const assets = applyTake(start, take).filter((a) => !gone.has(a.id))
  const takes = takesApplied(assets, [take])
  const quiet = takes.flatMap((t) =>
    quietOf(t).quiet.map((q) => t.screens[q.screen].id),
  )
  const t0 = performance.now()
  const made = await buildExport(
    assets,
    async (id) => drawn.get(id)?.blob,
    () => {},
    async (id) => drawn.get(id)?.text ?? [],
    quiet,
  )
  const exportMs = performance.now() - t0
  const found = await unzip(await made.blob.arrayBuffer())
  const p = takePackage(readExport(found), found, STAMP, takes)
  return {
    zip: base64(zip(p.files, new Date(STAMP))),
    notes: p.notes,
    missing: p.missing,
    exportMs: Math.round(exportMs),
    assets: assets.map((a) => ({ id: a.id, name: a.name, marks: a.marks })),
  }
}

;(window as unknown as { pinchE2E: unknown }).pinchE2E = { pack }
