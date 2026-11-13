// The package end-to-end run: mock screens and mock takes (scenarios.ts) through the app's own
// placing of notes and Export, in headless Chromium, then each package read back and held to what
// its take should have made (analyze.ts). Writes each zip, its notes.md and a report.
//
//   node --import tsx scripts/package-e2e/run.ts [out-folder]      (default: .e2e/package)
//
// Needs Playwright's Chromium; set PW_PATH where `playwright` isn't found, as the harness does.
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { unzip } from "../../src/lib/pin/unzip"
import { type Applied, analyze } from "./analyze"
import { SCENARIOS, type Scenario } from "./scenarios"

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, "../..")
const require = createRequire(import.meta.url)

/** page.ts and the app code it imports as one script, with esbuild from tsx's own install. */
async function bundle(): Promise<string> {
  const esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild")
  const out = await esbuild.build({
    entryPoints: [path.join(here, "page.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    alias: { "@": path.join(repo, "src") },
    logLevel: "silent",
  })
  return out.outputFiles[0].text
}

export type Packed = {
  scenario: Scenario
  files: Map<string, Uint8Array>
  zip: Uint8Array
  applied: Applied[]
  exportMs: number
  report: ReturnType<typeof analyze>
}

/** Every scenario packed in the browser and analysed. */
export async function runScenarios(
  list: Scenario[] = SCENARIOS,
): Promise<Packed[]> {
  const script = await bundle()
  const { chromium } = require(process.env.PW_PATH || "playwright")
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on("pageerror", (e: Error) => errors.push(e.message))
    await page.setContent("<!doctype html><html><body></body></html>")
    await page.addScriptTag({ content: script })
    const out: Packed[] = []
    for (const scenario of list) {
      const made = await page.evaluate(
        (s: Scenario) =>
          (
            window as unknown as {
              pinchE2E: { pack: (s: Scenario) => Promise<unknown> }
            }
          ).pinchE2E.pack(s),
        scenario,
      )
      const {
        zip: b64,
        assets,
        exportMs,
      } = made as {
        zip: string
        assets: Applied[]
        exportMs: number
      }
      const zip = new Uint8Array(Buffer.from(b64, "base64"))
      const files = await unzip(zip.buffer as ArrayBuffer)
      out.push({
        scenario,
        files,
        zip,
        applied: assets,
        exportMs,
        report: analyze(scenario, files, assets),
      })
    }
    if (errors.length) throw new Error(`The page threw: ${errors.join("; ")}`)
    return out
  } finally {
    await browser.close()
  }
}

/** The run as Markdown: per scenario, its numbers and what didn't hold. */
export function reportText(runs: Packed[]): string {
  const lines = ["# Package end-to-end run", ""]
  for (const r of runs) {
    const { metrics: m, findings } = r.report
    lines.push(
      `## ${r.scenario.name}`,
      "",
      r.scenario.about,
      "",
      `- Notes: ${m.notesInPackage} in notes.md, ${m.notesExpected} expected; placed right ${m.placed}`,
      `- notes.md: ${m.notesMdChars} chars (~${m.approxTokens} tokens), intro ${m.introChars}, notes' words ${m.noteChars}, Where lines ${m.whereChars}`,
      `- Files: ${m.files}, ${(m.zipBytes / 1024).toFixed(0)} KB (screenshots ${(m.imageBytes / 1024).toFixed(0)}, marked ${(m.markedBytes / 1024).toFixed(0)}, close-ups ${(m.cropBytes / 1024).toFixed(0)}, sheets ${(m.sheetBytes / 1024).toFixed(0)})`,
      `- Pictures: ${m.images} screenshots, ${m.marked} marked (long side ${m.markedLongSide.join(", ")}), ${m.crops} close-ups (${m.cropSizes.join(", ") || "none"}), ${m.sheets} sheets`,
      `- Export took ${r.exportMs} ms in the browser`,
      "",
      ...(findings.length
        ? findings.map((f) => `- **${f.level}**: ${f.what}`)
        : ["- Everything held."]),
      "",
    )
  }
  return `${lines.join("\n")}\n`
}

/** Each zip, its notes.md and transcript, and the report, in a folder. */
export function writeRuns(runs: Packed[], dir: string) {
  mkdirSync(dir, { recursive: true })
  for (const r of runs) {
    const name = r.scenario.name
    writeFileSync(path.join(dir, `${name}.zip`), r.zip)
    for (const [file, data] of r.files)
      if (/\/(notes|transcript|pinch-check)\.md$/.test(file))
        writeFileSync(path.join(dir, `${name}-${path.basename(file)}`), data)
  }
  writeFileSync(path.join(dir, "report.md"), reportText(runs))
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = path.resolve(process.argv[2] ?? path.join(repo, ".e2e/package"))
  void runScenarios().then((runs) => {
    writeRuns(runs, dir)
    process.stdout.write(reportText(runs))
    console.log(`Written to ${dir}`)
    if (runs.some((r) => r.report.findings.some((f) => f.level === "error")))
      process.exitCode = 1
  })
}
