#!/usr/bin/env node
/**
 * Formats files with Prettier, in the style their folder uses:
 *
 *   pnpm format src/lib/pin/foo.ts src/components/pin/bar.tsx
 *
 * - `src/components/ui/` and `scripts/`: double quotes, no semicolons (the
 *   shadcn style the primitives came in).
 * - Everything else under `src/`: single quotes, semicolons, 100 columns.
 *
 * Takes explicit files only, never a folder: formatting files you didn't edit
 * rewrites lines nobody touched.
 */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("Usage: pnpm format <file> [file…]")
  process.exit(1)
}

/** Prettier options for a repo-relative path, or null to skip it. */
function optionsFor(file) {
  if (file.startsWith("src/components/ui/") || file.startsWith("scripts/")) return ["--no-semi"]
  if (file.startsWith("src/")) return ["--single-quote", "--print-width", "100"]
  return null
}

let failed = false
for (const arg of files) {
  const file = path.relative(process.cwd(), path.resolve(arg)).split(path.sep).join("/")
  let isFile = false
  try {
    isFile = statSync(file).isFile()
  } catch {}
  if (!isFile) {
    console.error(`skip ${file}: not a file (name files, not folders)`)
    failed = true
    continue
  }
  const opts = optionsFor(file)
  if (!opts) {
    console.error(`skip ${file}: no formatting rule for it`)
    failed = true
    continue
  }
  execFileSync("prettier", [...opts, "--write", file], { stdio: "inherit" })
}
process.exit(failed ? 1 : 0)
