// The check as Export gives it (D174): pinch-check.md only in the take's folder, and notes.md's
// opening line as `print-check.ts` prints it. Does the agent install the check and run it? Prints
// what each build did with it.
//
//   node --import tsx scripts/taste-harness/print-check.ts > <dir>/real-check.json
//   node scripts/taste-harness/realflow.mjs <dir>      <dir>/exp holds run.mjs's designers
import { spawn } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const O = process.argv[2],
  EXP = path.join(O, "exp")
const real = JSON.parse(readFileSync(path.join(O, "real-check.json"), "utf8"))
const intro = real.notes.split("Each note has a number.")[0]
const cases = [
  ["d2", 1],
  ["d4", 1],
  ["d5", 2],
  ["d2", 2],
]
await Promise.all(
  cases.map(async ([d, t]) => {
    const w = mkdtempSync(path.join(tmpdir(), "realflow-"))
    const take = path.join(w, "pinch", "pinch-notes-take-1")
    cpSync(path.join(EXP, d, "pinch"), path.join(w, "pinch"), {
      recursive: true,
    })
    const notes = readFileSync(path.join(take, "notes.md"), "utf8")
    writeFileSync(
      path.join(take, "notes.md"),
      intro + notes.slice(notes.indexOf("Each note has a number.")),
    )
    writeFileSync(path.join(take, "pinch-check.md"), real.check)
    cpSync(
      new URL("render.mjs", import.meta.url).pathname,
      path.join(w, "render.mjs"),
    )
    const des = JSON.parse(
      readFileSync(path.join(EXP, d, "designer.json"), "utf8"),
    )
    const prompt = `You're the coding agent on ${des.product}.\n\nThe designer's feedback on earlier screens is in ./pinch/: read all of it first and open the images. It is everything you know about their taste.\n\nBuild this, as one self-contained HTML file, ./index.html, for a desktop window 1440px wide:\n\n${des.tasks[t]}\n\n- Load Tailwind with <script src="https://cdn.tailwindcss.com"></script>, and Google Fonts if you want a typeface; load nothing else from outside.\n- No external images: draw with inline SVG or CSS, and write realistic text.\n\nYou can see what you build: \`node render.mjs\` draws ./index.html 1440px wide into ./render.png, which you can open.\n\nDon't ask questions: no one is there to answer them.`
    const args = [
      "-p",
      prompt,
      "--tools",
      "Read,Write,Edit,Glob,Grep,Bash,Agent",
      "--allowedTools",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Agent",
      "Bash(node render.mjs)",
      "Bash(node render.mjs:*)",
      "Bash(mkdir:*)",
      "Bash(cp:*)",
      "--permission-mode",
      "acceptEdits",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--disable-slash-commands",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ]
    const out = []
    await new Promise((res) => {
      const c = spawn("claude", args, {
        cwd: w,
        stdio: ["ignore", "pipe", "pipe"],
      })
      c.stdout.on("data", (x) => out.push(String(x)))
      c.stderr.on("data", (x) => out.push(String(x)))
      c.on("close", res)
    })
    const calls = []
    for (const line of out.join("").split("\n")) {
      try {
        const e = JSON.parse(line)
        if (e.type === "assistant")
          for (const c of e.message.content)
            if (c.type === "tool_use")
              calls.push(
                c.name === "Agent"
                  ? `Agent:${c.input.subagent_type}`
                  : c.name === "Bash"
                    ? `Bash:${c.input.command.slice(0, 60)}`
                    : c.name === "Write" || c.name === "Edit"
                      ? `${c.name}:${path.relative(w, c.input.file_path)}`
                      : null,
              )
      } catch {}
    }
    console.log(
      `${d} t${t}: installed=${existsSync(path.join(w, ".claude/agents/pinch-check.md"))} built=${existsSync(path.join(w, "index.html"))}\n  ${calls
        .filter(Boolean)
        .filter((c) => !c.startsWith("Bash:node"))
        .join(" | ")}`,
    )
  }),
)
