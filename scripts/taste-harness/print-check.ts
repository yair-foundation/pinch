// Prints what a package's notes.md opens with, and its pinch-check.md, as Export writes them.
import { newCollection } from "../../src/lib/pin/learnings"
import {
  CHECK_FILE,
  NOTES_FILE,
  notesPackage,
} from "../../src/lib/pin/notes-package"

const made = notesPackage(
  newCollection("x", "x", "2026-11-07T10:00:00.000Z"),
  new Map(),
  "2026-11-07T10:00:00.000Z",
)
const text = (name: string) =>
  new TextDecoder().decode(made.files.find((f) => f.name.endsWith(name))?.data)
console.log(
  JSON.stringify({ notes: text(NOTES_FILE), check: text(CHECK_FILE) }),
)
