// Reads a package made by the end-to-end run and holds it to its scenario: what is in the zip and
// what notes.md names, where each note landed and how notes.md says it, and what it costs an
// agent to read. Pure: the files and the notes as applied come in, a report goes out.
import { isWholeScreen, spotOf } from "../../src/lib/pin/mark-words"
import { type Mark, placesOf } from "../../src/lib/pin/model"
import { CHECK_FILE, NOTES_FILE } from "../../src/lib/pin/notes-package"
import { TRANSCRIPT_FILE } from "../../src/lib/pin/take-transcript"
import type { Box, Expected, Scenario } from "./scenarios"

export type Finding = { level: "error" | "warn"; what: string }
export type Applied = { id: string; name: string; marks: Mark[] }

/** Width and height from a PNG's or a JPEG's header, or null. */
export function sizeOf(
  data: Uint8Array,
): { width: number; height: number } | null {
  if (data[0] === 0x89 && data[1] === 0x50) {
    const v = new DataView(data.buffer, data.byteOffset)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (data[0] !== 0xff || data[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null
    const marker = data[i + 1]
    const length = (data[i + 2] << 8) | data[i + 3]
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        height: (data[i + 5] << 8) | data[i + 6],
        width: (data[i + 7] << 8) | data[i + 8],
      }
    i += 2 + length
  }
  return null
}

export type NoteLine = {
  section: string
  number: string
  text: string
  extra: string[]
}

/** notes.md cut into its intro, and each note with the lines under it, by screen. */
export function parseNotes(md: string) {
  const lines = md.split("\n")
  const firstSection = lines.findIndex(
    (l) => l.startsWith("## ") && l !== "## Not sure",
  )
  const intro = lines
    .slice(0, firstSection < 0 ? lines.length : firstSection)
    .join("\n")
  const notes: NoteLine[] = []
  const screens: { name: string; about: string[] }[] = []
  let section = ""
  for (const line of lines.slice(Math.max(0, firstSection))) {
    if (line.startsWith("## ")) {
      section = line.slice(3)
      screens.push({ name: section, about: [] })
      continue
    }
    const note = line.match(/^- (\d+)\. (.*)$/)
    if (note) notes.push({ section, number: note[1], text: note[2], extra: [] })
    else if (line.startsWith("  ") && notes.length)
      notes[notes.length - 1].extra.push(line.trim())
    else if (line.trim() && screens.length)
      screens[screens.length - 1].about.push(line)
  }
  return { intro, notes, screens }
}

const near = (
  box: Box,
  w: number,
  h: number,
  spot: ReturnType<typeof spotOf>,
) => {
  const pad = 12
  const cx = spot.x + spot.w / 2
  const cy = spot.y + spot.h / 2
  const bx = (box.x + box.w / 2) / w
  const by = (box.y + box.h / 2) / h
  const inBox =
    cx >= (box.x - pad) / w &&
    cx <= (box.x + box.w + pad) / w &&
    cy >= (box.y - pad) / h &&
    cy <= (box.y + box.h + pad) / h
  const boxInSpot =
    bx >= spot.x &&
    bx <= spot.x + spot.w &&
    by >= spot.y &&
    by <= spot.y + spot.h
  return inBox || boxInSpot
}

const lower = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'")

export function analyze(
  scenario: Scenario,
  files: Map<string, Uint8Array>,
  applied: Applied[],
) {
  const findings: Finding[] = []
  const error = (what: string) => findings.push({ level: "error", what })
  const warn = (what: string) => findings.push({ level: "warn", what })
  const decode = (d?: Uint8Array) => (d ? new TextDecoder().decode(d) : "")

  // --- What is in the zip -----------------------------------------------------------------------
  const names = [...files.keys()]
  const roots = [
    ...new Set(
      names.filter((n) => n.includes("/")).map((n) => n.split("/")[0]),
    ),
  ]
  if (roots.length !== 1)
    error(`expected one folder in the zip, found ${roots.join(", ")}`)
  const root = `${roots[0]}/`
  const inside = (n: string) => n.startsWith(root)
  const beside = names.filter((n) => !inside(n))
  const md = decode(files.get(root + NOTES_FILE))
  if (!md) error(`no ${NOTES_FILE}`)
  if (!files.has(root + CHECK_FILE)) error(`no ${CHECK_FILE}`)
  const transcript = decode(files.get(root + TRANSCRIPT_FILE))
  if (!transcript) error(`no ${TRANSCRIPT_FILE}`)
  if (!beside.some((n) => /^pinch-take-.*\.json$/.test(n)))
    error("no take beside the folder")
  for (const n of names) {
    if (/\.(webm|ogg|mp3|wav|m4a)$/i.test(n))
      error(`audio in the package: ${n}`)
    if (/(^|\/)(notes\.json|README\.md|AGENTS\.md|contact-sheet\.jpg)$/.test(n))
      error(`the export's own file leaked into the package: ${n}`)
  }

  // Every file notes.md or the transcript names is there, and every picture is reachable.
  const named = new Set<string>()
  for (const text of [md, transcript])
    for (const m of text.matchAll(/`([^`\s]+\.(?:jpg|png|json|md))`/g))
      named.add(m[1])
  for (const n of named) {
    const found = files.has(root + n) || files.has(n)
    // The check's place in the agent's project is named too, and isn't the package's.
    if (!found && !n.startsWith(".claude/"))
      error(`named but not in the zip: ${n}`)
  }
  const pictures = names.filter((n) => /\.(jpg|png)$/.test(n))
  const reachable = (n: string) => {
    const rel = n.slice(root.length)
    if (named.has(rel)) return true
    // A screenshot shares its marked copy's name; a close-up is found by its note's number (D192).
    const stem = rel
      .replace(/^(images|marked|crops)\//, "")
      .replace(/\.(jpg|png)$/, "")
    if (rel.startsWith("images/"))
      return [...named].some((x) => x.includes(stem))
    if (rel.startsWith("crops/"))
      return [...named].some((x) =>
        x.includes(stem.replace(/-note-\d+(-\d+)?$/, "")),
      )
    // Sheets named as a span, "`a` to `b`".
    if (rel.startsWith("sheets/")) return /sheets\//.test(md + transcript)
    return false
  }
  for (const n of pictures)
    if (!reachable(n)) warn(`a picture nothing names: ${n}`)

  // --- The notes --------------------------------------------------------------------------------
  const parsed = parseNotes(md)
  const appliedNotes = applied.flatMap((a, screen) =>
    a.marks.filter((m) => m.origin === "voice").map((m) => ({ screen, m })),
  )
  const used = new Set<Mark>()
  const usedLines = new Set<NoteLine>()
  let placed = 0
  let placedOf = 0
  for (const e of scenario.expect.notes) {
    const screen = scenario.screens[e.screen]
    const found = appliedNotes.find(
      (x) =>
        x.screen === e.screen &&
        !used.has(x.m) &&
        lower(x.m.quote ?? "").includes(lower(e.says)),
    )
    if (!found) {
      error(`screen ${e.screen + 1}: no note saying "${e.says}"`)
      continue
    }
    used.add(found.m)
    // Where it points.
    placedOf++
    const spots = placesOf(found.m)
    const ok = placementOk(e, found.m, spots, screen)
    if (ok === true) placed++
    else error(`screen ${e.screen + 1}: "${e.says}" ${ok}`)
    // How notes.md says it.
    const line = parsed.notes.find(
      (l) => !usedLines.has(l) && lower(l.text).includes(lower(e.says)),
    )
    if (!line) {
      error(`notes.md has no line for "${e.says}"`)
      continue
    }
    usedLines.add(line)
    checkLine(e, line, screen, warn, error)
  }
  for (const x of appliedNotes)
    if (!used.has(x.m))
      error(`screen ${x.screen + 1}: a note nobody said as one: "${x.m.quote}"`)

  // --- The take as a whole ----------------------------------------------------------------------
  if (scenario.expect.purpose) {
    if (!lower(parsed.intro).includes(lower(scenario.expect.purpose)))
      error("the purpose said at the start is not in the intro")
    if (parsed.intro.includes("everything you know about my taste"))
      warn("a take with a purpose still opens with the taste line")
  }
  const quietCount = scenario.expect.quiet.length
  if (quietCount) {
    const said = parsed.intro.match(/I said nothing over (\d+) of/)
    if (!said) error("the screens passed in silence are not said")
    else if (Number(said[1]) !== quietCount)
      error(`the intro counts ${said[1]} silent screens, not ${quietCount}`)
    else if (quietCount === 1 && /They are (listed|drawn)/.test(parsed.intro))
      warn('one silent screen is spoken of as "they"')
    for (const q of scenario.expect.quiet) {
      const name = scenario.screens[q].name
      if (!transcript.includes(name.replace(/\.png$/, "")))
        error(`the transcript doesn't name the quiet screen ${name}`)
      const glanced = transcript.includes(`- ${name} *`)
      if (glanced !== (scenario.expect.glanced ?? []).includes(q))
        error(
          `the transcript ${glanced ? "marks" : "doesn't mark"} ${name} as glanced at`,
        )
    }
  }
  const sheets = names.filter((n) => n.startsWith(`${root}sheets/`))
  const markedSheets = sheets.filter((n) => n.includes("/marked-"))
  if (scenario.expect.sheets && !markedSheets.length)
    error("a long take came without sheets")
  if (!scenario.expect.sheets && markedSheets.length)
    warn(
      `a short take came with ${markedSheets.length} sheets of marked copies`,
    )
  if (quietCount && !sheets.some((n) => n.includes("/quiet-")))
    error("the silent screens are not drawn on a sheet")
  for (const u of scenario.expect.unsure ?? [])
    if (!md.includes("## Not sure") || !lower(md).includes(lower(u)))
      error(`"${u}" is not under Not sure`)

  // --- What it costs to read --------------------------------------------------------------------
  const whereChars = parsed.notes.reduce(
    (n, l) => n + l.extra.join("\n").length,
    0,
  )
  const noteChars = parsed.notes.reduce((n, l) => n + l.text.length, 0)
  const bytes = (prefix: string) =>
    names
      .filter((n) => n.startsWith(root + prefix))
      .reduce((s, n) => s + (files.get(n)?.length ?? 0), 0)
  const dims = (prefix: string) =>
    names
      .filter((n) => n.startsWith(root + prefix))
      .map((n) => sizeOf(files.get(n) as Uint8Array))
      .filter((x): x is { width: number; height: number } => !!x)
  const crops = dims("crops/")
  const marked = dims("marked/")
  const metrics = {
    files: names.length,
    zipBytes: names.reduce((s, n) => s + (files.get(n)?.length ?? 0), 0),
    notesMdChars: md.length,
    introChars: parsed.intro.length,
    noteChars,
    whereChars,
    words: md.split(/\s+/).length,
    approxTokens: Math.round(md.length / 4),
    notesInPackage: parsed.notes.length,
    notesExpected: scenario.expect.notes.length,
    placed: `${placed}/${placedOf}`,
    images: names.filter((n) => n.startsWith(`${root}images/`)).length,
    marked: marked.length,
    crops: crops.length,
    sheets: sheets.length,
    imageBytes: bytes("images/"),
    markedBytes: bytes("marked/"),
    cropBytes: bytes("crops/"),
    sheetBytes: bytes("sheets/"),
    markedLongSide: [
      ...new Set(marked.map((d) => Math.max(d.width, d.height))),
    ],
    cropSizes: crops.map((d) => `${d.width}x${d.height}`),
  }
  return { findings, metrics, parsed, root }
}

