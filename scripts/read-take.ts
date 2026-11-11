// Reads a take's audio again with the dev server's reader (D136, D187) and writes the take with
// the new words, so a change to how takes are read can be judged on a real one: run
// `replay-take.ts` on what this writes, beside the take as it was first read.
//
// The audio stays in the browser that recorded it, under `take-<id>` in the `images` store of the
// `pin-notes` database; save it from there to a file first. Needs PINCH_WHISPER_MODEL, and
// PINCH_WHISPER_VAD for the take to be cut at its pauses (`pnpm whisper-model` prints both).
//
//   node --import tsx scripts/read-take.ts <pinch-take-….json> <audio> <out.json>
import { readFileSync, writeFileSync } from "node:fs"
import type { Take } from "../src/lib/pin/narration"
import { wordsByScreen } from "../src/lib/pin/transcript"
import { transcribe } from "../src/lib/transcribe"

const [takeFile, audioFile, outFile] = process.argv.slice(2)
if (!takeFile || !audioFile || !outFile) {
  console.error(
    "Usage: node --import tsx scripts/read-take.ts <pinch-take-….json> <audio> <out.json>",
  )
  process.exit(1)
}

async function main() {
  const take = JSON.parse(readFileSync(takeFile, "utf8")) as Take
  const started = Date.now()
  const words = await transcribe(new Uint8Array(readFileSync(audioFile)))
  writeFileSync(outFile, JSON.stringify({ ...take, words }))

  const screens = take.screens.length
  const before = wordsByScreen(take.shown, take.words ?? [], screens)
  const after = wordsByScreen(take.shown, words, screens)
  const said = (list: { text: string }[]) => list.map((w) => w.text).join(" ")
  console.log(
    `# ${take.words?.length ?? 0} words before, ${words.length} now, ` +
      `read in ${Math.round((Date.now() - started) / 1000)} s`,
  )
  for (let k = 0; k < screens; k++) {
    const [a, b] = [said(before[k]), said(after[k])]
    if (a === b) continue
    console.log(
      `\n## ${take.screens[k].name}\n- before: ${a || "nothing"}\n- now: ${b || "nothing"}`,
    )
  }
}

main()
