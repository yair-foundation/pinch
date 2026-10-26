// Serves the reel carousel demo on localhost (ES modules don't load from file://).
// node scripts/reel-carousel/serve.mjs, then open http://localhost:3121
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"

const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/reel-carousel.js": ["reel-carousel.js", "text/javascript; charset=utf-8"],
}
const port = Number(process.env.PORT) || 3121

createServer(async (req, res) => {
  const file = files[new URL(req.url, "http://localhost").pathname]
  if (!file) {
    res.writeHead(404).end()
    return
  }
  const [name, type] = file
  res
    .writeHead(200, { "content-type": type, "cache-control": "no-store" })
    .end(await readFile(new URL(name, import.meta.url)))
}).listen(port, "127.0.0.1", () =>
  console.log(`Reel carousel on http://localhost:${port}`),
)
