// Draws ./index.html 1440 wide into ./render.png (1440x2400, like the trial), and writes
// ./render-text.json: visible text blocks with their boxes as fractions of the image.

import { existsSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW_PATH || "playwright")
const W = 1440,
  H = 2400
rmSync("render.png", { force: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  await page
    .goto(`file://${resolve("index.html")}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    })
    .catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: resolve("render.png") })
  const text = await page.evaluate(
    ([W, H]) => {
      const out = []
      const walk = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      )
      while (walk.nextNode()) {
        const n = walk.currentNode
        const t = n.textContent.replace(/\s+/g, " ").trim()
        if (!t) continue
        const r = document.createRange()
        r.selectNodeContents(n)
        const b = r.getBoundingClientRect()
        if (!b.width || b.top > H || b.bottom < 0) continue
        out.push({
          t,
          x: b.left / W,
          y: b.top / H,
          w: b.width / W,
          h: b.height / H,
        })
      }
      return out
    },
    [W, H],
  )
  writeFileSync("render-text.json", JSON.stringify(text))
} finally {
  await browser.close()
}
if (!existsSync("render.png")) {
  console.error("Couldn't draw render.png.")
  process.exit(1)
}
console.log("Drew render.png, 1440 by 2400.")