function placementOk(
  e: Expected,
  m: Mark,
  spots: ReturnType<typeof placesOf>,
  screen: Scenario["screens"][number],
): true | string {
  const w = screen.width
  const h = screen.height
  const whole = spots.length === 1 && isWholeScreen(spotOf(spots[0], w, h))
  if (e.at === "unpointed")
    return m.unpointed
      ? true
      : `should be unpointed, is ${describe(spots, w, h)}`
  if (e.at === "whole")
    return whole && !m.unpointed
      ? true
      : `should be the whole screen, is ${m.unpointed ? "unpointed" : describe(spots, w, h)}`
  if (whole)
    return `should point at ${e.at.join(" and ")}, is the whole screen${m.unpointed ? " (unpointed)" : ""}`
  const boxes = e.at.map((id) => screen.boxes.find((b) => b.id === id) as Box)
  if (spots.length !== boxes.length)
    return `should have ${boxes.length} spot(s) on ${e.at.join(", ")}, has ${spots.length}: ${describe(spots, w, h)}`
  const wrong = boxes.filter((b, i) => !near(b, w, h, spotOf(spots[i], w, h)))
  return wrong.length
    ? `should point at ${wrong.map((b) => b.id).join(", ")}, is ${describe(spots, w, h)}`
    : true
}

function describe(spots: ReturnType<typeof placesOf>, w: number, h: number) {
  return spots
    .map((s) => {
      const q = spotOf(s, w, h)
      return `${s.kind} ${Math.round(q.x * w)},${Math.round(q.y * h)} ${Math.round(q.w * w)}x${Math.round(q.h * h)}`
    })
    .join("; ")
}

function checkLine(
  e: Expected,
  line: NoteLine,
  screen: Scenario["screens"][number],
  warn: (s: string) => void,
  error: (s: string) => void,
) {
  const where = line.extra.filter(
    (x) => x.startsWith("Where:") || x.startsWith("Also:"),
  )
  const label = `"${e.says}"`
  const starts = {
    right: "This is right: ",
    partly: "Partly right: ",
    question: "A question: ",
  } as const
  if (e.kind && !line.text.includes(starts[e.kind]))
    warn(`${label} should start "${starts[e.kind]}", is "${line.text}"`)
  if (!e.kind && Object.values(starts).some((s) => line.text.includes(s)))
    warn(`${label} was given a kind it doesn't have: "${line.text}"`)
  if (e.takesBack && !line.extra.some((x) => x.startsWith("This takes back")))
    error(`${label} takes a note back and doesn't say so`)
  if (e.at === "unpointed" && !where.some((x) => x.includes("not pointed at")))
    warn(
      `${label} is unpointed but its Where says ${where.join(" ") || "nothing"}`,
    )
  if (Array.isArray(e.at)) {
    if (where.length !== e.at.length)
      warn(`${label} has ${where.length} Where lines for ${e.at.length} spots`)
    e.at.forEach((id, i) => {
      const box = screen.boxes.find((b) => b.id === id)
      if (box?.text && where[i] && !where[i].includes(box.text))
        warn(
          `${label}: Where doesn't give the text under it ("${box.text}"): ${where[i]}`,
        )
    })
    // Each spot of a note is told apart in words, not only on the marked copy (D198).
    const bare = where.map((x) => x.replace(/^(Where|Also): /, ""))
    if (new Set(bare).size < bare.length)
      warn(`${label}: two of its spots read the same: ${where.join(" | ")}`)
    const coloured = where.some(
      (x) => x.includes("Colours:") || x.includes("At the point"),
    )
    if (e.colours && !coloured)
      warn(`${label} speaks of colour but has no colours`)
    if (!e.colours && coloured)
      warn(`${label} has colours though it doesn't speak of colour`)
  }
}
